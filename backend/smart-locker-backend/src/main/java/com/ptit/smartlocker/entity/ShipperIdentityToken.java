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
        this.tokenId = tokenId;
        this.shipperId = shipperId;
        this.dynamicToken = dynamicToken;
        this.createdAt = createdAt;
        this.expiredAt = expiredAt;
        this.isVerified = isVerified != null ? isVerified : false;
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
}
