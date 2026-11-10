package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * GĐ7/GĐ9 — DTO trả lịch sử mở tủ (`command_logs`) cho API ADMIN/SHIPPER.
 *
 * <p><b>Vì sao KHÔNG trả thẳng entity {@code CommandLog}:</b>
 * <ul>
 *   <li>{@code CommandLog.locker} là {@code @ManyToOne(LAZY)} — serialize thẳng ra ngoài
 *       session sẽ ném {@code LazyInitializationException} (đúng loại lỗi đã gặp ở tầng MQTT),
 *       hoặc tệ hơn là kéo theo cả entity {@code Locker} với đủ field nội bộ.</li>
 *   <li>Entity còn có {@code ackReceivedAt} và các cột sẽ thêm về sau — trả entity là tự động
 *       phơi mọi thay đổi schema ra API, không kiểm soát được.</li>
 * </ul>
 *
 * <h2>GĐ9 — "ai đã mở tủ"</h2>
 * <p><b>{@code triggeredBy}</b> là mã hành động do tầng nghiệp vụ truyền vào khi phát lệnh
 * ({@code CUSTOMER_OTP}, {@code CUSTOMER_PICKUP}, {@code SHIPPER_DEPOSIT},
 * {@code SHIPPER_RECALL}, {@code EMERGENCY_OVERRIDE}, {@code API_MANUAL}…).
 *
 * <p><b>Vì sao 31 bản ghi cũ luôn NULL:</b> cột {@code triggered_by} chỉ được thêm ở GĐ9.
 * Trước đó {@code MqttService.publishCommand} nhận tham số này nhưng chỉ dùng trong bộ nhớ để
 * chọn mode {@code deposit|pickup} rồi bỏ — chưa từng ghi xuống DB. Dữ liệu đó **không thể khôi
 * phục**, nên UI phải hiện "Không rõ (dữ liệu cũ)" chứ không được đoán.
 *
 * <p><b>Giới hạn đã biết — KHÔNG biết shipper nào:</b> bảng {@code orders} chỉ có
 * {@code shipper_reserved_at} (thời điểm đặt trước), **không có cột shipper**. Vì vậy với
 * {@code SHIPPER_*} ta chỉ biết đó là một shipper, không biết ai. Muốn có phải thêm cột vào
 * {@code orders} + luồng đặt trước — việc riêng, chưa làm.
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

    /** GĐ9 — mã hành động đã ra lệnh mở; NULL với 31 bản ghi trước GĐ9. */
    private String triggeredBy;

    /** GĐ9 — mã đơn liên quan (nếu có), dùng để tra tên khách. */
    private String orderId;

    /**
     * GĐ9 — tên khách của đơn liên quan, tra Ở TẦNG SERVICE (1 query cho cả danh sách).
     * NULL khi lệnh không gắn đơn, hoặc đơn đã bị xoá.
     */
    private String customerName;

    /** GĐ9 — SĐT khách của đơn liên quan. Cùng quy tắc NULL như {@link #customerName}. */
    private String customerPhone;
}
