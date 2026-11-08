package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
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

    /**
     * Nạp đơn hàng KÈM ngăn tủ trong cùng một truy vấn.
     *
     * <p>Dùng cho luồng MQTT (`MqttService.handleEmbeddedHardwareMessage`): callback của Paho
     * chạy trên thread riêng, KHÔNG có Hibernate session → gọi `order.getCompartment()` trên
     * entity nạp bằng `findById` sẽ ném `LazyInitializationException` (proxy chưa khởi tạo).
     * `left join fetch` nạp sẵn nên không cần session khi truy cập.
     */
    @Query("SELECT o FROM Order o LEFT JOIN FETCH o.compartment WHERE o.orderId = :orderId")
    Optional<Order> findByIdWithCompartment(@Param("orderId") String orderId);

    /**
     * Như {@link #findByLocker_LockerIdAndStatus} nhưng nạp sẵn ngăn tủ.
     *
     * <p>Dùng cho nhánh `/event` của MQTT: cùng lý do như `findByIdWithCompartment` —
     * callback Paho chạy ngoài Hibernate session, `ord.getCompartment()` trên entity lazy
     * sẽ ném `LazyInitializationException` khi payload báo nạp/nhận hàng thành công.
     */
    @Query("SELECT o FROM Order o LEFT JOIN FETCH o.compartment "
            + "WHERE o.locker.lockerId = :lockerId AND o.status = :status")
    List<Order> findByLockerAndStatusWithCompartment(@Param("lockerId") String lockerId,
                                                     @Param("status") String status);

    /**
     * T3 — tra đơn theo MÃ VẬN ĐƠN (mã in trên nhãn), nạp sẵn ngăn + tủ.
     *
     * <p>Dùng ở luồng quét nhãn tại tủ: callback Paho chạy ngoài Hibernate session, nên
     * mọi quan hệ cần đọc (`getCompartment()`, `getLocker()`) phải nạp sẵn — nếu không sẽ
     * ném {@code LazyInitializationException}.
     */
    @Query("SELECT o FROM Order o LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker "
            + "WHERE o.trackingCode = :trackingCode")
    Optional<Order> findByTrackingCode(@Param("trackingCode") String trackingCode);

    /**
     * T3 — đơn PENDING kèm ngăn + tủ nạp sẵn, lọc theo tủ (null/ALL = mọi tủ).
     *
     * <p>Phục vụ `GET /api/shipper/orders/pending` và nhánh quét nhãn. Tách khỏi
     * {@link #findByLockerAndStatusWithCompartment} vì truy vấn này nạp cả `locker` để
     * đọc được `lockerId` sau khi session đã đóng, và cho phép không lọc tủ.
     */
    @Query("SELECT o FROM Order o LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker "
            + "WHERE o.status = :status")
    List<Order> findByStatusWithCompartment(@Param("status") String status);
}
