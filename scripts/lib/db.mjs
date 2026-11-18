/**
 * db.mjs — chạy SQL trên MySQL của Smart Locker, trả về DỮ LIỆU CÓ TÊN CỘT.
 *
 * <p><b>Vì sao có file này:</b> mỗi script đo cũ đều tự `execFileSync(mysql.exe, [...])` rồi tự
 * cắt `\r`, tự `split('\n')` và tự nhớ thứ tự cột. Đã 3 lần đọc nhầm cột (ngăn 1 ↔ ngăn 2) và
 * 2 lần quên `--default-character-set=utf8mb4` nên tiếng Việt về dạng mojibake. Nay một chỗ lo.
 *
 * <p><b>QUY ƯỚC ĐỌC:</b> mysql in `NULL` cho giá trị NULL ở chế độ batch; hàm này đổi chuỗi
 * `'NULL'` thành `null` thật. Nếu cột của bạn CÓ THỂ chứa đúng chuỗi "NULL" thì đọc bằng
 * {@link one} hoặc thêm alias (`IFNULL(col,'')`).
 *
 * <p><b>Chỉ ĐỌC mặc định:</b> hàm không chặn lệnh ghi, nhưng mọi script đo phải trả baseline —
 * xem {@link baseline} + {@link diffBaseline}.
 */
import { execFileSync } from 'node:child_process';

export const MYSQL = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe';
export const DB = process.env.SMART_LOCKER_DB || 'smart_locker_db';
const USER = process.env.SMART_LOCKER_DB_USER || 'root';
const PASS = process.env.SMART_LOCKER_DB_PASS || '200220';

/**
 * Chạy MỘT câu SQL, trả mảng object `{ COT: giaTri }`.
 *
 * <p>Chỉ một câu/lần: nhiều câu cách nhau `;` sẽ trả nhiều bộ kết quả và phần tiêu đề dồn thành
 * một dòng rác. Câu không trả dòng nào (INSERT/UPDATE/DELETE) ⇒ trả `[]`.
 *
 * @param {string} sql
 * @returns {Array<Record<string, string|null>>}
 */
export function q(sql) {
  const out = execFileSync(
    MYSQL,
    ['-u' + USER, '-p' + PASS, '--default-character-set=utf8mb4', '-B', DB, '-e', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }
  );
  const lines = out.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const cols = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    cols.forEach((c, i) => {
      const v = cells[i];
      row[c] = v === undefined || v === 'NULL' ? null : v;
    });
    return row;
  });
}

/**
 * Một giá trị vô hướng (dòng đầu, cột đầu) — dùng cho `COUNT(*)`, `SELECT status …`.
 * @param {string} sql
 */
export function one(sql) {
  const rows = q(sql);
  if (!rows.length) return null;
  return Object.values(rows[0])[0];
}

/** Số nguyên từ {@link one} (chuỗi của mysql → number). */
export function num(sql) {
  const v = one(sql);
  return v === null ? null : Number(v);
}

/** `UPDATE`/`INSERT`/`DELETE` — trả số dòng bị đổi (dòng thông báo của mysql). */
export function run(sql) {
  execFileSync(
    MYSQL,
    ['-u' + USER, '-p' + PASS, '--default-character-set=utf8mb4', '-B', DB, '-e', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  return true;
}

/**
 * Ảnh chụp các con số phải giữ nguyên sau khi đo — chụp TRƯỚC rồi so SAU.
 *
 * <p>Đúng các cột mà mọi thẻ trước đây đều phải chép tay: số đơn, số credential, số lệnh mở tủ,
 * token shipper, user, số ngăn theo trạng thái, và nhịp tim tủ thật `LOCKER_HN_01`.
 * KHÔNG gồm `device_events` (luôn tăng vì chính script đo bơm bản tin) — đọc riêng nếu cần.
 */
export function baseline() {
  const compartments = {};
  for (const r of q('SELECT status, COUNT(*) AS n FROM compartments GROUP BY status;')) {
    compartments[r.status] = Number(r.n);
  }
  const hb = q("SELECT last_heartbeat, connection_status FROM lockers WHERE locker_id='LOCKER_HN_01';")[0] || {};
  return {
    orders: num('SELECT COUNT(*) FROM orders;'),
    creds: num('SELECT COUNT(*) FROM pickup_credentials;'),
    cmd: num('SELECT COUNT(*) FROM command_logs;'),
    tokens: num('SELECT COUNT(*) FROM shipper_identity_tokens;'),
    users: num('SELECT COUNT(*) FROM users;'),
    compartments,
    hn01: { lastHeartbeat: hb.last_heartbeat ?? null, connectionStatus: hb.connection_status ?? null },
  };
}

/**
 * So hai ảnh {@link baseline} — trả `{ same, changed }` với mọi đường dẫn lệch.
 *
 * <p>Dùng cuối mỗi script đo: `if (!d.same) console.error('BASELINE LỆCH', d.changed)`.
 */
export function diffBaseline(a, b) {
  const changed = {};
  const walk = (x, y, path) => {
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        walk(x[k], y[k], path ? path + '.' + k : k);
      }
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) changed[path] = { truoc: x, sau: y };
  };
  walk(a, b, '');
  return { same: Object.keys(changed).length === 0, changed };
}

/** Guard dùng chung: fixture TUYỆT ĐỐI không được ghi lên tủ thật `LOCKER_HN_01`. */
export function assertVirtualLocker(lockerId) {
  if (!lockerId || lockerId === 'LOCKER_HN_01' || lockerId === 'Tu_1') {
    throw new Error(`fixture chỉ được chạy trên tủ ảo, không phải "${lockerId}"`);
  }
  return lockerId;
}
