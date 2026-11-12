#!/usr/bin/env node
/**
 * mqtt-probe.mjs — Công cụ dò MQTT cho Smart Locker (T2).
 *
 * Vì sao tự viết MQTT 3.1.1 bằng `node:net` thay vì dùng package `mqtt`:
 *   repo này KHÔNG có `node_modules` ở gốc, và `npm install mqtt` phụ thuộc mạng +
 *   sinh thêm cây phụ thuộc không ai muốn commit. Probe chỉ cần CONNECT / SUBSCRIBE /
 *   PUBLISH / PINGREQ nên tự cài đặt gọn hơn và chạy được trên Node thuần.
 *
 * CÁCH DÙNG
 *   node scripts/mqtt-probe.mjs pub <topic> <payload> [--retain] [--qos=0|1]
 *   node scripts/mqtt-probe.mjs sub <topicFilter> [--ms=3000]
 *   node scripts/mqtt-probe.mjs shipper <token> [--locker=Tu_1]
 *   node scripts/mqtt-probe.mjs send <orderId> [--locker=Tu_1]
 *   node scripts/mqtt-probe.mjs status [--locker=Tu_1] [--plaintext]
 *   node scripts/mqtt-probe.mjs receive-phone <phone> [--locker=Tu_1]
 *
 * BIẾN MÔI TRƯỜNG
 *   MQTT_BROKER_URL     mặc định ssl://broker.emqx.io:8883 (TLS — GĐ16)
 *   MQTT_TOPIC_BASE     mặc định ptit
 *   MQTT_PROBE_TIMEOUT  mặc định 8000 (ms)
 *
 * MÃ THOÁT
 *   0 = lệnh chạy xong (kể cả khi không nhận được bản tin — đọc RESULT để biết)
 *   2 = lỗi tham số / kết nối / timeout chờ CONNACK
 */

import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const BROKER_URL = process.env.MQTT_BROKER_URL || 'ssl://broker.emqx.io:8883';
const BASE = process.env.MQTT_TOPIC_BASE || 'ptit';
const TIMEOUT = Number(process.env.MQTT_PROBE_TIMEOUT || 8000);
const VERBOSE = process.env.MQTT_PROBE_VERBOSE === '1';

// ───────────────────────────── tiện ích tham số ─────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq === -1) flags[body] = true;
      else flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseBroker(url) {
  const trimmed = String(url).trim();
  // GĐ16 — mặc định TLS: thiết bị thật `Tu_1` chỉ nói TLS ở cổng 8883.
  // Chuẩn hoá `mqtts://` (scheme quen thuộc) về `ssl://` để cùng một nhánh TLS bên dưới.
  const normalized = trimmed.startsWith('mqtts://')
    ? 'ssl://' + trimmed.slice('mqtts://'.length)
    : trimmed;
  const withScheme = normalized.includes('://') ? normalized : `tcp://${normalized}`;
  const u = new URL(withScheme);
  const useTls = u.protocol === 'mqtts:' || u.protocol === 'ssl:';
  const port = Number(u.port || (useTls ? 8883 : 1883));
  return { host: u.hostname, port, useTls };
}

const log = (...args) => {
  if (VERBOSE) process.stderr.write(args.join(' ') + '\n');
};

// ─────────────────────── mã hoá / giải mã gói MQTT 3.1.1 ───────────────────

/** Mã hoá "remaining length" dạng biến đổi (varint tối đa 4 byte). */
function encodeRemainingLength(n) {
  const out = [];
  let x = n;
  do {
    let digit = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) digit |= 0x80;
    out.push(digit);
  } while (x > 0);
  return Buffer.from(out);
}

function encodeString(str) {
  const body = Buffer.from(str, 'utf8');
  const head = Buffer.alloc(2);
  head.writeUInt16BE(body.length, 0);
  return Buffer.concat([head, body]);
}

function encodeConnect({ clientId, keepAlive = 60 }) {
  const variableHeader = Buffer.concat([
    encodeString('MQTT'),
    Buffer.from([0x04]), // protocol level 3.1.1
    Buffer.from([0x02]), // clean session
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(keepAlive, 0);
      return b;
    })(),
  ]);
  const payload = encodeString(clientId);
  const body = Buffer.concat([variableHeader, payload]);
  return Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(body.length), body]);
}

