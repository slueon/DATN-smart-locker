package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.ReservationTimeoutService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ31b — TH1: SHIPPER MỞ TỦ RỒI ĐÓNG LẠI MÀ KHÔNG BỎ HÀNG.
 *
 * <p>Trước GĐ31b ca này rơi vào khoảng lặng: đơn vẫn {@code PENDING}, ngăn vẫn {@code RESERVED}
 * tới hết hạn đặt trước (1-2 giờ) dù biết chắc ngăn trống; shipper không được báo gì.
 *
 * <p>Luật mới: mở cửa → đơn {@code PENDING_OPENED}; cửa đóng + cảm biến:
 * <ul>
 *   <li>có hàng → {@code DEPOSITED}, ngăn {@code OCCUPIED};</li>
 *   <li>không có hàng → nhả ngăn {@code EMPTY}, xoá dấu đặt trước + hạn, đơn về {@code PENDING}.</li>
 * </ul>
 */
@SpringBootTest
@Transactional
class ShipperOpenedNoDepositTests {

    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private ShipperService shipperService;
    @Autowired private ReservationTimeoutService reservationTimeoutService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;

    private Order order;
    private Compartment compartment;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        compartment = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        compartment.setStatus("RESERVED");
        compartmentRepository.save(compartment);

        order = orderRepository.save(Order.builder()
                .orderId("ORD-GD31B-EMPTY")
                .customerName("Khách Test GĐ31b")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(compartment)
                .expectedDate(LocalDate.now())
                .status("PENDING_OPENED")
                .shipperReservedAt(LocalDateTime.now())
                .reserveExpiresAt(LocalDateTime.now().plusHours(2))
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ31b")
                .build());
    }

    @Test
    @DisplayName("GĐ31b (2): đóng cửa KHÔNG có hàng → ngăn EMPTY, đơn PENDING, 2 cột đặt trước NULL")
    void khongBoHangThiNhaNgan() {
        boolean daNap = shipperService.chotPhienNapHang(order, compartment, false);

        assertFalse(daNap, "Không có hàng thì không được coi là nạp thành công");

        Order sau = orderRepository.findById("ORD-GD31B-EMPTY").orElseThrow();
        assertEquals("PENDING", sau.getStatus(), "Đơn phải về PENDING để shipper chọn lại tủ/ngăn");
        assertNull(sau.getShipperReservedAt(), "Phải xoá dấu đặt trước");
        assertNull(sau.getReserveExpiresAt(), "Phải xoá hạn giữ chỗ");
        assertNull(sau.getCompartment(), "Đơn không còn giữ ngăn nào");

        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn phải được nhả về EMPTY ngay, không bắt shipper chờ hết hạn");
    }

    @Test
    @DisplayName("GĐ31b (3): đóng cửa CÓ hàng → DEPOSITED + ngăn OCCUPIED (không regression)")
    void coHangThiDeposited() {
        boolean daNap = shipperService.chotPhienNapHang(order, compartment, true);

        assertTrue(daNap, "Có hàng thì phải chốt DEPOSITED");
        Order sau = orderRepository.findById("ORD-GD31B-EMPTY").orElseThrow();
        assertEquals("DEPOSITED", sau.getStatus());
        assertNotNull(sau.getDepositedAt(), "Phải ghi mốc nạp hàng");
        assertNotNull(sau.getExpiryDeadline(), "Phải đặt hạn lưu kho");
        assertEquals("OCCUPIED",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ31b: đơn không ở PENDING_OPENED thì hàm chốt không làm gì")
    void donKhacTrangThaiThiBoQua() {
        order.setStatus("PENDING");
        orderRepository.save(order);

        boolean ketQua = shipperService.chotPhienNapHang(order, compartment, false);

        assertFalse(ketQua);
        assertEquals("PENDING", orderRepository.findById("ORD-GD31B-EMPTY").orElseThrow().getStatus(),
                "Không được nhả ngăn của đơn chưa mở phiên nạp");
        assertEquals("RESERVED",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn còn đang giữ chỗ của đơn PENDING thì không được nhả");
    }

    @Test
    @DisplayName("GĐ31b (10): đơn PENDING_OPENED KHÔNG bị ReservationTimeoutService nhả dù quá hạn")
    void phienDangMoKhongBiNha() {
        // Đặt hạn đặt trước đã trôi qua rất lâu.
        order.setShipperReservedAt(LocalDateTime.now().minusHours(5));
        order.setReserveExpiresAt(LocalDateTime.now().minusHours(5));
        orderRepository.save(order);

        reservationTimeoutService.releaseExpiredReservations();

        Order sau = orderRepository.findById("ORD-GD31B-EMPTY").orElseThrow();
        assertEquals("PENDING_OPENED", sau.getStatus(),
                "Đang trong phiên nạp (cửa mở) thì KHÔNG được tự nhả — điều cấm #3");
        assertNotNull(sau.getShipperReservedAt(),
                "Dấu đặt trước phải còn vì shipper đang thao tác");
    }
}
