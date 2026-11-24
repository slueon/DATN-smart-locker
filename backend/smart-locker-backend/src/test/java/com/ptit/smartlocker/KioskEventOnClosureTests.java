package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.KioskEventService;
import com.ptit.smartlocker.service.MqttService;
import com.ptit.smartlocker.service.ShipperService;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ42 — SỰ KIỆN PHẢI BẮN KHI SHIPPER QUÊN NẠP HÀNG.
 *
 * <p>Trước GĐ42 {@code chotPhienNapHang} nhánh {@code !conHang} đổi DB đúng (đơn về
 * {@code PENDING}, ngăn {@code EMPTY}, xoá dấu đặt trước) nhưng <b>không bắn sự kiện nào</b>. Đo
 * thật: {@code kiosk-events} trả <b>0 sự kiện</b> ⇒ web shipper không biết gì, phải F5 (đúng lỗi
 * user báo "nạp hàng xong web đứng yên").
 *
 * <p>Test khoá: (1) đóng cửa KHÔNG hàng → có {@code DEPOSIT_LEFT_EMPTY}; (2) đóng cửa CÓ hàng →
 * {@code DEPOSITED} và <b>không</b> có {@code DEPOSIT_LEFT_EMPTY} (tránh báo nhầm thất bại).
 */
@SpringBootTest
@Transactional
class KioskEventOnClosureTests {

    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private ShipperService shipperService;
    @Autowired private MqttService mqttService;
    @Autowired private KioskEventService kioskEventService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private com.ptit.smartlocker.repository.ShipperIdentityTokenRepository tokenRepository;

