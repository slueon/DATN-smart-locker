package com.ptit.smartlocker;

import com.ptit.smartlocker.controller.PickupController;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.PickupService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.transaction.annotation.Transactional;

import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ73 — lỗi logic web tìm được sau GĐ72 (N1–N5). Tủ ẢO {@code LOCKER_HN_02}.
 */
@SpringBootTest
@Transactional
class Gd73WebLogicTests {

    private static final String LOCKER = "LOCKER_HN_02";
    private static final String ORD = "ORD-GD73-WEB";
    private static final String QR = "QR-GD73-TEST";
    /** SĐT của tài khoản mặc định `khachhang` (AuthService seed lúc khởi động). */
    private static final String PHONE_KHACHHANG = "0988123456";
    private static final String PHONE_NGUOI_KHAC = "0912000073";

    @Autowired private PickupService pickupService;
    @Autowired private PickupController pickupController;
    @Autowired private OrderService orderService;
    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private PickupCredentialRepository credentialRepository;
    @Autowired private LockerSlotScheduleRepository slotScheduleRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById(LOCKER).orElseThrow();
    }

    private Order taoDon(String status, String phone, Integer compIndex) {
        Compartment comp = compIndex == null ? null
                : compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, compIndex).orElseThrow();
        if (comp != null && !"PENDING".equals(status)) {
            comp.setStatus("OCCUPIED");
            compartmentRepository.save(comp);
        }
        Order o = orderRepository.save(Order.builder()
                .orderId(ORD).customerName("Khách GĐ73").customerPhone(phone)
                .deliveryType("LOCKER").locker(locker).compartment(comp)
                .expectedDate(LocalDate.now()).status(status)
                .totalAmount(BigDecimal.valueOf(50000)).productName("Kiện GĐ73")
                .depositedAt("PENDING".equals(status) ? null : LocalDateTime.now())
                .expiryDeadline("PENDING".equals(status) ? null : LocalDateTime.now().plusDays(1))
                .trackingCode(ORD)
                .build());
        credentialRepository.save(PickupCredential.builder()
                .order(o).qrToken(QR).otpCode("").isUsed(false).failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(1)).build());
        return o;
    }

    private static UsernamePasswordAuthenticationToken phien(String username) {
        return new UsernamePasswordAuthenticationToken(username, null, List.of());
    }

    @Test
    @DisplayName("GĐ73 (N1): khách A KHÔNG xin được OTP cho đơn của khách B (dù biết SĐT của B)")
    void khongXinOtpChoDonNguoiKhac() {
        taoDon("DEPOSITED", PHONE_NGUOI_KHAC, 1);

        var res = pickupController.requestOtp(ORD, PHONE_NGUOI_KHAC, phien("khachhang"));

        assertEquals(HttpStatus.FORBIDDEN, res.getStatusCode());
        assertNull(res.getBody().getData(), "Không được trả mã OTP của người khác");
        assertEquals("", credentialRepository.findByOrder_OrderId(ORD).orElseThrow().getOtpCode(),
                "Không được sinh OTP cho đơn của người khác");
    }

    @Test
    @DisplayName("GĐ73 (N1): chủ đơn vẫn xin được OTP như cũ")
    void chuDonVanXinDuocOtp() {
        taoDon("DEPOSITED", PHONE_KHACHHANG, 1);

        var res = pickupController.requestOtp(ORD, PHONE_KHACHHANG, phien("khachhang"));

        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertNotNull(res.getBody().getData());
    }

    @Test
    @DisplayName("GĐ73 (N2): đơn đã thu hồi (RECALLED) bị từ chối khi mở tủ / xin OTP, lời báo đúng")
    void donThuHoiBiTuChoi() {
        taoDon("RECALLED", PHONE_KHACHHANG, 1);

        RuntimeException moTu = assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                PickupDTO.VerifyCredentialRequest.builder().lockerId(LOCKER).authMethod("QR").code(QR).orderId(ORD).build()));
        assertTrue(moTu.getMessage().contains("thu hồi"), moTu.getMessage());

        RuntimeException otp = assertThrows(RuntimeException.class,
                () -> pickupService.generateNewOtp(ORD, PHONE_KHACHHANG));
        assertTrue(otp.getMessage().contains("thu hồi"), otp.getMessage());
    }

    @Test
    @DisplayName("GĐ73 (N3): hết thời gian khoá thì 1 lần nhập sai KHÔNG khoá lại cả tủ ngay")
    @SuppressWarnings("unchecked")
    void hetKhoaThiDemLai() throws Exception {
        String tuGia = "LOCKER_GD73_LOCKOUT"; // bộ đếm trong bộ nhớ dùng chung giữa test ⇒ tủ riêng
        Runnable sai = () -> assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                PickupDTO.VerifyCredentialRequest.builder().lockerId(tuGia).authMethod("QR").code("SAI").build()));
        for (int i = 0; i < 5; i++) sai.run();

        RuntimeException dangKhoa = assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                PickupDTO.VerifyCredentialRequest.builder().lockerId(tuGia).authMethod("QR").code("SAI").build()));
        assertTrue(dangKhoa.getMessage().contains("tạm khóa"), dangKhoa.getMessage());

        // Giả lập hết 2 phút khoá.
        Field mapField = PickupService.class.getDeclaredField("lockerFailureMap");
        mapField.setAccessible(true);
        Object that = org.springframework.test.util.AopTestUtils.getTargetObject(pickupService); // bỏ proxy @Transactional
        Object tracker = ((Map<String, Object>) mapField.get(that)).get(tuGia);
        Field until = tracker.getClass().getDeclaredField("lockoutUntil");
        until.setAccessible(true);
        until.set(tracker, LocalDateTime.now().minusSeconds(1));

        RuntimeException saiMotLan = assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                PickupDTO.VerifyCredentialRequest.builder().lockerId(tuGia).authMethod("QR").code("SAI").build()));
        assertFalse(saiMotLan.getMessage().contains("tạm khóa"), saiMotLan.getMessage());
        RuntimeException tiepTheo = assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                PickupDTO.VerifyCredentialRequest.builder().lockerId(tuGia).authMethod("QR").code("SAI").build()));
        assertFalse(tiepTheo.getMessage().contains("tạm khóa"),
                "Sau khi hết khoá, 1 lần sai không được khoá lại cả tủ: " + tiepTheo.getMessage());
    }

    @Test
    @DisplayName("GĐ73 (N4): đặt trước rồi huỷ đặt trước KHÔNG làm tăng slot hôm nay")
    void huyDatTruocKhongCongSlot() {
        taoDon("PENDING", PHONE_KHACHHANG, null);
        LockerSlotSchedule lich = slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER, LocalDate.now())
                .orElseGet(() -> LockerSlotSchedule.builder().locker(locker).scheduleDate(LocalDate.now())
                        .totalSlots(locker.getTotalCompartments()).build());
        lich.setAvailableSlots(locker.getTotalCompartments() - 1);
        slotScheduleRepository.save(lich);
        int truoc = slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER, LocalDate.now())
                .orElseThrow().getAvailableSlots();

        shipperService.reserveCompartment(ORD, null, 1, 1);
        shipperService.cancelReserve(ORD);

        assertEquals(truoc, slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER, LocalDate.now())
                .orElseThrow().getAvailableSlots(), "Đơn vẫn PENDING nên vẫn giữ slot của nó");
        assertEquals("PENDING", orderRepository.findById(ORD).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ73 (N5): đơn PICKUP_OPENED — chủ đơn vẫn lấy được mã QR trên web")
    void pickupOpenedVanTraMaQr() {
        taoDon("PICKUP_OPENED", PHONE_KHACHHANG, 1);

        OrderDTO.OrderResponse r = orderService.getOrderById(ORD, PHONE_KHACHHANG);

        assertEquals(QR, r.getQrToken(), "Backend cho mở lại bằng mã này thì web phải hiện được mã");
    }
}
