package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import com.ptit.smartlocker.service.PickupService;
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
 * GĐ69 — TÁCH HẠN CỦA MÃ NHẬN HÀNG VÀ HẠN CỦA OTP.
 *
 * <p>Lỗi cũ: {@code pickup_credentials} chỉ có một cột hạn {@code expired_at} dùng chung, và
 * {@code POST /api/pickup/request-otp} ghi đè nó thành {@code now + 5 phút} ⇒ xin OTP làm **mã QR
 * cũng hết hạn sau 5 phút**.
 *
 * <p>Luật mới: {@code expired_at} = hạn mã nhận hàng (hạn lưu kho), áp cho cả QR + OTP;
 * {@code otp_expired_at} = hạn riêng của OTP, {@code request-otp} chỉ đặt cột này.
 */
@SpringBootTest
@Transactional
class Gd69OtpExpiryTests {

    /**
     * Tủ ẢO — không đụng tủ thật {@code LOCKER_HN_01}. Cũng tránh làm tăng bộ đếm nhập sai trong
     * bộ nhớ của {@code PickupService} cho tủ thật (bộ đếm này KHÔNG rollback theo transaction nên
     * có thể khoá chéo test khác của cùng tủ).
     */
    private static final String LOCKER = "LOCKER_HN_02";
    private static final String ORD = "ORD-GD69-OTP-HAN";
    private static final String QR = "QR-GD69-TEST";
    private static final String OTP = "246810";
    private static final String PHONE = "0912345699";

    @Autowired private PickupService pickupService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private PickupCredentialRepository credentialRepository;

    private Compartment compartment;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        compartment = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        compartment.setStatus("OCCUPIED");
        compartmentRepository.save(compartment);

        orderRepository.save(Order.builder()
                .orderId(ORD)
                .customerName("Khách GĐ69")
                .customerPhone(PHONE)
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(compartment)
                .expectedDate(LocalDate.now())
                .status("DEPOSITED")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện GĐ69")
                .depositedAt(LocalDateTime.now())
                .expiryDeadline(LocalDateTime.now().plusDays(1))
                .build());

