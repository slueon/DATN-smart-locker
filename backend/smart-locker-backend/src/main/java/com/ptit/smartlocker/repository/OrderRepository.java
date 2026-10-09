package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface OrderRepository extends JpaRepository<Order, String> {
    List<Order> findByCustomerPhone(String customerPhone);
    List<Order> findByLocker_LockerIdAndStatus(String lockerId, String status);
    List<Order> findByStatus(String status);

    /**
     * Tìm các đơn hàng đã gửi vào tủ nhưng quá hạn 24h00 của ngày N+1
     */
    @Query("SELECT o FROM Order o WHERE o.status = 'DEPOSITED' AND o.expiryDeadline < :now")
    List<Order> findOverdueOrders(LocalDateTime now);

    Optional<Order> findByOrderId(String orderId);
}