    private Order order;
    private Compartment compartment;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        compartment = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1)
                .orElseThrow(() -> new AssertionError("Seed phải có ngăn #1"));
        compartment.setStatus("RESERVED");
        compartmentRepository.save(compartment);

        order = orderRepository.save(Order.builder()
                .orderId("ORD-V42-KIOSK")
                .customerName("Khách Test GĐ42")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(compartment)
                .expectedDate(LocalDate.now())
                .status("PENDING_OPENED")
                .shipperReservedAt(LocalDateTime.now())
                .reserveExpiresAt(LocalDateTime.now().plusHours(2))
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ42")
                .build());
    }

    /** Các sự kiện PHÁT SINH SAU mốc {@code moc} của đúng tủ này. */
    private java.util.List<com.ptit.smartlocker.dto.KioskEvent> suKienSau(long moc) {
        return kioskEventService.since(LOCKER, moc);
    }

    private long moc() {
        return kioskEventService.latestSeq();
    }

    @Test
    @DisplayName("GĐ42 (1): đóng cửa KHÔNG có hàng → bắn DEPOSIT_LEFT_EMPTY + đơn về PENDING + ngăn EMPTY")
    void khongBoHangThiBanSuKienThatBai() {
        long truoc = moc();

        boolean daNap = shipperService.chotPhienNapHang(order, compartment, false);

        assertFalse(daNap, "Không có hàng thì không phải nạp thành công");

        var events = suKienSau(truoc);
        var loai = events.stream().map(com.ptit.smartlocker.dto.KioskEvent::getType).toList();
        assertTrue(loai.contains(KioskEventService.DEPOSIT_LEFT_EMPTY),
                "Phải bắn DEPOSIT_LEFT_EMPTY để web shipper biết — trước GĐ42 là 0 sự kiện. Có: " + loai);

        var ev = events.stream()
                .filter(e -> KioskEventService.DEPOSIT_LEFT_EMPTY.equals(e.getType()))
                .findFirst().orElseThrow();
        assertEquals("ORD-V42-KIOSK", ev.getOrderId(), "Sự kiện phải mang đúng mã đơn");
        assertEquals(1, ev.getCompartment(), "Sự kiện phải mang đúng chỉ số ngăn");
        assertNotNull(ev.getMessage(), "Phải có câu tiếng Việt cho web hiện");
        assertTrue(ev.getMessage().contains("Chưa phát hiện kiện hàng"),
                "Nội dung phải nói rõ chưa có kiện: " + ev.getMessage());

        assertEquals("PENDING", orderRepository.findById("ORD-V42-KIOSK").orElseThrow().getStatus());
        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("Firmware báo deposit_cancelled → chốt thất bại và báo shipper ngay")
    void firmwareDepositCancelledThiChotThatBai() {
        long truoc = moc();

        String payload = "{\"locker_id\":\"Tu_1\",\"status\":\"deposit_cancelled\",\"compartment\":1}";
        mqttService.messageArrived("ptit/Tu_1/compartment/1/event",
                new MqttMessage(payload.getBytes(StandardCharsets.UTF_8)));

        assertEquals("PENDING", orderRepository.findById("ORD-V42-KIOSK").orElseThrow().getStatus());
        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus());
        assertTrue(suKienSau(truoc).stream()
                        .anyMatch(e -> KioskEventService.DEPOSIT_LEFT_EMPTY.equals(e.getType())),
                "deposit_cancelled của firmware phải được chuyển thành failure event cho web shipper");
    }

    @Test
    @DisplayName("GĐ42 (2): đóng cửa CÓ hàng → DEPOSITED, KHÔNG bắn DEPOSIT_LEFT_EMPTY (không báo nhầm thất bại)")
    void coHangThiKhongBanSuKienThatBai() {
        long truoc = moc();

        boolean daNap = shipperService.chotPhienNapHang(order, compartment, true);

        assertTrue(daNap);
        var loai = suKienSau(truoc).stream()
                .map(com.ptit.smartlocker.dto.KioskEvent::getType).toList();
        assertFalse(loai.contains(KioskEventService.DEPOSIT_LEFT_EMPTY),
                "Nạp THÀNH CÔNG mà báo 'chưa có kiện' là sai — có: " + loai);

        assertEquals("DEPOSITED", orderRepository.findById("ORD-V42-KIOSK").orElseThrow().getStatus());
        assertEquals("OCCUPIED",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ42: đơn KHÔNG ở PENDING_OPENED → không bắn sự kiện nào")
    void donKhacTrangThaiThiKhongBan() {
        order.setStatus("PENDING");
        orderRepository.save(order);
        long truoc = moc();

        boolean ketQua = shipperService.chotPhienNapHang(order, compartment, false);

        assertFalse(ketQua);
        var loai = suKienSau(truoc).stream()
                .map(com.ptit.smartlocker.dto.KioskEvent::getType).toList();
        assertFalse(loai.contains(KioskEventService.DEPOSIT_LEFT_EMPTY),
                "Không mở phiên thì không được báo thất bại: " + loai);
    }

    // ─────────────────────────────────────────────────────────────
    // GĐ42 VÒNG 2 — ĐƯỜNG NẠP QUA **API** CŨNG PHẢI BẮN DEPOSIT_SUCCESS
    // ─────────────────────────────────────────────────────────────

    /**
     * Trước vòng 2, `DEPOSIT_SUCCESS` chỉ bắn từ nhánh MQTT `deposit_success` (đường firmware
     * báo). Đường API — đúng đường web shipper dùng — **không** bắn sự kiện nào, nên web chỉ cập
     * nhật nhờ nhịp dự phòng 10 s. Minh đo được **3738 ms / 3602 ms** (vượt ngưỡng ≤3 s).
     */
    private com.ptit.smartlocker.entity.ShipperIdentityToken taoTokenDaQuet(String token) {
        var now = LocalDateTime.now();
        return tokenRepository.save(com.ptit.smartlocker.entity.ShipperIdentityToken.builder()
                .shipperId("shipper").dynamicToken(token)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
    }

    @Test
    @DisplayName("GĐ42 vòng 2 (1): nạp qua API → BẮN DEPOSIT_SUCCESS (để web cập nhật ≤3s)")
    void napQuaApiThiBanDepositSuccess() {
        long truoc = kioskEventService.latestSeq();

        // đơn PENDING đã đặt trước ở ngăn 1 (đường `depositPackage`, không phải Kiosk)
        Order don = orderRepository.save(Order.builder()
                .orderId("ORD-V42-API")
                .customerName("Khách Test GĐ42")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(lockerRepository.findById(LOCKER).orElseThrow())
                .compartment(compartment)
                .expectedDate(java.time.LocalDate.now())
                .status("PENDING")
                .totalAmount(java.math.BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ42 API")
                .build());
        compartment.setStatus("EMPTY");
        compartmentRepository.save(compartment);
        taoTokenDaQuet("SHIP-GD42-API");

        var req = com.ptit.smartlocker.dto.ShipperDTO.DepositPackageRequest.builder()
                .lockerId(LOCKER)
                .dynamicToken("SHIP-GD42-API")
                .orderId("ORD-V42-API")
                .weightGrams(900.0)
                .isDoorClosed(true)
                .build();

        var resp = shipperService.depositPackage(req);
        assertTrue(resp.isSuccess(), "Nạp qua API phải thành công");

        var loai = suKienSau(truoc).stream()
                .map(com.ptit.smartlocker.dto.KioskEvent::getType).toList();
        assertTrue(loai.contains(KioskEventService.DEPOSIT_SUCCESS),
                "Đường API PHẢI bắn DEPOSIT_SUCCESS — nếu không, web shipper chỉ cập nhật nhờ nhịp "
                        + "dự phòng 10s (minh đo được 3738ms > ngưỡng 3s). Có: " + loai);

        var ev = suKienSau(truoc).stream()
                .filter(e -> KioskEventService.DEPOSIT_SUCCESS.equals(e.getType()))
                .findFirst().orElseThrow();
        assertEquals("ORD-V42-API", ev.getOrderId(), "Sự kiện phải mang đúng mã đơn");
        assertEquals(1, ev.getCompartment(), "Sự kiện phải mang đúng chỉ số ngăn");
        assertTrue(ev.getMessage() != null && ev.getMessage().contains("Nạp hàng thành công"),
                "Nội dung phải nói rõ nạp thành công: " + ev.getMessage());
    }

    @Test
    @DisplayName("GĐ42 vòng 2 (2): đơn PENDING lỗi (không phải PENDING) → KHÔNG bắn DEPOSIT_SUCCESS")
    void napThatBaiThiKhongBanSuccess() {
        long truoc = kioskEventService.latestSeq();
        taoTokenDaQuet("SHIP-GD42-FAIL");

        var req = com.ptit.smartlocker.dto.ShipperDTO.DepositPackageRequest.builder()
                .lockerId(LOCKER)
                .dynamicToken("SHIP-GD42-FAIL")
                .orderId("ORD-KHONG-TON-TAI-GD42")
                .weightGrams(900.0)
                .isDoorClosed(true)
                .build();

        assertThrows(RuntimeException.class, () -> shipperService.depositPackage(req),
                "Đơn không tồn tại thì phải ném lỗi");

        var loai = suKienSau(truoc).stream()
                .map(com.ptit.smartlocker.dto.KioskEvent::getType).toList();
        assertFalse(loai.contains(KioskEventService.DEPOSIT_SUCCESS),
                "Nạp THẤT BẠI mà báo thành công là sai — web sẽ hiện popup nạp hàng khi hàng chưa vào tủ. Có: " + loai);
    }
}
