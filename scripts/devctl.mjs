#!/usr/bin/env node
/**
 * devctl — MỘT cửa bật/tắt/kiểm dự án. Thay cho việc mỗi phiên lại gõ tay 5 lệnh PowerShell.
 *
 *   node scripts/devctl.mjs status   # kiểm thật bằng HTTP + MQTT, in link
 *   node scripts/devctl.mjs up       # bật backend + vite nếu chưa chạy
 *   node scripts/devctl.mjs down     # tắt cả hai
 *
 * Lý do tồn tại: GĐ19 mất cả một vòng nghiệm thu vì Chief restart backend giữa lúc minh đang đo
 * (`Network Error`). Luật: trước khi `down`/`up`, kiểm xem có phiên nghiệm thu đang chạy không.
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend', 'smart-locker-backend');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const EVIDENCE = path.join(ROOT, 'scripts', 'evidence');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, opts = {}, timeoutMs = 5000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    return { ok: true, status: r.status, body: await r.text() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function backendUp() {
  const r = await http('http://localhost:8080/api/lockers', {}, 4000);
  // 401/403 vẫn chứng minh server SỐNG — đây là điểm luật "kiểm HTTP thật".
  return r.ok;
}

async function viteUp() {
  const r = await http('http://localhost:5173/', {}, 4000);
  return r.ok && r.status === 200;
}

/**
 * Dòng "Kết nối MQTT Broker thành công tại: …" trong log backend GẦN NHẤT.
 *
 * <p><b>SỬA GĐ31a (minh bắt được):</b> bản cũ đọc cứng `backend-run.log` — file đó là bản **cũ từ
 * 13/11**, nên `status` luôn in "chưa thấy log kết nối" dù MQTT đang chạy thật. Minh suýt bỏ toàn bộ
 * phép thử MQTT vì tin dòng này (nó kiểm chéo: publish thử thì `device_events` tăng sau 0,7 giây).
 *
 * <p>Nay đọc file mới nhất trong `scripts/evidence/` khớp `backend*.log` — chọn theo `mtime`, nên
 * đúng cả khi dùng `run-logged.ps1` (ghi `backend-live.log`) hay `devctl up` (không ghi log).
 */
async function mqttLine() {
  if (!fs.existsSync(EVIDENCE)) return null;
  const candidates = fs
    .readdirSync(EVIDENCE)
    .filter((f) => /^backend.*\.log$/.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(EVIDENCE, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const { f } of candidates) {
    const txt = fs.readFileSync(path.join(EVIDENCE, f), 'utf8');
    const m = txt.match(/Kết nối MQTT Broker thành công tại: (\S+)/g);
    if (m) {
      return m[m.length - 1].replace('Kết nối MQTT Broker thành công tại: ', '') + '  (' + f + ')';
    }
  }
  return null;
}

function portsListening() {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const ports = {};
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const m = line.match(/:(\d+)\s/);
      if (m && ['8080', '5173'].includes(m[1])) ports[m[1]] = true;
    }
    return ports;
  } catch {
    return {};
  }
}

function killPort(port) {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const ids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      if (!new RegExp(`:${port}\\s`).test(line)) continue;
      const id = line.trim().split(/\s+/).pop();
      if (/^\d+$/.test(id)) ids.add(id);
    }
    for (const id of ids) {
      try {
        execSync(`taskkill /PID ${id} /F`, { stdio: 'ignore' });
        console.log(`  đã tắt PID ${id} (port ${port})`);
      } catch {}
    }
  } catch {}
}

async function status() {
  const b = await backendUp();
  const v = await viteUp();
  const p = portsListening();
  const mq = await mqttLine();
  console.log('=== TRẠNG THÁI DỰ ÁN ===');
  console.log(`backend 8080 : ${b ? 'SỐNG' : 'TẮT'}${p['8080'] && !b ? ' (port mở nhưng HTTP lỗi — kiểm lại!)' : ''}`);
  console.log(`vite 5173    : ${v ? 'SỐNG' : 'TẮT'}`);
  console.log(`MQTT         : ${mq || 'chưa thấy log kết nối'}`);
  if (b) console.log('  web     : http://localhost:5173');
  if (b) console.log('  swagger : http://localhost:8080/swagger-ui/index.html');
  return b && v;
}

