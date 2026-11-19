package com.ptit.smartlocker;

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
import com.ptit.smartlocker.service.PickupService;
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
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ72 (#1) — ĐƠN VỪA QUÁ HẠN LƯU KHO NHƯNG TÁC VỤ NỀN CHƯA CHUYỂN OVERDUE.
 *
 * <p>Lỗi cũ: trong ≤10 phút sau hạn, đơn vẫn {@code DEPOSITED}. QR bị từ chối với lời "Vui lòng tạo
 * mã OTP mới", {@code request-otp} trả 200 + mã mới nhưng hạn OTP bị chặn trần bằng hạn lưu kho đã
 * qua ⇒ OTP chết ngay khi sinh, khách lặp mãi.
 *
 * <p>Luật mới: quá hạn lưu kho thì {@code request-otp} từ chối, và lời báo của QR/OTP nói đúng là quá
 * hạn lưu kho, không bảo khách tạo OTP mới.
 */
@SpringBootTest
@Transactional
class Gd72StorageExpiryTests {

    private static final String LOCKER = "LOCKER_HN_02";
    private static final String ORD = "ORD-GD72-QUA-HAN";
    private static final String QR = "QR-GD72-TEST";
    private static final String OTP = "135792";
    private static final String PHONE = "0912345672";

    @Autowired private PickupService pickupService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private PickupCredentialRepository credentialRepository;
    @Autowired private LockerSlotScheduleRepository slotScheduleRepository;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        Compartment comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 2).orElseThrow();
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);

        LocalDateTime daQuaHan = LocalDateTime.now().minusMinutes(2);
        orderRepository.save(Order.builder()
                .orderId(ORD)
                .customerName("Khách GĐ72")
                .customerPhone(PHONE)
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("DEPOSITED") // tác vụ nền CHƯA chạy nên vẫn là DEPOSITED
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện GĐ72")
                .depositedAt(LocalDateTime.now().minusDays(2))
                .expiryDeadline(daQuaHan)
                .build());

        credentialRepository.save(PickupCredential.builder()
                .order(orderRepository.findById(ORD).orElseThrow())
                .qrToken(QR)
                .otpCode(OTP)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(daQuaHan)
                .otpExpiredAt(daQuaHan)
                .build());
    }

    private PickupDTO.VerifyCredentialRequest xacThuc(String method, String code) {
        return PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(LOCKER).authMethod(method).code(code).orderId(ORD).build();
    }

    @Test
    @DisplayName("GĐ72 (1): quá hạn lưu kho ⇒ request-otp từ chối, không cấp OTP chết sẵn")
    void xinOtpKhiQuaHanLuuKhoBiTuChoi() {
        RuntimeException loi = assertThrows(RuntimeException.class,
                () -> pickupService.generateNewOtp(ORD, PHONE));
        assertTrue(loi.getMessage().contains("quá hạn lưu kho"), loi.getMessage());

        PickupCredential c = credentialRepository.findByOrder_OrderId(ORD).orElseThrow();
        assertEquals(OTP, c.getOtpCode(), "Không được sinh OTP mới khi đã quá hạn lưu kho");
    }

    @Test
    @DisplayName("GĐ72 (2): quá hạn lưu kho ⇒ QR báo quá hạn, KHÔNG bảo khách tạo OTP mới")
    void qrKhiQuaHanLuuKhoBaoDungLyDo() {
        RuntimeException loi = assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThuc("QR", QR)));
        assertTrue(loi.getMessage().contains("quá hạn lưu kho"), loi.getMessage());
        assertFalse(loi.getMessage().contains("tạo mã OTP mới"), loi.getMessage());
    }

    @Test
    @DisplayName("GĐ72 (3): hạn mã còn nhưng hạn đơn đã qua (dữ liệu lệch cũ) ⇒ vẫn nhận ra quá hạn")
    void hanDonDaQuaDuHanMaCon() {
        PickupCredential c = credentialRepository.findByOrder_OrderId(ORD).orElseThrow();
        c.setExpiredAt(LocalDateTime.now().plusDays(1));
        credentialRepository.save(c);

        RuntimeException loi = assertThrows(RuntimeException.class,
                () -> pickupService.generateNewOtp(ORD, PHONE));
        assertTrue(loi.getMessage().contains("quá hạn lưu kho"), loi.getMessage());
    }

    /** Đưa đơn fixture về trạng thái còn hạn (cho #5, #6 — không xét quá hạn). */
    private void conHan() {
        Order o = orderRepository.findById(ORD).orElseThrow();
        o.setExpiryDeadline(LocalDateTime.now().plusDays(1));
        orderRepository.save(o);
        PickupCredential c = credentialRepository.findByOrder_OrderId(ORD).orElseThrow();
        c.setExpiredAt(LocalDateTime.now().plusDays(1));
        credentialRepository.save(c);
    }

    private int slotHomNay() {
        return slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER, LocalDate.now())
                .orElseThrow().getAvailableSlots();
    }

    @Test
    @DisplayName("GĐ72 (#5): mở cửa lấy hàng KHÔNG hoàn slot; chỉ hoàn khi chốt COMPLETED")
    void slotChiHoanKhiChotCompleted() {
        conHan();
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        LockerSlotSchedule lich = slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER, LocalDate.now())
                .orElseGet(() -> LockerSlotSchedule.builder().locker(locker).scheduleDate(LocalDate.now())
                        .totalSlots(locker.getTotalCompartments()).build());
        lich.setAvailableSlots(locker.getTotalCompartments() - 1);
        slotScheduleRepository.save(lich);
        int truoc = slotHomNay();

        pickupService.verifyAndPickup(xacThuc("QR", QR));
        assertEquals(truoc, slotHomNay(), "Mở cửa (ngăn vẫn OCCUPIED) không được cộng slot");

        Order o = orderRepository.findById(ORD).orElseThrow();
        Compartment comp = o.getCompartment();
        pickupService.chotPhienLayHang(o, comp, false);
        assertEquals(truoc + 1, slotHomNay(), "Chốt COMPLETED (ngăn EMPTY) phải hoàn đúng 1 slot");
    }

    @Test
    @DisplayName("GĐ72 (#6): đơn PICKUP_OPENED mở lại được tại kiosk (không kèm orderId)")
    void kioskMoLaiKhiDangPhienNhan() {
        conHan();
        Order o = orderRepository.findById(ORD).orElseThrow();
        o.setStatus("PICKUP_OPENED");
        orderRepository.save(o);

        var ok = pickupService.verifyAndPickup(PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(LOCKER).authMethod("QR").code(QR).build());
        assertTrue(ok.isSuccess(), "Kiosk phải mở lại được như đường web có orderId");
        assertEquals(ORD, ok.getOrderId());
    }

    @Test
    @DisplayName("GĐ72 (#2): hạn lưu kho = hết 24h00 ngày hôm sau ngày nạp")
    void hanLuuKhoDungLuat() {
        LocalDateTime nap = LocalDateTime.of(2026, 11, 19, 23, 30);
        assertEquals(LocalDateTime.of(LocalDate.of(2026, 11, 20), LocalTime.MAX), ShipperService.hanLuuKho(nap));
        LocalDateTime napSom = LocalDateTime.of(2026, 11, 19, 0, 5);
        assertEquals(LocalDateTime.of(LocalDate.of(2026, 11, 20), LocalTime.MAX), ShipperService.hanLuuKho(napSom));
    }
}