function encodeSubscribe({ packetId, topicFilter, qos = 0 }) {
  const body = Buffer.concat([
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(packetId, 0);
      return b;
    })(),
    encodeString(topicFilter),
    Buffer.from([qos & 0x03]),
  ]);
  // fixed header 0x82 = SUBSCRIBE + QoS1
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(body.length), body]);
}

function encodePublish({ topic, payload, qos = 0, retain = false }) {
  const topicBuf = encodeString(topic);
  const payloadBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const parts = [];
  let header = 0x30 | (qos << 1) | (retain ? 0x01 : 0x00);
  if (qos > 0) {
    // packet id (dùng 1 cho gọn — probe chỉ gửi 1 gói QoS1)
    const idBuf = Buffer.alloc(2);
    idBuf.writeUInt16BE(1, 0);
    parts.push(topicBuf, idBuf, payloadBuf);
  } else {
    parts.push(topicBuf, payloadBuf);
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([header]), encodeRemainingLength(body.length), body]);
}

const PINGREQ = Buffer.from([0xc0, 0x00]);
const DISCONNECT = Buffer.from([0xe0, 0x00]);

/**
 * Đọc các gói MQTT từ stream TCP.
 * Trả về bộ đệm còn dư để lần sau nối tiếp — TCP không đảm bảo 1 gói = 1 lần `data`.
 */
function createPacketReader(onPacket) {
  let buf = Buffer.alloc(0);

  const tryReadOne = () => {
    if (buf.length < 2) return false;

    // giải mã remaining length
    let multiplier = 1;
    let value = 0;
    let i = 1;
    let encodedBytes = 0;
    for (;;) {
      if (i >= buf.length) return false; // chưa đủ byte độ dài
      const digit = buf[i];
      value += (digit & 0x7f) * multiplier;
      multiplier *= 128;
      encodedBytes++;
      i++;
      if ((digit & 0x80) === 0) break;
      if (encodedBytes > 4) throw new Error('remaining length không hợp lệ (>4 byte)');
    }

    const headerLength = 1 + encodedBytes;
    const totalLength = headerLength + value;
    if (buf.length < totalLength) return false; // chờ thêm

    const firstByte = buf[0];
    const body = buf.subarray(headerLength, totalLength);
    buf = buf.subarray(totalLength);

    onPacket({ firstByte, body });
    return true;
  };

  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (tryReadOne()) {
      /* đọc hết các gói đang có */
    }
  };
}

/** Tách topic + payload từ PUBLISH; trả null nếu không phải PUBLISH. */
function decodePublish({ firstByte, body }) {
  const type = (firstByte >> 4) & 0x0f;
  if (type !== 3) return null; // không phải PUBLISH

  const qos = (firstByte >> 1) & 0x03;
  const topicLength = body.readUInt16BE(0);
  const topic = body.subarray(2, 2 + topicLength).toString('utf8');
  let offset = 2 + topicLength;
  if (qos > 0) offset += 2; // bỏ packet id
  const payload = body.subarray(offset).toString('utf8');
  return { topic, payload, qos };
}

// ──────────────────────────────── client ────────────────────────────────

