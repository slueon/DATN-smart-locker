package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.AuthSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * W2 — tra cứu phiên đăng nhập theo token opaque.
 * Cột token có unique index nên findByToken là truy vấn điểm, không scan bảng.
 */
@Repository
public interface AuthSessionRepository extends JpaRepository<AuthSession, Long> {

    Optional<AuthSession> findByToken(String token);

    /**
     * Lấy session còn sống: chưa revoked và chưa hết hạn.
     * Dùng một truy vấn để filter không phải tự so sánh thời gian sau khi nạp entity.
     */
    @Query("select s from AuthSession s join fetch s.user "
            + "where s.token = :token and s.revoked = false and s.expiresAt > :now")
    Optional<AuthSession> findActiveByToken(@Param("token") String token, @Param("now") LocalDateTime now);

    /** Dọn phiên hết hạn (chưa bật scheduler đợt này — xem R4 trong plan). */
    @Modifying
    @Query("delete from AuthSession s where s.expiresAt <= :now")
    int deleteExpired(@Param("now") LocalDateTime now);
}