function start({ backend = true, vite = true, bg = true } = {}) {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  // SỬA GĐ22 (minh bắt được): bản cũ dùng `stdio: 'ignore'` nên KHÔNG có log ở đâu cả.
  //
  // Đã thử 3 cách ghi log từ trong node và ĐO ĐƯỢC cả 3 đều hỏng trên máy này:
  //   1. `stdio: ['ignore', fd, fd]` → file tạo ra nhưng **0 byte** (Windows không kế thừa fd cho
  //      tiến trình detached; `cmd.exe` còn sinh tiến trình cháu `java` nên luồng mất).
  //   2. `spawn('cmd.exe', ['/c', '... > log 2>&1'])` → **không tạo file**.
  //   3. `Start-Process -RedirectStandardOutput` gọi qua `spawn` → **không tạo file** (khác hẳn khi
  //      gọi trực tiếp từ PowerShell, chỗ đó chạy được).
  //
  // ⇒ Kết luận: từ node thì không redirect được ổn định. Nên `up` ở đây chỉ BẬT (không log), còn
  // khi cần đọc log thì dùng `scripts/run-logged.ps1` do PowerShell chạy trực tiếp — cách đó đã
  // đo được file thật (26236 byte). Đừng thử redirect từ node lần nữa.
  if (backend) {
    spawn('cmd.exe', ['/c', '.\\mvnw.cmd -o spring-boot:run'], {
      cwd: BACKEND_DIR,
      stdio: 'ignore',
      detached: bg,
      windowsHide: true,
    }).unref();
  }

  if (vite) {
    spawn('cmd.exe', ['/c', 'npm.cmd run dev'], {
      cwd: FRONTEND_DIR,
      stdio: 'ignore',
      detached: bg,
      windowsHide: true,
    }).unref();
  }

  console.log('  (không ghi log từ node — cần log thì chạy: powershell -File scripts\\run-logged.ps1)');
}

async function up() {
  const b = await backendUp();
  const v = await viteUp();
  if (b && v) {
    console.log('cả hai đã chạy sẵn — không bật lại');
    return status();
  }
  console.log('bật backend + vite...');
  start({ backend: !b, vite: !v });
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const nb = await backendUp();
    const nv = await viteUp();
    if (nb && nv) break;
    if (i % 5 === 4) console.log(`  ...chờ ${(i + 1) * 2}s (backend=${nb ? 'ok' : 'chờ'}, vite=${nv ? 'ok' : 'chờ'})`);
  }
  return status();
}

async function down() {
  console.log('tắt backend + vite...');
  killPort(8080);
  killPort(5173);
  await sleep(3000);
  const p = portsListening();
  console.log(p['8080'] || p['5173'] ? 'CẢNH BÁO: còn port mở' : 'đã tắt sạch');
}

async function stopBackend() {
  console.log('dọn backend cũ trên port 8080...');
  killPort(8080);
  for (let i = 0; i < 15; i++) {
    await sleep(500);
    const p = portsListening();
    if (!p['8080']) {
      console.log('port 8080 đã trống');
      return true;
    }
  }
  console.log('CẢNH BÁO: port 8080 vẫn còn tiến trình');
  return false;
}

const cmd = (process.argv[2] || 'status').toLowerCase();
if (cmd === 'status') await status();
else if (cmd === 'up') await up();
else if (cmd === 'down') await down();
else if (cmd === 'stop-backend') await stopBackend();
else {
  console.log('dùng: node scripts/devctl.mjs [status|up|down|stop-backend]');
  process.exit(1);
}
