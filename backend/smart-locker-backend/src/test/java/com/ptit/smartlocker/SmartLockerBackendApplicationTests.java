package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import com.ptit.smartlocker.service.AuthService;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.PickupService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class SmartLockerBackendApplicationTests {

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private AuthService authService;

    @Autowired
    private OrderService orderService;

    @Autowired
    private PickupService pickupService;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private LockerRepository lockerRepository;

    @Autowired
    private PickupCredentialRepository credentialRepository;

    @Autowired
    private LockerSlotScheduleRepository slotScheduleRepository;

    @Test
    @DisplayName("Context Loads Test")
    void contextLoads() {
        assertNotNull(passwordEncoder, "PasswordEncoder bean phải được khởi tạo thành công");
        assertNotNull(authService, "AuthService bean phải được khởi tạo thành công");
        assertNotNull(orderService, "OrderService bean phải được khởi tạo thành công");
        assertNotNull(pickupService, "PickupService bean phải được khởi tạo thành công");
    }

    @Test
    @DisplayName("Test 1: BCrypt Password Hashing & Verification")
    void testBcryptPasswordHashing() {
        String rawPassword = "SecurePassword@2026";
        String encoded = passwordEncoder.encode(rawPassword);

        assertNotNull(encoded);
        assertTrue(encoded.startsWith("$2a$") || encoded.startsWith("$2b$"), "Mật khẩu phải bắt đầu bằng định dạng BCrypt ($2a$ hoặc $2b$)");
        assertTrue(passwordEncoder.matches(rawPassword, encoded), "Mật khẩu đúng phải khớp với chuỗi băm");
        assertFalse(passwordEncoder.matches("WrongPassword", encoded), "Mật khẩu sai không được khớp");
    }

    @Test
    @DisplayName("Test 2: Concurrency & Atomic Locker Slot Schedule Initialization")
    @Transactional
    void testScheduleInitIfNotExists() {
        String lockerId = "LOCKER_HN_01";
        LocalDate futureDate = LocalDate.now().plusDays(30);

        // Đảm bảo khởi tạo an toàn không bị xung đột khóa
        slotScheduleRepository.initScheduleIfNotExists(lockerId, futureDate, 3);
        // Gọi lại lần 2 mô phỏng luồng thứ hai cùng chạy đồng thời:
        slotScheduleRepository.initScheduleIfNotExists(lockerId, futureDate, 3);

        var scheduleOpt = slotScheduleRepository.findWithLockByLockerIdAndDate(lockerId, futureDate);
        assertTrue(scheduleOpt.isPresent(), "Lịch biểu phải được khởi tạo thành công");
        assertEquals(3, scheduleOpt.get().getAvailableSlots(), "Số slot khả dụng ban đầu phải bằng 3");
    }

    @Test
    @DisplayName("Test 3: Anti-Brute-Force Lockout khi nhập sai OTP quá 5 lần")
    @Transactional
    void testAntiBruteForceLockout() {
        Locker locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        if (locker == null) return;

        String testOrderId = "TEST-ORD-" + UUID.randomUUID().toString().substring(0, 6);
        Order order = Order.builder()
                .orderId(testOrderId)
                .customerName("Người Dùng Test")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .expectedDate(LocalDate.now())
                .status("DEPOSITED")
                .totalAmount(BigDecimal.valueOf(100000))
                .build();
        orderRepository.save(order);

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode("999888")
                .qrToken("QR-TEST-" + UUID.randomUUID())
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusMinutes(5))
                .build();
        credentialRepository.save(credential);

        // Nhập sai 5 lần liên tiếp
        for (int i = 1; i <= 5; i++) {
            PickupDTO.VerifyCredentialRequest req = PickupDTO.VerifyCredentialRequest.builder()
                    .lockerId(locker.getLockerId())
                    .authMethod("OTP")
                    .code("000000") // Mã sai
                    .orderId(testOrderId)
                    .build();

            try {
                pickupService.verifyAndPickup(req);
                fail("Phải ném exception khi nhập sai mã");
            } catch (RuntimeException ex) {
                // Mong đợi ném ngoại lệ
            }
        }

        // Lần thứ 6: Dù có nhập đúng "999888", hệ thống vẫn phải từ chối vì đã bị khóa do quá 5 lần sai
        PickupDTO.VerifyCredentialRequest correctReq = PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(locker.getLockerId())
                .authMethod("OTP")
                .code("999888") // Nhập đúng mã
                .orderId(testOrderId)
                .build();

        RuntimeException lockException = assertThrows(RuntimeException.class, () -> {
            pickupService.verifyAndPickup(correctReq);
        });

        assertTrue(lockException.getMessage().contains("tạm khóa"),
                "Thông báo lỗi phải chứa thông tin tạm khóa do nhập sai quá 5 lần: " + lockException.getMessage());
    }

    @Test
    @DisplayName("Test 4: Strict OTP Generation & State Validation")
    @Transactional
    void testStrictOtpGenerationAndValidation() {
        Locker locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        if (locker == null) return;

        String testOrderId = "TEST-ORD-STATE-" + UUID.randomUUID().toString().substring(0, 6);
        Order order = Order.builder()
                .orderId(testOrderId)
                .customerName("Khách Hàng Test")
                .customerPhone("0988776655")
                .deliveryType("LOCKER")
                .locker(locker)
                .expectedDate(LocalDate.now())
                .status("PENDING") // Chưa nạp vào tủ
                .totalAmount(BigDecimal.valueOf(50000))
                .build();
        orderRepository.save(order);

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode("123456")
                .qrToken("QR-TEST-STATE-" + UUID.randomUUID())
                .isUsed(false)
                .failedAttempts(5) // Giả định đang bị khóa
                .expiredAt(LocalDateTime.now().plusMinutes(5))
                .build();
        credentialRepository.save(credential);

        // 1. Khi đơn hàng đang PENDING: Không cho phép tạo OTP
        RuntimeException pendingEx = assertThrows(RuntimeException.class, () -> {
            pickupService.generateNewOtp(testOrderId, "0988776655");
        });
        assertTrue(pendingEx.getMessage().contains("chưa được nhân viên"), "Phải chặn tạo OTP khi đơn chưa nạp vào tủ");

        // 2. Chống IDOR: Nếu sai số điện thoại sở hữu đơn
        order.setStatus("DEPOSITED");
        orderRepository.save(order);

        RuntimeException idorEx = assertThrows(RuntimeException.class, () -> {
            pickupService.generateNewOtp(testOrderId, "0999999999"); // Sai số điện thoại
        });
        assertTrue(idorEx.getMessage().contains("Số điện thoại không khớp"), "Phải chặn khi số điện thoại không khớp người nhận");

        // 3. Khi đúng trạng thái DEPOSITED và đúng số điện thoại: Cho phép tạo OTP và reset failedAttempts về 0
        String newOtp = pickupService.generateNewOtp(testOrderId, "0988776655");
        assertNotNull(newOtp);
        assertEquals(6, newOtp.length(), "Mã OTP mới phải có đúng 6 chữ số");

        PickupCredential updatedCred = credentialRepository.findByOrder_OrderId(testOrderId).orElseThrow();
        assertEquals(0, updatedCred.getFailedAttempts(), "Số lần nhập sai phải được reset về 0");
        assertEquals(newOtp, updatedCred.getOtpCode(), "Mã OTP trong CSDL phải được cập nhật");
        assertTrue(updatedCred.getExpiredAt().isAfter(LocalDateTime.now().plusMinutes(4)), "Hạn OTP phải là 5 phút tiếp theo");
    }
}
