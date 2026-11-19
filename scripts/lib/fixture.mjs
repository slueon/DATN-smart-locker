/**
 * fixture.mjs — dựng đơn thử trên TỦ ẢO rồi LUÔN dọn, kèm hàm giả luồng kiosk.
 *
 * <p><b>Ba lỗi mà file này chặn:</b>
 * <ol>
 *   <li>Ghi nhầm tủ thật `LOCKER_HN_01` — nơi có cân thật 195.2 g của thiết bị, một bản tin
 *       `has_item:0` là xoá mất dữ liệu người dùng. Nay mặc định `LOCKER_HN_02` và
 *       {@link assertVirtualLocker} chặn thẳng.</li>
 *   <li>Fixture sót lại khi script chết giữa chừng ⇒ baseline lệch (đã xảy ra ở GĐ57: orders=20,
 *       creds=19, phải dọn tay). Nay {@link withOrder} dọn trong `finally`.</li>
 *   <li>Quên trả `shipper_identity_tokens` mà mình đã bật — tủ khác đọc thấy "đã xác thực".
 *       {@link kioskFlow} trả lại token trong `finally`.</li>
 * </ol>
 *
 * <p><b>LUẬT:</b> fixture là đơn `PENDING` **không gán ngăn** — đúng hình dạng đơn thật lúc shipper
 * mở màn nạp; tự gán ngăn sẽ bỏ qua nhánh `select_compartment` cần đo.
 */
import { q, one, run, baseline, diffBaseline, assertVirtualLocker } from './db.mjs';
import { pub, pubOrThrow, heartbeat, sleep, LOCKER_AO } from './mqtt.mjs';

export { LOCKER_AO };

const MA_GOI = 'ORD-LIB';

/**
 * Tạo đơn PENDING (+1 credential) trên tủ ảo, chạy `fn`, rồi XOÁ SẠCH dù `fn` ném lỗi.
 *
 * <p>Trả về `{ ok, ketQua, loi, baseline }` — không ném lỗi ra ngoài để script đo vẫn in được kết
 * quả từng phép trước khi thoát. Nếu bạn CẦN ném lỗi, đọc `loi` rồi `throw`.
 *
 * @param {{orderId?:string, lockerId?:string, status?:string, trackingCode?:string,
 *          customerName?:string, customerPhone?:string, productName?:string,
 *          keepRows?:boolean}} opts
 * @param {(ctx:{order:object, orderId:string, lockerId:string, sql:Function}) => Promise<any>} fn
 */
export async function withOrder(opts, fn) {
  const {
    orderId = `${MA_GOI}-${Date.now().toString(36).toUpperCase()}`,
    lockerId = LOCKER_AO,
    status = 'PENDING',
    trackingCode = orderId,
    customerName = 'Doan Viet Hoang',
    customerPhone = '0988123456',
    productName = 'Kien thu thu vien do',
    keepRows = false,
  } = opts || {};
  assertVirtualLocker(lockerId);

  const truoc = baseline();
  // Ảnh chụp ngăn của tủ ẢO trước khi đo — luồng kiosk sẽ đổi `EMPTY`→`OCCUPIED`,
  // phải trả lại đúng số cũ chứ không "trả" bằng giá trị đã bị chính bài đo sửa.
  const nganTruoc = q(`SELECT comp_index, status, current_weight FROM compartments WHERE locker_id='${lockerId}';`);
  // Dọn xác của lần chạy trước (script chết trước khi finally) — không xoá gì khác.
  run(`DELETE FROM pickup_credentials WHERE order_id='${orderId}';`);
  run(`DELETE FROM orders WHERE order_id='${orderId}';`);
  run(`INSERT INTO orders (order_id,customer_name,customer_phone,delivery_type,locker_id,status,
        expected_date,product_name,total_amount,payment_method,payment_status,created_at)
      VALUES ('${orderId}','${customerName}','${customerPhone}','LOCKER','${lockerId}','${status}',
        CURDATE(),'${productName}',50000,'ONLINE_VIETQR','PAID',NOW());`);
  run(`INSERT INTO pickup_credentials (order_id,qr_token,otp_code,is_used,failed_attempts,expired_at)
      VALUES ('${orderId}','QR-${orderId}','975310',0,0,DATE_ADD(NOW(), INTERVAL 1 DAY));`);

  const order = { orderId, lockerId, status, trackingCode };
  const ketQua = { orderId, lockerId, status };
  let loi = null;
  try {
    ketQua.ketQua = await fn({ order, orderId, lockerId, sql: q });
  } catch (e) {
    loi = String(e?.message || e);
  } finally {
    if (!keepRows) {
      run(`DELETE FROM pickup_credentials WHERE order_id='${orderId}';`);
      run(`DELETE FROM orders WHERE order_id='${orderId}';`);
    }
    // Ngăn của tủ ảo có thể bị luồng kiosk đặt OCCUPIED — trả lại đúng ảnh chụp TRƯỚC khi đo.
    for (const c of nganTruoc) {
      run(`UPDATE compartments SET status='${c.status}', current_weight=${c.current_weight ?? 0} WHERE locker_id='${lockerId}' AND comp_index=${c.comp_index};`);
    }
  }
  const sau = baseline();
  return { ...ketQua, loi, baseline: { truoc, sau, diff: diffBaseline(truoc, sau) } };
}

