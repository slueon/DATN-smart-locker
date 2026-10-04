package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "shipper_identity_tokens")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShipperIdentityToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "token_id")
    private Long tokenId;

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
