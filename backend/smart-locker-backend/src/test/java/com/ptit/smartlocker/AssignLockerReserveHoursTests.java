package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ23 — `assign-locker` (luồng shipper CHỌN TỦ) phải chọn được thời hạn 1 giờ / 2 giờ.
 *
 * <p><b>Vì sao cần test riêng:</b> trước GĐ23 luồng này chỉ set {@code shipper_reserved_at} mà
 * không set {@code reserve_expires_at}, nên mọi đơn chọn tủ bị khoá cứng theo hằng số toàn cục
 * 120 phút — shipper không chọn được 1 giờ. Đây là đường shipper dùng nhiều nhất (chọn tủ), nên
 * thiếu hạn ở đây là thiếu ở luồng chính.
 */
@SpringBootTest
@Transactional
class AssignLockerReserveHoursTests {

    @Autowired private ShipperService shipperService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElseThrow();
    }

    /** Tạo đơn PENDING chưa gán tủ để `assignLocker` gán vào. */
    private Order taoDonTrong(String orderId) {
        Order order = Order.builder()
                .orderId(orderId)
                .customerName("Khách Assign Test")
                .customerPhone("0912000111")
                .deliveryType("LOCKER")
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(10000))
                .productName("Kiện test assign")
                .build();
        return orderRepository.save(order);
    }

    /** Giải phóng mọi ngăn của tủ để test không phụ thuộc dữ liệu tồn. */
    private void giaiPhongNgan() {
        for (Compartment c : compartmentRepository.findByLocker_LockerId(locker.getLockerId())) {
            c.setStatus("EMPTY");
            compartmentRepository.save(c);
        }
    }

    @Test
    @DisplayName("GĐ23: assign-locker reserveHours=1 → hạn lệch đúng 60 phút so với shipper_reserved_at")
    void assignMotGio() {
        giaiPhongNgan();
        Order don = taoDonTrong("ORD-AS-1H");

        OrderDTO.OrderResponse res = shipperService.assignLocker(
                don.getOrderId(), locker.getLockerId(), null, 1);

        Order sau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertNotNull(sau.getShipperReservedAt(), "Phải có dấu đặt trước");
        assertNotNull(sau.getReserveExpiresAt(),
                "THIẾU HẠN là đúng lỗi GĐ23 — assign-locker phải set reserve_expires_at");
        assertEquals(60,
                Duration.between(sau.getShipperReservedAt(), sau.getReserveExpiresAt()).toMinutes(),
                "reserveHours=1 phải lệch đúng 60 phút");
        assertNotNull(res.getReserveExpiresAt(), "Response phải trả hạn để web hiện giờ");
    }

    @Test
    @DisplayName("GĐ23: assign-locker reserveHours=2 → lệch đúng 120 phút")
    void assignHaiGio() {
        giaiPhongNgan();
        Order don = taoDonTrong("ORD-AS-2H");

        shipperService.assignLocker(don.getOrderId(), locker.getLockerId(), null, 2);

        Order sau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertEquals(120,
                Duration.between(sau.getShipperReservedAt(), sau.getReserveExpiresAt()).toMinutes(),
                "reserveHours=2 phải lệch đúng 120 phút");
    }

    @Test
    @DisplayName("GĐ23: assign-locker KHÔNG gửi reserveHours → mặc định 2 giờ (120 phút)")
    void assignMacDinhHaiGio() {
        giaiPhongNgan();
        Order don = taoDonTrong("ORD-AS-DEF");

        shipperService.assignLocker(don.getOrderId(), locker.getLockerId(), null, null);

        Order sau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertEquals(120,
                Duration.between(sau.getShipperReservedAt(), sau.getReserveExpiresAt()).toMinutes(),
                "Thiếu reserveHours phải mặc định 2 giờ, giữ hành vi 120 phút cũ");
    }

    @Test
    @DisplayName("GĐ23: assign-locker reserveHours=5 → từ chối, KHÔNG gán tủ, KHÔNG set hạn")
    void assignGiaTriSai() {
        giaiPhongNgan();
        Order don = taoDonTrong("ORD-AS-5H");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> shipperService.assignLocker(don.getOrderId(), locker.getLockerId(), null, 5),
                "reserveHours ngoài {1,2} phải bị từ chối, không âm thầm kẹp");
        assertTrue(ex.getMessage().contains("1 hoặc 2"),
                "Message phải nêu rõ chỉ nhận 1 hoặc 2: " + ex.getMessage());

        // Đơn KHÔNG được thay đổi gì: nếu set hạn trước rồi mới validate thì đây là dữ liệu rác.
        Order sau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertNull(sau.getShipperReservedAt(), "Bị từ chối thì không được gán dấu đặt trước");
        assertNull(sau.getReserveExpiresAt(), "Bị từ chối thì không được ghi hạn");
        assertNull(sau.getLocker(), "Bị từ chối thì không được gán tủ");
    }
}
