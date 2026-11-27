package com.ptit.smartlocker;

import com.ptit.smartlocker.controller.ShipperController;
import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.dto.KioskEvent;
import com.ptit.smartlocker.dto.KioskEventDTO;
import com.ptit.smartlocker.dto.MaintenanceLogDTO;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.MaintenanceLog;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.exception.ResourceNotFoundException;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.MaintenanceLogRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.AuthService;
import com.ptit.smartlocker.service.KioskEventService;
import com.ptit.smartlocker.service.LockerService;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.PickupService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ75 — kiểm chứng các bản sửa bug HIGH/MEDIUM từ đợt dogfood 26–27/11/2026
 * (#3, #9, #12, #13, #15, #16).
 */
@SpringBootTest
@Transactional
class Gd75FixTests {

    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private OrderService orderService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private AuthService authService;
    @Autowired private PickupService pickupService;
    @Autowired private KioskEventService kioskEventService;
    @Autowired private ShipperController shipperController;
    @Autowired private LockerService lockerService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private MaintenanceLogRepository maintenanceLogRepository;

    private OrderDTO.CheckoutRequest request(String payMethod, String payStatus, BigDecimal amount) {
        return new OrderDTO.CheckoutRequest(
                "Khách GĐ75", "0912345675", "LOCKER", LOCKER, LocalDate.now(),
                payMethod, payStatus, "Kiện test GĐ75", null, amount);
    }

    // ── #3 ──────────────────────────────────────────────────────

    @Test
    @DisplayName("#3: totalAmount âm ⇒ IllegalArgumentException, không tạo đơn")
    void soTienAmBiChan() {
        long truoc = orderRepository.count();
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> orderService.createOrder(request("ONLINE_VIETQR", "PAID", BigDecimal.valueOf(-999999))));
        assertTrue(ex.getMessage().contains("âm"));
        assertEquals(truoc, orderRepository.count(), "Không được ghi đơn nào");
    }

    @Test
    @DisplayName("#3: COD gửi kèm paymentStatus=PAID ⇒ server vẫn ghi UNPAID")
    void paymentStatusDoServerQuyet() {
        OrderDTO.OrderResponse res = orderService.createOrder(
                request("COD", "PAID", BigDecimal.valueOf(50000)));
        Order don = orderRepository.findById(res.getOrderId()).orElseThrow();
        assertEquals("UNPAID", don.getPaymentStatus());
    }

    // ── #12 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("#12: không tìm thấy đơn ⇒ ResourceNotFoundException (404); sai SĐT ⇒ AccessDeniedException (403)")
    void maLoiTraCuuDon() {
        assertThrows(ResourceNotFoundException.class,
                () -> orderService.getOrderById("ORD-NOTEXIST", null));

        OrderDTO.OrderResponse res = orderService.createOrder(
                request("ONLINE_VIETQR", null, BigDecimal.valueOf(50000)));
        assertThrows(AccessDeniedException.class,
                () -> orderService.getOrderById(res.getOrderId(), "0999999999"));
    }

    // ── #13 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("#13: login thiếu username ⇒ thông báo nghiệp vụ, không lộ NullPointerException")
    void loginThieuUsername() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> authService.login(new AuthDTO.LoginRequest(null, null)));
        assertFalse(ex.getMessage().contains("String.trim"), "Không được lộ message NPE nội bộ");
    }

    // ── #16 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("#16: hết thời gian khoá ⇒ bộ đếm reset, 1 lần sai không khoá lại trạm")
    @SuppressWarnings("unchecked")
    void boDemResetSauKhiHetKhoa() throws Exception {
        String locker = "LOCKER_GD75_TEST";
        // Bean là proxy CGLIB (@Transactional) ⇒ field nằm ở object gốc, không ở proxy.
        PickupService target = org.springframework.test.util.AopTestUtils.getTargetObject(pickupService);
        Method record = PickupService.class.getDeclaredMethod("recordLockerFailure", String.class);
        record.setAccessible(true);
        Field mapField = PickupService.class.getDeclaredField("lockerFailureMap");
        mapField.setAccessible(true);
        Map<String, Object> map = (Map<String, Object>) mapField.get(target);

        try {
            for (int i = 0; i < 5; i++) record.invoke(target, locker);
            Object tracker = map.get(locker);
            Field until = tracker.getClass().getDeclaredField("lockoutUntil");
            Field failures = tracker.getClass().getDeclaredField("failures");
            until.setAccessible(true);
            failures.setAccessible(true);
            assertNotNull(until.get(tracker), "5 lần sai phải khoá trạm");

            // Giả lập đợt khoá đã hết hạn.
            until.set(tracker, LocalDateTime.now().minusSeconds(1));
            record.invoke(target, locker);

            Object sau = map.get(locker);
            assertEquals(1, failures.getInt(sau), "Sau khi hết khoá phải đếm lại từ 1");
            assertNull(until.get(sau), "1 lần sai sau khi hết khoá KHÔNG được khoá lại");
        } finally {
            map.remove(locker);
        }
    }

    // ── #9 ──────────────────────────────────────────────────────

    @Test
    @DisplayName("#9: shipper chỉ thấy SHIPPER_VERIFIED của QR chính mình; ADMIN thấy tất cả")
    void suKienXacThucLocTheoShipper() {
        long moc = kioskEventService.latestSeq();
        kioskEventService.record(LOCKER, KioskEventService.SHIPPER_VERIFIED,
                null, null, null, null, "ok", "shipper_a");
        kioskEventService.record(LOCKER, KioskEventService.SHIPPER_VERIFIED,
                null, null, null, null, "ok", "shipper_b");
        kioskEventService.record(LOCKER, KioskEventService.SHIPPER_REJECTED,
                null, null, null, null, "QR lạ", null);

        List<KioskEvent> cuaA = goiKioskEvents("shipper_a", "ROLE_SHIPPER", moc);
        assertEquals(2, cuaA.size(), "A thấy sự kiện của A + sự kiện từ chối không rõ chủ");
        assertTrue(cuaA.stream().noneMatch(e -> "shipper_b".equals(e.getShipperId())),
                "A không được thấy xác thực của B");

        List<KioskEvent> cuaAdmin = goiKioskEvents("admin", "ROLE_ADMIN", moc);
        assertEquals(3, cuaAdmin.size(), "ADMIN thấy tất cả");
    }

    private List<KioskEvent> goiKioskEvents(String user, String role, long after) {
        var auth = new UsernamePasswordAuthenticationToken(user, null,
                List.of(new SimpleGrantedAuthority(role)));
        ResponseEntity<ApiResponse<KioskEventDTO>> res = shipperController.getKioskEvents(LOCKER, after, auth);
        return res.getBody().getData().getEvents();
    }

    // ── #15 ─────────────────────────────────────────────────────

    @Test
    @DisplayName("#15: nhật ký bảo trì trả compIndex (số ngăn hiển thị), không chỉ khoá chính")
    void nhatKyBaoTriCoCompIndex() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        Compartment ngan = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        MaintenanceLog saved = maintenanceLogRepository.save(MaintenanceLog.builder()
                .locker(locker)
                .compartmentId(ngan.getCompartmentId())
                .action("LOCK")
                .reasonCode("GD75_TEST")
                .byUsername("admin")
                .createdAt(LocalDateTime.now())
                .build());

        MaintenanceLogDTO dto = lockerService.getMaintenanceLogs(LOCKER, 200).stream()
                .filter(m -> saved.getLogId().equals(m.getLogId()))
                .findFirst().orElseThrow();
        assertEquals(ngan.getCompartmentId(), dto.getCompartmentId());
        assertEquals(1, dto.getCompIndex(), "Phải hiển thị ngăn #1, không phải khoá chính");
    }
}