/**
 * Giả lập firmware dẫn shipper qua 4 chặng: QR shipper → mã vận đơn → chọn ngăn → nạp xong.
 *
 * <p><b>Đúng thứ tự và đúng topic</b> như `MqttService`: uplink `qr/shipper`, `qr/order` (KHÔNG
 * chứa id trong topic, id ở payload), `locker/select_compartment` (ngăn **0-based** trong payload),
 * rồi sự kiện `compartment/N/event`. Sai thứ tự thì bước trên UI không lên và phép đo vô nghĩa.
 *
 * <p><b>Bắt buộc có phiên shipper:</b> backend từ chối `select_compartment` nếu chưa có token
 * shipper còn hiệu lực tại ĐÚNG tủ (GĐ44). Truyền `shipperToken` thật (lấy từ
 * `POST /api/shipper/token/generate`), đừng tự bịa chuỗi.
 *
 * @param {{orderId:string, lockerId?:string, shipperToken:string,
 *          compartment?:number, depositSuccess?:boolean, waitMs?:number}} order
 * @returns {Promise<{buoc:Array<{chang:string, ok:boolean, soLan:number}>, ok:boolean}>}
 */
export async function kioskFlow(order, opts = {}) {
  const {
    lockerId = LOCKER_AO,
    shipperToken,
    compartment = 0,
    depositSuccess = true,
    waitMs = 900,
  } = opts;
  assertVirtualLocker(lockerId);
  if (!shipperToken) throw new Error('kioskFlow cần shipperToken thật (POST /api/shipper/token/generate)');
  const orderId = order?.orderId || order;

  const buoc = [];
  const ghi = (chang, r) => { buoc.push({ chang, ok: r.ok, soLan: r.soLan }); return r; };

  // 1. QR định danh shipper (mã vĩnh viễn — GĐ15, không có hạn 60 s).
  ghi('qr-shipper', pub('ptit/qr/shipper', { locker_id: lockerId, qr: shipperToken }));
  await sleep(waitMs);

  // 2. Mã vận đơn — đơn phải đang PENDING, nếu không backend bỏ qua và không có ORDER_VALID.
  ghi('qr-order', pub('ptit/qr/order', { locker_id: lockerId, qr: orderId, order_id: orderId }));
  await sleep(waitMs);

  // 3. Chọn ngăn — payload 0-based, KHÔNG thêm 1 (backend tự +1).
  ghi('select-compartment', pub('ptit/Tu_1/locker/select_compartment', { locker_id: lockerId, compartment, qr: orderId }));
  await sleep(waitMs);

  // 4. Nạp xong — sự kiện `deposit_success` chốt đơn sang DEPOSITED.
  //
  // ⚠ ĐƠN VỊ: `select_compartment` nhận ngăn **0-based**, nhưng sự kiện ngăn (`compartment/N/event`)
  // dùng ngăn **1-based** (`MqttService.handleCompartmentEvent` đọc thẳng payload làm comp_index).
  // Gửi 0-based vào đây thì backend không tìm thấy ngăn 0 ⇒ KHÔNG có `DEPOSIT_SUCCESS` và đơn kẹt
  // PENDING (đã đo được: thanh dừng ở bước 5, `giuBuoc6 = null`).
  if (depositSuccess) {
    const ngan1 = compartment + 1;
    ghi('deposit-success', pub(`ptit/Tu_1/compartment/${ngan1}/event`, {
      locker_id: lockerId, status: 'deposit_success', compartment: ngan1,
    }));
    await sleep(waitMs);
  }
  const ok = buoc.every((b) => b.ok);
  const tokenSau = one(`SELECT CONCAT(CAST(is_verified AS UNSIGNED),'/',IFNULL(locker_id,'NULL'))
                          FROM shipper_identity_tokens WHERE token_id=142;`);
  return { buoc, ok, token142: tokenSau };
}

