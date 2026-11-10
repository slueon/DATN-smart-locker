package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "command_logs")
@Getter
@Setter
@Builder
public class CommandLog {

    @Id
    @Column(name = "command_id", length = 50)
    private String commandId;

    public CommandLog() {}

    public CommandLog(String commandId, Locker locker, Integer compartmentId, String commandType, LocalDateTime sentAt, LocalDateTime ackReceivedAt, String status) {
        this(commandId, locker, compartmentId, commandType, sentAt, ackReceivedAt, status, null, null);
    }

    /**
     * GĐ9 — constructor đầy đủ 9 tham số (có {@code triggeredBy} + {@code orderId}).
     *
     * <p>Phải giữ CẢ HAI constructor: bản 7 tham số là bản cũ, và Lombok {@code @Builder} cần
     * một constructor bao trùm MỌI field. Hiện chỉ {@code MqttService:487} dựng entity này bằng
     * builder, nhưng giữ tương thích để code/test cũ không gãy.
     */
    public CommandLog(String commandId, Locker locker, Integer compartmentId, String commandType,
                      LocalDateTime sentAt, LocalDateTime ackReceivedAt, String status,
                      String triggeredBy, String orderId) {
        this.commandId = commandId;
        this.locker = locker;
        this.compartmentId = compartmentId;
        this.commandType = commandType != null ? commandType : "OPEN_DOOR";
        this.sentAt = sentAt;
        this.ackReceivedAt = ackReceivedAt;
        this.status = status != null ? status : "SENT";
        this.triggeredBy = triggeredBy;
        this.orderId = orderId;
    }

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    private Locker locker;

    @Column(name = "compartment_id", nullable = false)
    private Integer compartmentId;

    @Column(name = "command_type", nullable = false, length = 30)
    @Builder.Default
    private String commandType = "OPEN_DOOR";

    @CreationTimestamp
    @Column(name = "sent_at", updatable = false)
    private LocalDateTime sentAt;

    @Column(name = "ack_received_at")
    private LocalDateTime ackReceivedAt;

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "SENT"; // SENT, SUCCESS, TIMEOUT

    /**
     * GĐ9 — AI đã ra lệnh mở tủ (giá trị do tầng nghiệp vụ truyền vào, ví dụ
     * {@code CUSTOMER_OTP}, {@code SHIPPER_DEPOSIT}, {@code EMERGENCY_OVERRIDE},
     * {@code API_MANUAL}).
     *
     * <p><b>NULLABLE có chủ đích:</b> bảng đã có 31 bản ghi từ trước khi cột này tồn tại. Thêm
     * NOT NULL sẽ làm {@code ddl-auto=update} không thể ALTER trên dữ liệu cũ ⇒ app không khởi
     * động. 31 dòng cũ sẽ mãi NULL — đó là sự thật dữ liệu, không phải lỗi.
     */
    @Column(name = "triggered_by", length = 30)
    private String triggeredBy;

    /**
     * GĐ9 — mã đơn hàng liên quan tới lệnh mở (nếu có).
     *
     * <p><b>Cố ý là {@code String} trần, KHÔNG {@code @ManyToOne} sang {@code Order}:</b> UI chỉ
     * cần hiện mã đơn để tra ra tên khách. Thêm quan hệ JPA là thêm một đường N+1 và một ràng
     * buộc khoá ngoại mới trên bảng nhật ký — trong khi nhật ký phải ghi được cả khi đơn đã bị
     * xoá/đổi mã.
     */
    @Column(name = "order_id", length = 50)
    private String orderId;
}
