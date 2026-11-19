package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;

import java.time.LocalDateTime;

@Entity
@Table(name = "pickup_credentials")
@Getter
@Setter
@Builder
public class PickupCredential {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "credential_id")
    private Long credentialId;

    public PickupCredential() {}

    public PickupCredential(Long credentialId, Order order, String qrToken, String otpCode, Boolean isUsed, Integer failedAttempts, LocalDateTime expiredAt, LocalDateTime otpExpiredAt, LocalDateTime usedAt) {
        this.credentialId = credentialId;
        this.order = order;
        this.qrToken = qrToken;
        this.otpCode = otpCode;
        this.isUsed = isUsed != null ? isUsed : false;
        this.failedAttempts = failedAttempts != null ? failedAttempts : 0;
        this.expiredAt = expiredAt;
        this.otpExpiredAt = otpExpiredAt;
        this.usedAt = usedAt;
    }

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "qr_token", nullable = false, unique = true)
    private String qrToken;

    @Column(name = "otp_code", nullable = false, length = 10)
    private String otpCode;

    @Column(name = "is_used", nullable = false)
    @Builder.Default
    private Boolean isUsed = false;

    @Column(name = "failed_attempts", nullable = false)
    @Builder.Default
    private Integer failedAttempts = 0;

    /**
     * GĐ69 — hạn của MÃ NHẬN HÀNG (QR + OTP), = hạn lưu kho của đơn.
     *
     * <p>Trước GĐ69 cột này bị {@code request-otp} ghi đè thành {@code now + 5 phút} nên xin OTP
     * làm chết luôn QR. Từ GĐ69 nó CHỈ được đặt lúc nạp hàng / tạo đơn, không bao giờ do OTP.
     */
    @Column(name = "expired_at", nullable = false)
    private LocalDateTime expiredAt;

    /**
     * GĐ69 — hạn RIÊNG của OTP ({@code request-otp} → {@code min(now + 5 phút, expiredAt)}).
     *
     * <p>{@code NULL} = chưa từng cấp OTP (hoặc OTP cũ đã bị xoá) ⇒ đường OTP từ chối, đường QR
     * không bị ảnh hưởng. Cố ý cho phép NULL: mọi credential tạo trước GĐ69 đều chưa có giá trị,
     * đặt {@code NOT NULL} sẽ làm app không khởi động được trên DB đang có đơn.
     */
    @Column(name = "otp_expired_at")
    private LocalDateTime otpExpiredAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;
}
