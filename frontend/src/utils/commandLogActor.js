/**
 * GĐ9 — hiển thị "AI ĐÃ MỞ TỦ" từ một bản ghi lịch sử (`CommandLogDTO`).
 *
 * <p>Dùng chung cho `AdminTab` (tab Lịch sử mở tủ) và `LockerNetworkMapTab` (panel chi tiết
 * trạm) để hai màn hình không mô tả cùng một dữ liệu theo hai kiểu khác nhau.
 *
 * <h2>Nguồn dữ liệu và giới hạn THẬT (không được làm tròn cho đẹp)</h2>
 * <ul>
 *   <li>{@code triggeredBy} chỉ có từ GĐ9. <b>31 bản ghi cũ luôn NULL</b> — trước đó giá trị này
 *       chỉ dùng trong bộ nhớ để chọn mode {@code deposit|pickup} rồi bị bỏ, chưa từng ghi
 *       xuống DB. Không khôi phục được, nên phải hiện "Không rõ (dữ liệu cũ)".</li>
 *   <li><b>Không biết shipper nào.</b> Bảng {@code orders} chỉ có {@code shipper_reserved_at},
 *       không có cột shipper. Với {@code SHIPPER_*} ta chỉ biết "một shipper đã làm" — không bịa
 *       tên.</li>
 *   <li>Tên/SĐT khách lấy từ đơn liên quan (service tra 1 query). Đơn đã bị xoá → chỉ còn mã
 *       đơn, thiếu tên: hiện mã đơn chứ không hiện "Không rõ".</li>
 * </ul>
 *
 * @param {object} log bản ghi lịch sử (CommandLogDTO)
 * @returns {{label: string, tone: 'customer'|'shipper'|'admin'|'api'|'unknown', detail: string|null}}
 *   `label` là dòng chính; `detail` là dòng phụ (SĐT hoặc mã đơn), có thể null.
 */
export const describeActor = (log) => {
  const action = (log?.triggeredBy || '').toUpperCase();
  const orderId = log?.orderId || null;
  const customerName = log?.customerName || null;
  const customerPhone = log?.customerPhone || null;

  // Không có mã hành động = bản ghi trước GĐ9. Không đoán, không suy từ orderId.
  if (!action) {
    return { label: 'Không rõ (dữ liệu cũ)', tone: 'unknown', detail: null };
  }

  // Khách nhận hàng: ưu tiên tên thật từ đơn; thiếu thì hiện mã đơn để còn tra được.
  if (action.startsWith('CUSTOMER')) {
    if (customerName) {
      return {
        label: customerName,
        tone: 'customer',
        detail: customerPhone || orderId,
      };
    }
    return {
      label: orderId ? `Khách · đơn ${orderId}` : 'Khách hàng',
      tone: 'customer',
      detail: null,
    };
  }

  // Shipper: biết CHẮC đây là shipper, nhưng KHÔNG biết là ai (bảng orders không có cột shipper).
  if (action.startsWith('SHIPPER')) {
    return {
      label: orderId ? `Shipper · ${orderId}` : 'Shipper',
      tone: 'shipper',
      detail: null,
    };
  }

  if (action === 'EMERGENCY_OVERRIDE') {
    return { label: 'Admin (mở khẩn cấp)', tone: 'admin', detail: null };
  }

  if (action === 'API_MANUAL') {
    return { label: 'API thủ công', tone: 'api', detail: null };
  }

  // Giá trị lạ (do firmware/hệ thống khác ghi): hiện nguyên văn, không đoán ý nghĩa.
  return { label: action, tone: 'api', detail: orderId };
};

/** Class Tailwind cho badge "Người mở" theo tone. */
export const actorBadgeClass = (tone) => {
  switch (tone) {
    case 'customer':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'shipper':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'admin':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'api':
      return 'bg-slate-100 text-slate-700 border-slate-300';
    default:
      return 'bg-slate-50 text-slate-400 border-slate-200';
  }
};