        credentialRepository.save(PickupCredential.builder()
                .order(orderRepository.findById(ORD).orElseThrow())
                .qrToken(QR)
                .otpCode(OTP)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(1))
                .otpExpiredAt(LocalDateTime.now().plusMinutes(5))
                .build());
    }

    private PickupCredential cred() {
        return credentialRepository.findByOrder_OrderId(ORD).orElseThrow();
    }

    private PickupDTO.VerifyCredentialRequest xacThuc(String method, String code) {
        return PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(LOCKER).authMethod(method).code(code).orderId(ORD).build();
    }

    private PickupDTO.VerifyCredentialRequest xacThucKhongDon(String method, String code) {
        return PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(LOCKER).authMethod(method).code(code).build();
    }

    @Test
    @DisplayName("GĐ69 (1): request-otp KHÔNG đổi hạn mã nhận hàng, chỉ đặt otp_expired_at ≈ now+5 phút")
    void xinOtpKhongLamChetQr() {
        LocalDateTime hanMaTruoc = cred().getExpiredAt();

        String otpMoi = pickupService.generateNewOtp(ORD, PHONE);
        assertNotNull(otpMoi);

        PickupCredential sau = cred();
        assertEquals(hanMaTruoc, sau.getExpiredAt(),
                "Hạn mã nhận hàng (hạn lưu kho) KHÔNG được đổi khi xin OTP");
        assertNotNull(sau.getOtpExpiredAt(), "Xin OTP phải đặt hạn riêng của OTP");
        assertTrue(sau.getOtpExpiredAt().isAfter(LocalDateTime.now().plusMinutes(4)),
                "Hạn OTP phải còn gần 5 phút");
        assertTrue(sau.getOtpExpiredAt().isBefore(LocalDateTime.now().plusMinutes(6)),
                "Hạn OTP không được dài hơn 5 phút");
    }

    @Test
    @DisplayName("GĐ69 (biên): hạn lưu kho còn 2 phút ⇒ hạn OTP bị chặn ở đúng hạn lưu kho")
    void hanOtpHongVuotHanLuuKho() {
        PickupCredential truoc = cred();
        LocalDateTime hanLuuKho = LocalDateTime.now().plusMinutes(2);
        truoc.setExpiredAt(hanLuuKho);
        credentialRepository.save(truoc);

        pickupService.generateNewOtp(ORD, PHONE);

        assertEquals(hanLuuKho, cred().getOtpExpiredAt(),
                "OTP không được sống lâu hơn hạn mã nhận hàng");
        assertEquals(hanLuuKho, cred().getExpiredAt(), "Hạn mã nhận hàng vẫn không đổi");
    }

    @Test
    @DisplayName("GĐ69 (2): otp_expired_at quá khứ ⇒ QR vẫn mở được, OTP bị từ chối")
    void otpHetHanNhungQrConHan() {
        PickupCredential c = cred();
        c.setOtpExpiredAt(LocalDateTime.now().minusMinutes(1));
        credentialRepository.save(c);

        RuntimeException loiOtp = assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThuc("OTP", OTP)),
                "OTP đã hết hạn riêng thì phải bị từ chối");
        assertTrue(loiOtp.getMessage().contains("hết hiệu lực"), loiOtp.getMessage());

        var okQr = pickupService.verifyAndPickup(xacThuc("QR", QR));
        assertTrue(okQr.isSuccess(), "QR vẫn còn hạn mã nhận hàng nên phải mở được");
    }

    @Test
    @DisplayName("GĐ69 (3): OTP còn trong hạn ⇒ xác thực được")
    void otpTrongHanThiMoDuoc() {
        var ok = pickupService.verifyAndPickup(xacThuc("OTP", OTP));
        assertTrue(ok.isSuccess(), "OTP trong hạn phải mở được ngăn");
    }

    @Test
    @DisplayName("GĐ69 (4): quá hạn lưu kho ⇒ QR và OTP đều bị từ chối (kể cả khi otp_expired_at còn)")
    void quaHanLuuKhoThiChetCaHai() {
        PickupCredential c = cred();
        c.setExpiredAt(LocalDateTime.now().minusMinutes(1));
        c.setOtpExpiredAt(LocalDateTime.now().plusMinutes(5));
        credentialRepository.save(c);

        assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThuc("OTP", OTP)),
                "Quá hạn lưu kho thì OTP phải chết dù otp_expired_at còn hạn");
        assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThuc("QR", QR)),
                "Quá hạn lưu kho thì QR phải chết");

        // CỐ Ý không thử nhánh "không truyền orderId" ở đây: nhánh đó gọi `recordLockerFailure`
        // cho LOCKER_HN_01 (bộ đếm trong bộ nhớ dùng chung cả lượt test) ⇒ có thể khoá chéo các
        // test khác của cùng tủ. Nhánh đó được đo ở test `xacThucKhongTruyenOrderId` bên dưới.
    }

    @Test
    @DisplayName("GĐ69 (3b): không truyền orderId vẫn qua được bộ lọc hạn mới (QR và OTP trong hạn)")
    void xacThucKhongTruyenOrderId() {
        var okOtp = pickupService.verifyAndPickup(xacThucKhongDon("OTP", OTP));
        assertTrue(okOtp.isSuccess(), "OTP trong hạn, tra trực tiếp theo mã, phải mở được");
        assertEquals("PICKUP_OPENED",
                orderRepository.findById(ORD).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ69 (2b): không truyền orderId + otp_expired_at quá khứ ⇒ OTP bị loại, QR vẫn mở")
    void khongOrderIdVanTonTrongHanOtpHet() {
        PickupCredential c = cred();
        c.setOtpExpiredAt(LocalDateTime.now().minusMinutes(1));
        credentialRepository.save(c);

        assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThucKhongDon("OTP", OTP)),
                "Bộ lọc tra cứu phải loại credential có otp_expired_at quá khứ");

        var okQr = pickupService.verifyAndPickup(xacThucKhongDon("QR", QR));
        assertTrue(okQr.isSuccess(), "QR không phụ thuộc otp_expired_at");
    }

    @Test
    @DisplayName("GĐ69 (biên): otp_expired_at NULL (chưa cấp OTP) ⇒ OTP bị từ chối, QR vẫn mở được")
    void chuaCapOtpThiChiCoQr() {
        PickupCredential c = cred();
        c.setOtpExpiredAt(null);
        credentialRepository.save(c);

        assertThrows(RuntimeException.class,
                () -> pickupService.verifyAndPickup(xacThuc("OTP", OTP)),
                "Chưa cấp OTP (otp_expired_at NULL) thì đường OTP phải từ chối");

        var okQr = pickupService.verifyAndPickup(xacThuc("QR", QR));
        assertTrue(okQr.isSuccess(), "QR không phụ thuộc otp_expired_at");
    }

    @Test
    @DisplayName("GĐ69 (6): quên lấy hàng ⇒ otp_expired_at bị xoá về NULL cùng OTP cũ")
    void quenLayThiXoaHanOtp() {
        // `chotPhienLayHang` chỉ chạy khi đơn đang PICKUP_OPENED (phiên nhận đang mở).
        Order dangMoPhien = orderRepository.findById(ORD).orElseThrow();
        dangMoPhien.setStatus("PICKUP_OPENED");
        orderRepository.save(dangMoPhien);

        pickupService.chotPhienLayHang(dangMoPhien, compartment, true);

        PickupCredential sau = cred();
        assertEquals("", sau.getOtpCode(), "OTP cũ phải bị xoá");
        assertNull(sau.getOtpExpiredAt(), "Hạn riêng của OTP cũng phải bị xoá");
        assertNotNull(sau.getExpiredAt(), "Hạn lưu kho vẫn còn");
        assertEquals("DEPOSITED", orderRepository.findById(ORD).orElseThrow().getStatus());
    }
}
