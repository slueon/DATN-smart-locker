package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Order;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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
     * Như {@link #findExpiredShipperReservations} nhưng KHÓA BI QUAN từng đơn ({@code SELECT ... FOR UPDATE}).
     *
     * <p>Lý do: tác vụ nhả ngăn chạy song song với luồng shipper nạp hàng ({@code depositPackage}).
     * Nếu không khoá, hai bên cùng đọc một {@code Order} rồi cùng ghi đè — tác vụ nhả ngăn có thể
     * biến ngăn vừa được nạp hàng ({@code OCCUPIED}) trở lại {@code EMPTY} và xoá dấu ngăn của đơn
     * đã {@code DEPOSITED}. Không có {@code @Version} trên entity nên Hibernate không tự phát hiện.
     *
     * <p>Bắt buộc gọi trong một transaction NGẮN cho từng đơn, không bọc cả lượt quét.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM Order o "
            + "LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker "
            + "WHERE o.orderId = :orderId")
    Optional<Order> findByIdForReleaseWithLock(@Param("orderId") String orderId);

    /**
     * Tìm các đơn hàng đã gửi vào tủ nhưng quá hạn 24h00 của ngày N+1
     */
    @Query("SELECT o FROM Order o WHERE o.status = 'DEPOSITED' AND o.expiryDeadline < :now")
    List<Order> findOverdueOrders(LocalDateTime now);

    /**
     * Các đơn shipper đã đặt trước ngăn nhưng quá hạn giữ chỗ ({@code shipper_reserved_at} cũ hơn mốc).
     *
     * <p>Dùng cho tác vụ tự nhả ngăn: shipper bấm "đặt trước" trên web rồi không đến tủ, ngăn sẽ
     * bị giữ vô thời hạn và khách khác không dùng được. Nạp sẵn {@code compartment} và {@code locker}
     * vì tác vụ chạy ngoài request, tránh {@code LazyInitializationException}.
     */
    @Query("SELECT o FROM Order o "
            + "LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker "
            + "WHERE o.status = 'PENDING' "
            + "AND o.shipperReservedAt IS NOT NULL "
            + "AND o.shipperReservedAt < :cutoff")
    List<Order> findExpiredShipperReservations(@Param("cutoff") LocalDateTime cutoff);

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
     *
     * <p><b>⚠ CẢNH BÁO N+1:</b> query này CHỈ fetch {@code compartment}, <b>KHÔNG</b> fetch
     * {@code locker}. Hiện tại an toàn vì các vòng lặp dùng nó chỉ đọc {@code getCompartment()}.
     * Nếu sau này ai thêm {@code ord.getLocker().getLockerId()} vào trong vòng lặp ở
     * {@code MqttService.handleCompartmentEvent} thì N+1 sẽ quay lại (1 SELECT/đơn).
     * Khi đó dùng {@link #findByLockerAndStatusFetchAll} (fetch cả hai) thay vì thêm fetch ở đây.
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

    /**
     * Đơn theo tủ + trạng thái, NẠP SẴN cả {@code compartment} và {@code locker}.
     *
     * <p><b>Vì sao cần bản riêng:</b> {@link #findByLocker_LockerIdAndStatus} để hai quan hệ ở
     * dạng LAZY. Khi tác vụ quét lặp qua N đơn rồi đọc {@code order.getCompartment()} /
     * {@code order.getLocker()}, Hibernate phát thêm 1 câu SELECT cho MỖI đơn (lỗi N+1). Bản này
     * nạp sẵn trong đúng 1 câu nên tổng số query không tăng theo số đơn.
     */
    @Query("SELECT DISTINCT o FROM Order o LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker "
            + "WHERE o.locker.lockerId = :lockerId AND o.status = :status")
    List<Order> findByLockerAndStatusFetchAll(@Param("lockerId") String lockerId,
                                              @Param("status") String status);

    /**
     * Đơn quá hạn, NẠP SẴN {@code locker} để đọc được {@code lockerId} mà không phát thêm query.
     * Dùng bởi {@code OverdueSchedulerService.scanAndLockOverdueOrders()} — vòng lặp của nó đọc
     * {@code order.getLocker().getLockerId()} cho từng đơn.
     */
    @Query("SELECT DISTINCT o FROM Order o LEFT JOIN FETCH o.locker "
            + "WHERE o.status = 'DEPOSITED' AND o.expiryDeadline < :now")
    List<Order> findOverdueOrdersFetchLocker(@Param("now") LocalDateTime now);

    /**
     * GĐ7 — danh sách đơn cho ADMIN, lọc tuỳ chọn theo trạng thái và theo tủ.
     *
     * <p><b>Nạp sẵn cả {@code compartment} và {@code locker}</b> để {@code mapToOrderResponse}
     * đọc được {@code getCompartment().getCompIndex()} và {@code getLocker().getLockerId()}
     * mà không phát thêm SELECT cho từng đơn — đúng bài học N+1 ở GĐ3. Endpoint này trả cả bảng
     * đơn nên N+1 ở đây sẽ rất đắt.
     *
     * <p>{@code status} null hoặc {@code 'ALL'} = mọi trạng thái; {@code lockerId} null = mọi tủ.
     * Điều kiện viết dạng {@code (:param IS NULL OR ...)} để một câu query phục vụ cả 4 tổ hợp
     * lọc, thay vì 4 hàm riêng.
     */
    @Query("SELECT DISTINCT o FROM Order o LEFT JOIN FETCH o.compartment LEFT JOIN FETCH o.locker l "
            + "WHERE (:status IS NULL OR o.status = :status) "
            + "AND (:lockerId IS NULL OR l.lockerId = :lockerId) "
            + "ORDER BY o.createdAt DESC")
    List<Order> findForAdmin(@Param("status") String status, @Param("lockerId") String lockerId);
}
