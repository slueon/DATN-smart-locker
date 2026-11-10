package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * GĐ7 — DTO trả lịch sử mở tủ (`command_logs`) cho API ADMIN/SHIPPER.
 *
 * <p><b>Vì sao KHÔNG trả thẳng entity {@code CommandLog}:</b>
 * <ul>
 *   <li>{@code CommandLog.locker} là {@code @ManyToOne(LAZY)} — serialize thẳng ra ngoài
 *       session sẽ ném {@code LazyInitializationException} (đúng loại lỗi đã gặp ở tầng MQTT),
 *       hoặc tệ hơn là kéo theo cả entity {@code Locker} với đủ field nội bộ.</li>
 *   <li>Entity còn có {@code ackReceivedAt} và các cột sẽ thêm về sau — trả entity là tự động
 *       phơi mọi thay đổi schema ra API, không kiểm soát được.</li>
 * </ul>
 * Vì vậy chỉ trả đúng các trường mà UI cần.
 *
 * <p><b>Không có {@code triggeredBy}:</b> bảng {@code command_logs} hiện <b>không lưu</b> cột
 * này (xem {@code CommandLog} — chỉ có commandId/locker/compartmentId/commandType/sentAt/
 * ackReceivedAt/status). Giá trị {@code triggeredBy} chỉ được dùng trong bộ nhớ ở
 * {@code MqttService.publishCommand} để quyết định mode {@code deposit|pickup}, không ghi xuống
 * DB. Muốn trả về thì phải thêm cột + migration — ngoài phạm vi thẻ này.
 */
@Getter
@Setter
@Builder
public class CommandLogDTO {

    private String commandId;
    private String lockerId;
    private Integer compartmentId;
    private String commandType;
    private String status;
    private LocalDateTime sentAt;
    /** Thời điểm thiết bị xác nhận; null nghĩa là chưa nhận phản hồi (hoặc chưa hỗ trợ). */
    private LocalDateTime ackReceivedAt;
}
