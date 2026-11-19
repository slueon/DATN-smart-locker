package com.ptit.smartlocker;

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
 * GĐ31a — TH2: KHÁCH MỞ TỦ QUÊN LẤY HÀNG RỒI ĐÓNG LẠI.
 *
 * <p>Lỗi cũ: {@code verifyAndPickup} chốt dứt điểm ngay khi mã khớp ({@code isUsed=true},
 * {@code COMPLETED}, ngăn {@code EMPTY}) mà KHÔNG đọc cảm biến. Khách quên hàng ⇒ ngăn bị cấp cho
 * đơn khác, mã cũ vô hiệu, đơn COMPLETED nên không tạo lại mã được ⇒ mất hàng.
 *
 * <p>Luật mới: xác thực mã chỉ MỞ PHIÊN ({@code PICKUP_OPENED}, ngăn vẫn {@code OCCUPIED},
 * {@code isUsed=0}); chốt cuối do cảm biến quyết định qua {@link PickupService#chotPhienLayHang}.
 */
@SpringBootTest
@Transactional
class PickupLeftBehindTests {

    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private PickupService pickupService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private PickupCredentialRepository credentialRepository;

    private Order order;
    private Compartment compartment;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        compartment = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        compartment.setStatus("OCCUPIED");
        compartmentRepository.save(compartment);

        order = orderRepository.save(Order.builder()
                .orderId("ORD-GD31A-LEFT")
                .customerName("Khách Test GĐ31a")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(compartment)
                .expectedDate(LocalDate.now())
                .status("PICKUP_OPENED")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ31a")
                .build());

        credentialRepository.save(PickupCredential.builder()
                .order(order)
                .qrToken("QR-GD31A-TEST")
                .otpCode("123456")
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusMinutes(5))
                // GĐ69 — hạn RIÊNG của OTP; thiếu thì OTP bị từ chối vì "hết hiệu lực" chứ không
                // phải vì bị xoá, làm test GĐ67 mất ý nghĩa.
                .otpExpiredAt(LocalDateTime.now().plusMinutes(5))
                .build());
    }

    @Test
    @DisplayName("GĐ31a (6): đóng cửa mà CÒN HÀNG → đơn về DEPOSITED, ngăn OCCUPIED, isUsed=0, usedAt=null")
    void conHangThiQuayVeDeposited() {
        boolean chot = pickupService.chotPhienLayHang(order, compartment, true);

        assertFalse(chot, "Còn hàng thì KHÔNG được chốt COMPLETED");
        Order sau = orderRepository.findById("ORD-GD31A-LEFT").orElseThrow();
        assertEquals("DEPOSITED", sau.getStatus(),
                "Đơn phải quay về DEPOSITED để khách mở lại được");
        assertEquals("OCCUPIED",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn phải VẪN OCCUPIED — nếu thành EMPTY là mở lại lỗ hai-đơn-một-ngăn");

        PickupCredential cred = credentialRepository.findByOrder_OrderId("ORD-GD31A-LEFT").orElseThrow();
        assertFalse(Boolean.TRUE.equals(cred.getIsUsed()),
                "Mã MỚI phải chưa dùng để khách lấy lần 2");
        assertNull(cred.getUsedAt(), "usedAt phải NULL khi hàng còn trong tủ");
    }

    @Test
    @DisplayName("GĐ67: quên lấy ⇒ QR cũ + OTP cũ bị từ chối, QR mới mở được; giữ hạn lưu kho")
    void quenLayThiMaCuHetHieuLucMaMoiMoDuoc() {
        PickupCredential truoc = credentialRepository.findByOrder_OrderId("ORD-GD31A-LEFT").orElseThrow();
        LocalDateTime hanTruoc = truoc.getExpiredAt();
        truoc.setFailedAttempts(2);
        credentialRepository.save(truoc);

        pickupService.chotPhienLayHang(order, compartment, true);

        PickupCredential cred = credentialRepository.findByOrder_OrderId("ORD-GD31A-LEFT").orElseThrow();
        String qrMoi = cred.getQrToken();
        assertNotNull(qrMoi);
        assertNotEquals("QR-GD31A-TEST", qrMoi, "Phải cấp qrToken MỚI");
        assertEquals(43, qrMoi.length(), "QR mới sinh cùng hàm với OrderService (Base64URL 32 byte)");
        assertEquals("", cred.getOtpCode(), "OTP cũ phải bị xoá");
        assertEquals(0, cred.getFailedAttempts());
        assertEquals(hanTruoc, cred.getExpiredAt(), "Không đổi hạn lưu kho");

        assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                com.ptit.smartlocker.dto.PickupDTO.VerifyCredentialRequest.builder()
                        .lockerId(LOCKER).authMethod("QR").code("QR-GD31A-TEST").orderId("ORD-GD31A-LEFT").build()),
                "QR cũ phải bị từ chối");
        assertThrows(RuntimeException.class, () -> pickupService.verifyAndPickup(
                com.ptit.smartlocker.dto.PickupDTO.VerifyCredentialRequest.builder()
                        .lockerId(LOCKER).authMethod("OTP").code("123456").orderId("ORD-GD31A-LEFT").build()),
                "OTP cũ phải bị từ chối");

        var ok = pickupService.verifyAndPickup(
                com.ptit.smartlocker.dto.PickupDTO.VerifyCredentialRequest.builder()
                        .lockerId(LOCKER).authMethod("QR").code(qrMoi).orderId("ORD-GD31A-LEFT").build());
        assertTrue(ok.isSuccess(), "QR mới phải mở được ngăn");
        assertEquals("PICKUP_OPENED", orderRepository.findById("ORD-GD31A-LEFT").orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ31a (5): đóng cửa và KHÔNG còn hàng → COMPLETED, ngăn EMPTY, isUsed=1")
    void hetHangThiCompleted() {
        boolean chot = pickupService.chotPhienLayHang(order, compartment, false);

        assertTrue(chot, "Hết hàng thì phải chốt COMPLETED");
        assertEquals("COMPLETED",
                orderRepository.findById("ORD-GD31A-LEFT").orElseThrow().getStatus());
        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn phải được giải phóng khi hàng đã ra thật");

        PickupCredential cred = credentialRepository.findByOrder_OrderId("ORD-GD31A-LEFT").orElseThrow();
        assertTrue(Boolean.TRUE.equals(cred.getIsUsed()), "Mã đã dùng xong thì phải đánh dấu");
        assertNotNull(cred.getUsedAt());
    }

    @Test
    @DisplayName("GĐ31a: chốt 2 lần không đổi kết quả (idempotent, không nhân bản)")
    void chotHaiLanKhongSai() {
        pickupService.chotPhienLayHang(order, compartment, true);
        Order sau1 = orderRepository.findById("ORD-GD31A-LEFT").orElseThrow();
        boolean lan2 = pickupService.chotPhienLayHang(sau1, compartment, true);

        assertFalse(lan2, "Đơn đã rời PICKUP_OPENED thì lần 2 không chốt nữa");
        assertEquals("DEPOSITED", orderRepository.findById("ORD-GD31A-LEFT").orElseThrow().getStatus(),
                "Trạng thái không được đổi lung tung ở lần chốt thứ hai");
    }

    @Test
    @DisplayName("GĐ31a: đơn KHÔNG ở PICKUP_OPENED thì hàm chốt không làm gì")
    void donKhacTrangThaiThiBoQua() {
        order.setStatus("DEPOSITED");
        orderRepository.save(order);

        boolean chot = pickupService.chotPhienLayHang(order, compartment, false);

        assertFalse(chot, "Chỉ chốt đơn đang ở PICKUP_OPENED");
        assertEquals("DEPOSITED", orderRepository.findById("ORD-GD31A-LEFT").orElseThrow().getStatus(),
                "Không được chốt COMPLETED cho đơn chưa mở phiên nhận");
    }
}