/** Đọc trạng thái 1 đơn (helper cho assertion của script đo). */
export function orderStatus(orderId) {
  return one(`SELECT CONCAT(status,'/',IFNULL(compartment_id,'NULL')) FROM orders WHERE order_id='${orderId}';`);
}

/**
 * Bật/tắt cờ xác thực của token shipper (GĐ44 đọc cờ này) — TRẢ LẠI bằng `finally` trong script.
 * @param {number} tokenId
 * @param {boolean} verified
 * @param {string|null} lockerId
 */
export function setShipperToken(tokenId, verified, lockerId) {
  const lock = lockerId ? `'${lockerId}'` : 'NULL';
  run(`UPDATE shipper_identity_tokens SET is_verified=${verified ? 1 : 0}, locker_id=${lock} WHERE token_id=${tokenId};`);
}

/** Ảnh chụp token shipper để trả lại sau khi đo. */
export function snapshotShipperToken(tokenId) {
  return one(`SELECT CONCAT(CAST(is_verified AS UNSIGNED),'/',IFNULL(locker_id,'NULL'))
                FROM shipper_identity_tokens WHERE token_id=${tokenId};`);
}

/**
 * GĐ68 — trả token shipper về ĐÚNG ảnh chụp của {@link snapshotShipperToken}.
 *
 * <p>Cấm ghi cứng `0/NULL` khi dọn: token trước đo có thể đang `1/LOCKER_HN_02` và lượt sau sẽ bị
 * `SHIPPER_REJECTED` (FAIL giả ở GĐ64a). Ảnh chụp sai dạng ⇒ ném lỗi, không đoán.
 * @param {number} tokenId
 * @param {string} snap chuỗi `"1/LOCKER_HN_02"` hoặc `"0/NULL"`
 */
export function restoreShipperToken(tokenId, snap) {
  const m = /^([01])\/(.+)$/.exec(String(snap ?? ''));
  if (!m) throw new Error(`restoreShipperToken: ảnh chụp không hợp lệ "${snap}"`);
  setShipperToken(tokenId, m[1] === '1', m[2] === 'NULL' ? null : m[2]);
  return snapshotShipperToken(tokenId);
}

/**
 * GĐ68 — chụp token ⇒ đặt `{verified, lockerId}` ⇒ chạy `fn` ⇒ `finally` TRẢ VỀ ảnh chụp,
 * kể cả khi `fn` ném lỗi (lỗi vẫn được ném tiếp ra ngoài).
 *
 * <p>`lockerId` khác null phải là tủ ảo — kiểm bằng {@link assertVirtualLocker} TRƯỚC mọi lệnh ghi.
 * @param {number} tokenId
 * @param {{verified?:boolean, lockerId?:string|null}} opts
 * @param {(ctx:{snap:string}) => Promise<any>|any} fn
 */
export async function withShipperToken(tokenId, opts, fn) {
  const { verified = true, lockerId = LOCKER_AO } = opts || {};
  if (lockerId != null) assertVirtualLocker(lockerId);
  const snap = snapshotShipperToken(tokenId);
  if (snap == null) throw new Error(`withShipperToken: không có token_id=${tokenId}`);
  setShipperToken(tokenId, verified, lockerId);
  try {
    return await fn({ snap });
  } finally {
    restoreShipperToken(tokenId, snap);
  }
}

export { pub, pubOrThrow, heartbeat, sleep, baseline, diffBaseline, q, one, run };
