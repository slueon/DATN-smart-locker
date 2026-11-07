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

    public PickupCredential(Long credentialId, Order order, String qrToken, String otpCode, Boolean isUsed, Integer failedAttempts, LocalDateTime expiredAt, LocalDateTime usedAt) {
        this.credentialId = credentialId;
        this.order = order;
        this.qrToken = qrToken;
        this.otpCode = otpCode;
        this.isUsed = isUsed != null ? isUsed : false;
        this.failedAttempts = failedAttempts != null ? failedAttempts : 0;
        this.expiredAt = expiredAt;
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

    @Column(name = "expired_at", nullable = false)
    private LocalDateTime expiredAt;

    @Column(name = "used_at")
    private LocalDateTime usedAt;
}
