/**
 * mqtt.mjs — publish bản tin MQTT cho bài đo, CÓ THỬ LẠI.
 *
 * <p><b>Vì sao chỉ là lớp mỏng trên `scripts/mqtt-probe.mjs`:</b> probe đã cài TLS 8883, đóng gói
 * MQTT 3.1.1 và biết đọc payload từ file — viết lại là tự tạo nguồn lỗi thứ hai. Ở đây chỉ thêm
 * đúng phần mà mọi script đo đã phải tự chép: <b>retry + backoff</b>, vì broker công cộng
 * `ssl://broker.emqx.io:8883` rớt TLS khoảng 50% số lần (đo ở GĐ57 vòng 2; lần chạy đầu mất 2/4
 * bản tin và cho ra kết luận SAI "không có bước 6").
 *
 * <p><b>Một bản tin hỏng KHÔNG phải lỗi sản phẩm.</b> Đọc `soLan` của kết quả: `soLan > 1` nghĩa
 * là hạ tầng mạng, ghi vào log chứ đừng báo FAIL.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertVirtualLocker } from './db.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE = path.join(ROOT, 'scripts', 'mqtt-probe.mjs');

/** Tủ ảo dùng cho mọi bài đo — payload luôn ghi đè `locker_id` nên map `Tu_1` không được dùng. */
export const LOCKER_AO = 'LOCKER_HN_02';

/**
 * Danh sách id CẤM gửi trong payload — chúng map về tủ THẬT `LOCKER_HN_01`.
 *
 * <p>`Tu_1` là id thiết bị của tủ thật (`application.properties` map `Tu_1:LOCKER_HN_01`), nên một
 * bản tin `{"locker_id":"Tu_1"}` là ghi thẳng `last_heartbeat` + `device_events` lên tủ đang có cân
 * thật 195.2 g. Đây là tai nạn 10:25 ngày 18/11: `heartbeat()` gọi trần mặc định `Tu_1` làm nhịp
 * tim tủ thật nhảy. Chặn ở tầng `pub` để KHÔNG hàm nào lách được.
 */
const LOCKER_CAM = new Set(['Tu_1', 'LOCKER_HN_01']);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Đọc `locker_id` từ payload (object hoặc chuỗi JSON) — `null` nếu không có. */
function lockerIdTrongPayload(payload) {
  if (payload && typeof payload === 'object') {
    const v = payload.locker_id ?? payload.lockerId ?? null;
    return v == null ? null : String(v);
  }
  if (typeof payload === 'string') {
    try {
      const o = JSON.parse(payload);
      const v = o?.locker_id ?? o?.lockerId ?? null;
      return v == null ? null : String(v);
    } catch {
      return null; // payload không phải JSON khai báo locker_id ⇒ không có gì để chặn
    }
  }
  return null;
}

/**
 * Publish một bản tin, thử lại tới `tries` lần với backoff tăng dần.
 *
 * <p><b>Chặn TRƯỚC khi gửi:</b> payload có `locker_id` là `Tu_1`/`LOCKER_HN_01` (tủ thật) ⇒ ném
 * `Error` **trước khi** chạm broker, nên không có bản tin nào đi ra. Topic `ptit/Tu_1/…` vẫn được
 * phép (firmware dùng topic cố định đó, `locker_id` trong payload mới quyết định tủ).
 *
 * @param {string} topic  vd. `ptit/qr/shipper` (uplink) hoặc `ptit/Tu_1/locker/select_compartment`
 * @param {object|string} payload  object ⇒ JSON.stringify; string ⇒ gửi nguyên văn
 * @param {{qos?:0|1, tries?:number, baseMs?:number}} [opts]
 * @returns {{ok:boolean, soLan:number, out:string}}  `ok` = probe in `RESULT published`
 */
export function pub(topic, payload, { qos = 1, tries = 6, baseMs = 900 } = {}) {
  const camLocker = lockerIdTrongPayload(payload);
  if (camLocker && LOCKER_CAM.has(camLocker)) {
    throw new Error(
      `từ chối publish: payload có locker_id="${camLocker}" là TỦ THẬT (LOCKER_HN_01). ` +
      `Bài đo chỉ được dùng tủ ảo "${LOCKER_AO}" — xem scripts/lib/README.md`
    );
  }
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const out = execFileSync(
        process.execPath,
        [PROBE, 'pub', topic, body, '--qos=' + qos],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT }
      ).trim();
      // Probe chỉ in RESULT sau khi đã ghi xong gói và chờ 400 ms ⇒ đó là "ack" của ta.
      if (/RESULT published/.test(out)) return { ok: true, soLan: i + 1, out: out.split('\n').pop() };
      last = out.slice(0, 80);
    } catch (e) {
      last = 'exit ' + (e.status ?? '?');
    }
    // Chờ đồng bộ giữa các lần: backoff tăng dần, không dùng setTimeout của probe.
    try {
      execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${baseMs + i * 400})`], { stdio: 'ignore' });
    } catch {}
  }
  return { ok: false, soLan: tries, out: 'PUB_FAIL: ' + last };
}

/**
 * Publish và NÉM LỖI nếu hỏng — dùng khi bản tin là điều kiện bắt buộc của phép đo.
 * @param {string} topic
 * @param {object|string} payload
 */
export function pubOrThrow(topic, payload, opts) {
  const r = pub(topic, payload, opts);
  if (!r.ok) throw new Error(`không publish được ${topic}: ${r.out}`);
  return r;
}

/**
 * Nhịp tim — BẮT BUỘC trước khi đo luồng nạp: backend chỉ cho `deposit`/`select_compartment`
 * khi tủ còn nhịp (GĐ30). `lockerId` BẮT BUỘC và phải là tủ ảo (vd. `LOCKER_AO`) — không còn
 * mặc định `Tu_1` (tai nạn 10:25 ngày 18/11).
 * @param {string} lockerId
 */
export function heartbeat(lockerId) {
  assertVirtualLocker(lockerId);
  return pub('ptit/status', { locker_id: lockerId, status: 'ONLINE' });
}

/** Bản tin cảm biến ngăn (`compartment` 1-based, đúng như topic). `lockerId` bắt buộc, tủ ảo. */
export function compartmentStatus(compartment, fields, lockerId) {
  assertVirtualLocker(lockerId);
  return pub(`ptit/Tu_1/compartment/${compartment}/status`, { locker_id: lockerId, ...fields });
}

/** Sự kiện ngăn, vd. `deposit_success` / `pickup_success`. `lockerId` bắt buộc, tủ ảo. */
export function compartmentEvent(compartment, status, lockerId) {
  assertVirtualLocker(lockerId);
  return pub(`ptit/Tu_1/compartment/${compartment}/event`, { locker_id: lockerId, status, compartment });
}