class ProbeClient {
  constructor({ host, port, clientId, useTls = false }) {
    this.host = host;
    this.port = port;
    this.clientId = clientId;
    this.useTls = useTls;
    this.socket = null;
    this.connected = false;
    this.pending = [];
    this.messages = [];
    this.listeners = new Set();
    this.closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      // GĐ16 — firmware thật (`Tu_1`) và backend đều dùng TLS 8883, nên probe phải nói TLS
      // được. Trước đây script chỉ dùng `node:net` thuần (TCP) nên không bao giờ kết nối được
      // cổng 8883 — demo theo tài liệu sẽ treo tới timeout.
      const socket = this.useTls
        ? tls.connect({ host: this.host, port: this.port, servername: this.host })
        : net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setNoDelay(true);

      const handleChunk = createPacketReader((packet) => {
        const type = (packet.firstByte >> 4) & 0x0f;

        if (type === 2) {
          // CONNACK
          const rc = packet.body.length >= 2 ? packet.body[1] : 0xff;
          if (rc === 0) {
            this.connected = true;
            log('[probe] CONNACK ok');
            resolve();
          } else {
            reject(new Error(`CONNACK từ chối, return code=${rc}`));
          }
          return;
        }

        if (type === 9) {
          log('[probe] SUBACK');
          return;
        }

        if (type === 3) {
          const msg = decodePublish(packet);
          if (msg) this.handleMessage(msg);
          return;
        }

        if (type === 13) {
          log('[probe] PINGRESP');
          return;
        }
      });

      socket.on('data', handleChunk);
      socket.on('error', (err) => reject(err));
      socket.on('close', () => {
        this.closed = true;
      });

      socket.on('connect', () => {
        log('[probe] TCP connected, gửi CONNECT');
        socket.write(encodeConnect({ clientId: this.clientId }));
      });

      setTimeout(() => {
        if (!this.connected) reject(new Error(`Timeout ${TIMEOUT}ms chờ CONNACK từ ${this.host}:${this.port}`));
      }, TIMEOUT);
    });
  }

  handleMessage(msg) {
    this.messages.push(msg);
    process.stdout.write(`MSG topic=${msg.topic} payload=${msg.payload}\n`);
    for (const fn of this.listeners) fn(msg);
  }

  subscribe(topicFilter, qos = 0) {
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.socket.write(encodeSubscribe({ packetId: this.pending.length, topicFilter, qos }));
      // SUBACK không cần chờ chính xác — nghỉ ngắn cho broker kịp đăng ký
      setTimeout(resolve, 350);
    });
  }

  publish({ topic, payload, qos = 0, retain = false }) {
    if (!this.connected) throw new Error('chưa kết nối');
    this.socket.write(encodePublish({ topic, payload, qos, retain }));
    log(`[probe] PUBLISH ${topic} <- ${payload}`);
  }

  /** Chờ tới khi có bản tin khớp điều kiện, hoặc hết `ms`. */
  waitFor(predicate, ms) {
    for (const msg of this.messages) {
      if (predicate(msg)) return Promise.resolve(msg);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        resolve(null);
      }, ms);
      const listener = (msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.listeners.delete(listener);
          resolve(msg);
        }
      };
      this.listeners.add(listener);
    });
  }

  close() {
    try {
      if (this.socket && !this.closed) {
        this.socket.write(DISCONNECT);
        this.socket.end();
      }
    } catch {
      /* bỏ qua */
    }
  }
}

function makeClientId(prefix = 'probe') {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

async function withClient(fn) {
  const { host, port, useTls } = parseBroker(BROKER_URL);
  const client = new ProbeClient({ host, port, clientId: makeClientId(), useTls });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.close();
  }
}

// ──────────────────────────────── lệnh ────────────────────────────────

function topicPath(...parts) {
  return [BASE, ...parts].join('/');
}

async function cmdPub(positional, flags) {
  const [topic, payload = ''] = positional;
  if (!topic) throw usage('pub cần <topic> <payload>');
  const qos = Number(flags.qos || 0);
  const retain = Boolean(flags.retain);
  await withClient(async (client) => {
    client.publish({ topic, payload, qos, retain });
    await new Promise((r) => setTimeout(r, 400));
    process.stdout.write(`RESULT published topic=${topic} payload=${payload}\n`);
  });
  return 0;
}

async function cmdSub(positional, flags) {
  const [filter] = positional;
  if (!filter) throw usage('sub cần <topicFilter>');
  const ms = Number(flags.ms || TIMEOUT);
  await withClient(async (client) => {
    await client.subscribe(filter, 0);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
    }
    process.stdout.write(`RESULT count=${client.messages.length}\n`);
  });
  return 0;
}

/** Chờ 1 bản tin trên topic cụ thể; in RESULT payload=... và trả payload hoặc null. */
async function expectOn(client, topic, ms) {
  const msg = await client.waitFor((m) => m.topic === topic, ms);
  if (msg) process.stdout.write(`RESULT payload=${msg.payload}\n`);
  else process.stdout.write(`RESULT payload=<none> (timeout ${ms}ms trên ${topic})\n`);
  return msg ? msg.payload : null;
}

