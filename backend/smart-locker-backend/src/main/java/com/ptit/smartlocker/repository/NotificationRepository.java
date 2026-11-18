package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Notification;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

/**
 * GĐ64a — truy vấn thông báo. "Của mình" = {@code recipient_phone} khớp SĐT HOẶC
 * {@code recipient_role} khớp vai của người đang đăng nhập. Tham số {@code null} không khớp dòng
 * nào (so sánh SQL với NULL luôn sai), nên người không có SĐT/vai không thấy gì thừa.
 */
@Repository
public interface NotificationRepository extends JpaRepository<Notification, Long> {

    @Query("SELECT n FROM Notification n WHERE n.recipientPhone = :phone OR n.recipientRole = :role "
            + "ORDER BY n.createdAt DESC, n.id DESC")
    List<Notification> findMine(@Param("phone") String phone, @Param("role") String role, Pageable pageable);

    @Query("SELECT COUNT(n) FROM Notification n WHERE (n.recipientPhone = :phone OR n.recipientRole = :role) "
            + "AND n.isRead = false")
    long countUnreadMine(@Param("phone") String phone, @Param("role") String role);

    @Modifying
    @Query("UPDATE Notification n SET n.isRead = true WHERE (n.recipientPhone = :phone OR n.recipientRole = :role) "
            + "AND n.isRead = false")
    int markAllReadMine(@Param("phone") String phone, @Param("role") String role);

    /**
     * Chống trùng: đã có dòng cùng loại + đơn + người nhận (+ cách nhận) từ mốc {@code since}?
     * Viết JPQL tay để so khớp NULL đúng nghĩa ("cùng là NULL" cũng tính là trùng).
     */
    @Query("SELECT COUNT(n) > 0 FROM Notification n WHERE n.type = :type "
            + "AND ((:orderId IS NULL AND n.orderId IS NULL) OR n.orderId = :orderId) "
            + "AND ((:phone IS NULL AND n.recipientPhone IS NULL) OR n.recipientPhone = :phone) "
            + "AND ((:role IS NULL AND n.recipientRole IS NULL) OR n.recipientRole = :role) "
            + "AND ((:method IS NULL AND n.method IS NULL) OR n.method = :method) "
            + "AND n.createdAt >= :since")
    boolean existsRecent(@Param("type") String type,
                         @Param("orderId") String orderId,
                         @Param("phone") String phone,
                         @Param("role") String role,
                         @Param("method") String method,
                         @Param("since") LocalDateTime since);
}
