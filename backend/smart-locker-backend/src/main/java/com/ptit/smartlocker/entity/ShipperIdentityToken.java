package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "shipper_identity_tokens")
@Getter
@Setter
@Builder
public class ShipperIdentityToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "token_id")
    private Long tokenId;

    public ShipperIdentityToken() {}

    public ShipperIdentityToken(Long tokenId, String shipperId, String dynamicToken, LocalDateTime createdAt, LocalDateTime expiredAt, Boolean isVerified) {
        this(tokenId, shipperId, dynamicToken, createdAt, expiredAt, isVerified, null);
    }

    public ShipperIdentityToken(Long tokenId, String shipperId, String dynamicToken, LocalDateTime createdAt,
                                LocalDateTime expiredAt, Boolean isVerified, String lockerId) {
        this.tokenId = tokenId;
        this.shipperId = shipperId;
        this.dynamicToken = dynamicToken;
        this.createdAt = createdAt;
        this.expiredAt = expiredAt;
        this.isVerified = isVerified != null ? isVerified : false;
        this.lockerId = lockerId;
    }

    @Column(name = "shipper_id", nullable = false, length = 50)
    private String shipperId;

    @Column(name = "dynamic_token", nullable = false, unique = true)
    private String dynamicToken;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "expired_at", nullable = false)
    private LocalDateTime expiredAt; // 60 seconds lifespan

    @Column(name = "is_verified", nullable = false)
    @Builder.Default
    private Boolean isVerified = false;

    /**
     * Tủ mà shipper đã quét mã để xác thực (gán lúc {@code verifyDynamicToken}).
     *
     * <p>NULL khi mã chưa được quét ở tủ nào. Bắt buộc phải có để chặn lỗi
     * "shipper xác thực ở tủ A rồi mở cửa tủ B": token chỉ có giá trị tại đúng tủ đã quét.
     */
    @Column(name = "locker_id", length = 50)
    private String lockerId;
}
