package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * GĐ64a — thông báo lưu ở MÁY CHỦ (thay cho chuông đọc {@code localStorage}).
 *
 * <p>Người nhận là MỘT trong hai: {@code recipientPhone} (khách — theo {@code order.customerPhone})
 * hoặc {@code recipientRole} (vd {@code SHIPPER} — dùng chung trạng thái đã đọc cho cả vai, chấp
 * nhận vì demo chỉ có 1 shipper). Danh tính người đọc luôn lấy từ phiên đăng nhập, không từ client.
 *
 * <p>{@code orderId} là chuỗi trần, KHÔNG phải khoá ngoại — giống {@code command_logs.order_id}:
 * thông báo vẫn phải đọc được khi đơn đã bị xoá/đổi mã.
 */
@Entity
@Table(name = "notifications", indexes = {
        @Index(name = "idx_notifications_phone_created", columnList = "recipient_phone, created_at"),
        @Index(name = "idx_notifications_role_created", columnList = "recipient_role, created_at")
})
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "recipient_phone", length = 20)
    private String recipientPhone;

    @Column(name = "recipient_role", length = 20)
    private String recipientRole;

    @Column(name = "type", nullable = false, length = 40)
    private String type;

    @Column(name = "title", nullable = false, length = 200)
    private String title;

    @Column(name = "message", nullable = false, length = 1000)
    private String message;

    @Column(name = "order_id", length = 50)
    private String orderId;

    /** {@code qr} / {@code otp} — web dùng để mở đúng modal khi bấm thông báo. */
    @Column(name = "method", length = 10)
    private String method;

    @Builder.Default
    @Column(name = "is_read", nullable = false)
    private Boolean isRead = false;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
