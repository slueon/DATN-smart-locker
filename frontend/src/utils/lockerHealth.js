/**
 * GĐ8 — helper sức khoẻ trạm tủ, DÙNG CHUNG cho `AdminTab` và `LockerNetworkMapTab`.
 *
 * <p><b>Vì sao tách ra file riêng thay vì copy:</b> hai màn hình (dashboard KPI và bản đồ quản
 * trị) phải nói **cùng một ngôn ngữ** về trạng thái tủ. Nếu mỗi nơi tự viết ngưỡng, chỉ cần ai
 * sửa 5 phút thành 3 phút ở một chỗ là hai màn hình hiển thị mâu thuẫn — admin nhìn bản đồ thấy
 * đỏ, nhìn dashboard thấy xanh, và không ai biết cái nào đúng.
 *
 * <p><b>Vì sao KHÔNG dùng `connectionStatus`:</b> backend cập nhật cột đó khi có bản tin MQTT
 * nhưng KHÔNG có scheduler chuyển sang OFFLINE khi tủ im lặng. Đo thật ngày 10/11: cả 10 tủ ghi
 * `ONLINE` trong khi HN_02 im 17 giờ, HN_04–10 im 3 ngày. Tin cột đó là hiển thị sai hoàn toàn.
 * Nguồn sự thật duy nhất là `lastHeartbeat`.
 */

/** Dưới ngưỡng này: coi là đang online. */
export const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
/** Trên ngưỡng này: coi là mất kết nối hẳn. */
export const HEARTBEAT_STALE_MS = 60 * 60 * 1000;

/**
 * Thời gian tương đối tiếng Việt: "vừa xong" / "12 phút trước" / "2 ngày trước".
 *
 * @param {string|number|Date|null} iso thời điểm nhịp tim cuối
 */
export const formatRelativeTime = (iso) => {
  if (!iso) return 'chưa từng gửi';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'không rõ';
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  return `${Math.round(diffHour / 24)} ngày trước`;
};

/**
 * Trạng thái một tủ. GĐ12: chia làm hai loại.
 *
 * <p><b>Tủ ảo</b> ({@code isVirtual === true}) — khai báo trong CSDL, không có thiết bị nên không
 * bao giờ có nhịp tim. Nếu suy thuần từ nhịp tim thì chúng luôn hiện "Mất kết nối" — sai sự thật
 * theo hướng ngược lại (chúng không hỏng, chúng không tồn tại về mặt thiết bị). Nhánh này phải
 * đứng TRƯỚC mọi nhánh dựa trên {@code ageMs}.
 *
 * <p><b>Tủ thật</b> — giữ nguyên 3 mức cũ theo nhịp tim, KHÔNG nới lỏng: đó là mục đích của
 * việc theo dõi tủ thật.
 *
 * @returns {{key: string, label: string, tone: 'emerald'|'amber'|'rose', rel: string, ageMs: number|null, isVirtual: boolean}}
 *   `tone` dùng để tô màu: emerald = xanh, amber = vàng, rose = đỏ.
 */
export const getLockerHealth = (locker) => {
  const hb = locker?.lastHeartbeat ? new Date(locker.lastHeartbeat).getTime() : null;
  const ageMs = hb != null && !Number.isNaN(hb) ? Date.now() - hb : null;
  const rel = formatRelativeTime(locker?.lastHeartbeat);
  const isVirtual = locker?.isVirtual === true;

  // GĐ12 — nhãn phải NÓI RÕ đây là tủ khai báo, không phải tủ đang chạy thật. Vẫn giữ `rel`
  // (thời gian nhịp tim cuối) để người đọc biết tủ này không có thiết bị gửi nhịp tim.
  if (isVirtual) {
    return { key: 'VIRTUAL', label: 'Online (tủ ảo)', tone: 'emerald', rel, ageMs, isVirtual };
  }

  if (ageMs == null) {
    return { key: 'NEVER', label: 'Chưa có tín hiệu', tone: 'rose', rel, ageMs, isVirtual };
  }
  if (ageMs > HEARTBEAT_STALE_MS) {
    return { key: 'STALE', label: 'Mất kết nối', tone: 'rose', rel, ageMs, isVirtual };
  }
  if (ageMs > HEARTBEAT_FRESH_MS) {
    return { key: 'UNKNOWN', label: 'Không rõ', tone: 'amber', rel, ageMs, isVirtual };
  }
  return { key: 'ONLINE', label: 'Online', tone: 'emerald', rel, ageMs, isVirtual };
};

/** Màu hex ứng với tone — dùng cho Leaflet (nhận chuỗi màu, không nhận class Tailwind). */
export const TONE_HEX = {
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#ef4444',
};
