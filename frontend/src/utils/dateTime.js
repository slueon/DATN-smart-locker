// GĐ72 — tiện ích ngày giờ theo GIỜ MÁY (Asia/Ho_Chi_Minh khi chạy ở VN), không theo UTC.

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Ngày địa phương dạng `YYYY-MM-DD` (đúng định dạng `LocalDate` của backend).
 *
 * <p>Thay cho `new Date().toISOString().split('T')[0]`: chuỗi ISO là giờ UTC nên từ 00:00 đến
 * 06:59 giờ VN nó ra NGÀY HÔM QUA và backend từ chối "ngày trong quá khứ" (GĐ72 #4).
 */
export function ngayDiaPhuong(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Nhãn mốc hạn lưu kho: "24h00 hôm nay" / "24h00 mai" / "24h00 dd/mm".
 *
 * <p>Hạn lưu kho là hết 24h00 một ngày; MySQL làm tròn `23:59:59.999…` lên `00:00:00` ngày kế
 * tiếp, nên lùi 1 giây trước khi lấy ngày để không bị lệch sang ngày sau (GĐ72 #3).
 */
export function nhanMocHan(expiryDeadline, nowMs = Date.now()) {
  const han = new Date(new Date(expiryDeadline).getTime() - 1000);
  const homNay = new Date(nowMs);
  homNay.setHours(0, 0, 0, 0);
  const ngayHan = new Date(han);
  ngayHan.setHours(0, 0, 0, 0);
  const lech = Math.round((ngayHan - homNay) / 86400000);
  if (lech === 0) return '24h00 hôm nay';
  if (lech === 1) return '24h00 mai';
  return `24h00 ${pad2(han.getDate())}/${pad2(han.getMonth() + 1)}`;
}
