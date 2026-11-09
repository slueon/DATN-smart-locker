package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Builder;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * W2 — Phiên đăng nhập bằng token opaque lưu trong CSDL.
 *
 * Không dùng JWT (xem DECISIONS dòng 22): token là chuỗi ngẫu nhiên 32 byte
 * được sinh ở AuthService khi đăng nhập, lưu nguyên vào bảng auth_sessions.
 * TokenAuthFilter sẽ tra bảng này ở mỗi request để dựng SecurityContext.
 *
 * Vòng đời: createdAt -> expiresAt (TTL 8 giờ). revoked = true nghĩa là đã
 * bị thu hồi trước hạn; đợt này chưa có endpoint revoke (xem R6 trong plan).
 */
@Entity
@Table(
        name = "auth_sessions",
        indexes = {
                @Index(name = "idx_auth_sessions_token", columnList = "token", unique = true),
                @Index(name = "idx_auth_sessions_expires_at", columnList = "expires_at")
        }
)
@Getter
@Setter
@Builder
public class AuthSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "session_id")
    private Long sessionId;

    public AuthSession() {
    }

    public AuthSession(Long sessionId, String token, User user, String role,
                       LocalDateTime createdAt, LocalDateTime expiresAt, Boolean revoked) {
        this.sessionId = sessionId;
        this.token = token;
        this.user = user;
        this.role = role;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
        this.revoked = revoked != null ? revoked : false;
    }

    /** Token Bearer thô (Base64URL 32 byte) — unique, dùng để tra ở mỗi request. */
    @Column(name = "token", nullable = false, unique = true, length = 255)
    private String token;

    /** Chủ phiên. Chỉ cần id/username/role nên để ManyToOne mặc định (LAZY-ish tuỳ Hibernate). */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** Bản sao vai trò tại thời điểm cấp token, ví dụ 'ADMIN' / 'SHIPPER' / 'CUSTOMER'. */
    @Column(name = "role", nullable = false, length = 20)
    private String role;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    /** Hết hạn sau 8 giờ. Filter coi expiresAt <= now là token chết. */
    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "revoked", nullable = false)
    @Builder.Default
    private Boolean revoked = false;
}