async function cmdShipper(positional, flags) {
  const [token] = positional;
  if (!token) throw usage('shipper cần <token>');
  const locker = flags.locker || 'Tu_1';
  const dev = flags.dev || locker;
  const modernTopic = topicPath('qr', 'shipper');
  const legacyTopic = topicPath('QR_Shipper');
  const topic = flags.legacy ? legacyTopic : modernTopic;
  const payload = flags.plain ? token : JSON.stringify({ locker_id: locker, qr: token });

  const outTopic = topicPath(dev, 'verified', 'shipper');
  const legacyOut = topicPath('verified', 'shipper');

  await withClient(async (client) => {
    await client.subscribe(`${BASE}/#`, 0);
    await new Promise((r) => setTimeout(r, 300));
    client.publish({ topic, payload });
    const got = await expectOn(client, outTopic, Number(flags.ms || TIMEOUT));
    if (got === null && flags['show-legacy']) {
      const legacyMsg = client.messages.find((m) => m.topic === legacyOut);
      if (legacyMsg) process.stdout.write(`RESULT legacy payload=${legacyMsg.payload}\n`);
    }
  });
  return 0;
}

async function cmdSend(positional, flags) {
  const [orderId] = positional;
  if (!orderId) throw usage('send cần <orderId>');
  const locker = flags.locker || 'Tu_1';
  const dev = flags.dev || locker;
  const topic = flags.legacy ? topicPath('QR_send') : topicPath('qr', 'order');
  const payload = JSON.stringify({ locker_id: locker, qr: orderId });
  const outTopic = topicPath(dev, 'locker', 'open');

  await withClient(async (client) => {
    await client.subscribe(`${BASE}/#`, 0);
    await new Promise((r) => setTimeout(r, 300));
    client.publish({ topic, payload });
    await expectOn(client, outTopic, Number(flags.ms || TIMEOUT));
  });
  return 0;
}

async function cmdStatus(positional, flags) {
  const locker = flags.locker || 'Tu_1';
  const topic = topicPath('status');
  const payload = flags.plaintext
    ? 'ONLINE'
    : JSON.stringify({ locker_id: locker, status: flags.offline ? 'OFFLINE' : 'ONLINE' });
  await withClient(async (client) => {
    client.publish({ topic, payload });
    await new Promise((r) => setTimeout(r, 400));
    process.stdout.write(`RESULT published topic=${topic} payload=${payload}\n`);
  });
  return 0;
}

async function cmdReceivePhone(positional, flags) {
  const [phone] = positional;
  if (!phone) throw usage('receive-phone cần <phone>');
  const locker = flags.locker || 'Tu_1';
  const dev = flags.dev || locker;
  const topic = flags.legacy ? topicPath('rec', 'phone') : topicPath('receive', 'phone');
  const payload = JSON.stringify({ locker_id: locker, phone });
  const outTopic = topicPath(dev, 'verified', 'customer');

  await withClient(async (client) => {
    await client.subscribe(`${BASE}/#`, 0);
    await new Promise((r) => setTimeout(r, 300));
    client.publish({ topic, payload });
    await expectOn(client, outTopic, Number(flags.ms || TIMEOUT));
  });
  return 0;
}

function usage(message) {
  const err = new Error(message);
  err.usage = true;
  return err;
}

const COMMANDS = {
  pub: cmdPub,
  sub: cmdSub,
  shipper: cmdShipper,
  send: cmdSend,
  status: cmdStatus,
  'receive-phone': cmdReceivePhone,
};

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  const fn = COMMANDS[command];

  if (!fn) {
    process.stderr.write(
      `Lệnh không hợp lệ: ${command ?? '(trống)'}\n` +
        `Dùng: ${Object.keys(COMMANDS).join(' | ')}\n`
    );
    return 2;
  }

  try {
    return await fn(rest, flags);
  } catch (err) {
    if (err?.usage) {
      process.stderr.write(`${err.message}\n`);
      return 2;
    }
    process.stderr.write(`LỖI: ${err?.message || err}\n`);
    return 2;
  }
}

main()
  .then((code) => {
    // Cho socket kịp đóng trước khi thoát (tránh cắt cụt gói DISCONNECT)
    setTimeout(() => process.exit(code), 120);
  })
  .catch((err) => {
    process.stderr.write(`LỖI KHÔNG BẮT ĐƯỢC: ${err?.message || err}\n`);
    process.exit(2);
  });
