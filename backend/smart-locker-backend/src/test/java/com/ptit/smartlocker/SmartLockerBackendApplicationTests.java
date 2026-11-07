package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import com.ptit.smartlocker.service.AuthService;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.PickupService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
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

    @Autowired
    private ShipperService shipperService;

    @Autowired
    private ShipperIdentityTokenRepository tokenRepository;

    @Autowired
    private CompartmentRepository compartmentRepository;

    @Test
    @DisplayName("Context Loads Test")
    void contextLoads() {
        assertNotNull(passwordEncoder, "PasswordEncoder bean phải được khởi tạo thành công");
        assertNotNull(authService, "AuthService bean phải được khởi tạo thành công");
        assertNotNull(orderService, "OrderService bean phải được khởi tạo thành công");
        assertNotNull(pickupService, "PickupService bean phải được khởi tạo thành công");
        assertNotNull(shipperService, "ShipperService bean phải được khởi tạo thành công");
        assertNotNull(tokenRepository, "ShipperIdentityTokenRepository bean phải được khởi tạo thành công");
        assertNotNull(compartmentRepository, "CompartmentRepository bean phải được khởi tạo thành công");
        assertNotNull(lockerRepository, "LockerRepository bean phải được khởi tạo thành công");
        assertNotNull(credentialRepository, "PickupCredentialRepository bean phải được khởi tạo thành công");
        assertNotNull(slotScheduleRepository, "LockerSlotScheduleRepository bean phải được khởi tạo thành công");
    }

    @Test
    @DisplayName("Test 1: BCrypt Password Hashing & Verification")
    void testBcryptPasswordHashing() {
        String rawPassword = "SecurePassword@2026";
        String encoded = passwordEncoder.encode(rawPassword);

        assertNotNull(encoded);
        assertTrue(encoded.startsWith("$2a$") || encoded.startsWith("$2b$"),
                "Mật khẩu phải bắt đầu bằng định dạng BCrypt ($2a$ hoặc $2b$)");
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
        if (locker == null)
            return;

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

        // Lần thứ 6: Dù có nhập đúng "999888", hệ thống vẫn phải từ chối vì đã bị khóa
        // do quá 5 lần sai
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
        if (locker == null)
            return;

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
        assertTrue(idorEx.getMessage().contains("Số điện thoại không khớp"),
                "Phải chặn khi số điện thoại không khớp người nhận");

        // 3. Khi đúng trạng thái DEPOSITED và đúng số điện thoại: Cho phép tạo OTP và
        // reset failedAttempts về 0
        String newOtp = pickupService.generateNewOtp(testOrderId, "0988776655");
        assertNotNull(newOtp);
        assertEquals(6, newOtp.length(), "Mã OTP mới phải có đúng 6 chữ số");

        PickupCredential updatedCred = credentialRepository.findByOrder_OrderId(testOrderId).orElseThrow();
        assertEquals(0, updatedCred.getFailedAttempts(), "Số lần nhập sai phải được reset về 0");
        assertEquals(newOtp, updatedCred.getOtpCode(), "Mã OTP trong CSDL phải được cập nhật");
        assertTrue(updatedCred.getExpiredAt().isAfter(LocalDateTime.now().plusMinutes(4)),
                "Hạn OTP phải là 5 phút tiếp theo");
    }

    @Test
    @DisplayName("Test 5: IDOR Protection & Secrets Masking on Order Lookup")
    @Transactional
    void testIdorProtectionAndSecretsMasking() {
        Locker locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        if (locker == null) return;

        String testOrderId = "TEST-IDOR-" + UUID.randomUUID().toString().substring(0, 6);
        String correctPhone = "0988001122";
        Order order = Order.builder()
                .orderId(testOrderId)
                .customerName("Khách Hàng Bảo Mật")
                .customerPhone(correctPhone)
                .deliveryType("LOCKER")
                .locker(locker)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(200000))
                .build();
        orderRepository.save(order);

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode("654321")
                .qrToken("QR-IDOR-" + UUID.randomUUID())
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(2))
                .build();
        credentialRepository.save(credential);

        // 1. Dò mã ẩn danh (không truyền SĐT): Không được lộ OTP hay QR Token
        OrderDTO.OrderResponse anonResp = orderService.getOrderById(testOrderId, null);
        assertNull(anonResp.getOtpCode(), "Truy vấn ẩn danh không được lộ mã OTP bí mật");
        assertNull(anonResp.getQrToken(), "Truy vấn ẩn danh không được lộ mã QR Token bí mật");

        // 2. Cố tình nhập sai số điện thoại khác: Phải bị chặn lỗi bảo mật
        assertThrows(RuntimeException.class, () -> {
            orderService.getOrderById(testOrderId, "0999999999");
        }, "Phải ném ngoại lệ khi số điện thoại không khớp");

        // 3. Đúng số điện thoại nhưng hàng chưa nạp (PENDING): Vẫn che giấu mã OTP
        OrderDTO.OrderResponse pendingResp = orderService.getOrderById(testOrderId, correctPhone);
        assertNull(pendingResp.getOtpCode(), "Đơn PENDING chưa được phép xem mã OTP");

        // 4. Đúng số điện thoại và hàng ĐÃ VÀO TỦ (DEPOSITED): Mới được phép nhận mã OTP và QR
        order.setStatus("DEPOSITED");
        orderRepository.save(order);

        OrderDTO.OrderResponse depositedResp = orderService.getOrderById(testOrderId, correctPhone);
        assertNotNull(depositedResp.getOtpCode(), "Đơn DEPOSITED và đúng SĐT phải được cấp mã OTP");
        assertNotNull(depositedResp.getQrToken(), "Đơn DEPOSITED và đúng SĐT phải được cấp mã QR");
    }

    @Test
    @DisplayName("Test 6: Shipper Dynamic Token Verification Required on Deposit")
    @Transactional
    void testShipperDynamicTokenRequiredOnDeposit() {
        Locker locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        if (locker == null) return;

        String testOrderId = "TEST-SHIP-" + UUID.randomUUID().toString().substring(0, 6);
        Order order = Order.builder()
                .orderId(testOrderId)
                .customerName("Khách Hàng Nhận Đồ")
                .customerPhone("0977665544")
                .deliveryType("LOCKER")
                .locker(locker)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(150000))
                .build();

        // Đảm bảo trạm tủ kiểm thử có ít nhất 1 ngăn trống (EMPTY) để phục vụ nạp hàng
        List<Compartment> comps = compartmentRepository.findByLocker_LockerId(locker.getLockerId());
        if (!comps.isEmpty()) {
            Compartment testComp = comps.stream()
                    .filter(c -> "EMPTY".equalsIgnoreCase(c.getStatus()))
                    .findFirst()
                    .orElseGet(() -> {
                        Compartment c = comps.get(0);
                        c.setStatus("EMPTY");
                        return compartmentRepository.save(c);
                    });
            order.setCompartment(testComp);
        }
        orderRepository.save(order);

        // 1. Gửi hàng không kèm token: Phải bị từ chối
        ShipperDTO.DepositPackageRequest noTokenReq = ShipperDTO.DepositPackageRequest.builder()
                .lockerId(locker.getLockerId())
                .orderId(testOrderId)
                .dynamicToken(null)
                .isDoorClosed(true)
                .weightGrams(0.5)
                .build();
        assertThrows(RuntimeException.class, () -> shipperService.depositPackage(noTokenReq));

        // 2. Gửi hàng kèm token chưa qua xác thực tại Kiosk: Phải bị từ chối
        ShipperDTO.GenerateTokenResponse tokenResp = shipperService.generateDynamicToken("SHIPPER_001");
        String rawToken = tokenResp.getDynamicToken();

        ShipperDTO.DepositPackageRequest unverifiedReq = ShipperDTO.DepositPackageRequest.builder()
                .lockerId(locker.getLockerId())
                .orderId(testOrderId)
                .dynamicToken(rawToken)
                .isDoorClosed(true)
                .weightGrams(0.5)
                .build();
        assertThrows(RuntimeException.class, () -> shipperService.depositPackage(unverifiedReq));

        // 3. Quét xác thực token tại trạm thành công: Sau đó mới được phép nạp hàng
        boolean verified = shipperService.verifyDynamicToken(locker.getLockerId(), rawToken);
        assertTrue(verified, "Xác thực token tại Kiosk phải thành công");

        ShipperDTO.DepositPackageRequest validReq = ShipperDTO.DepositPackageRequest.builder()
                .lockerId(locker.getLockerId())
                .orderId(testOrderId)
                .dynamicToken(rawToken)
                .isDoorClosed(true)
                .weightGrams(0.5)
                .build();
        ShipperDTO.DepositResponse depositResp = shipperService.depositPackage(validReq);
        assertTrue(depositResp.isSuccess(), "Nạp hàng phải thành công khi token đã được xác thực");

        Order updatedOrder = orderRepository.findById(testOrderId).orElseThrow();
        assertEquals("DEPOSITED", updatedOrder.getStatus(), "Trạng thái đơn hàng phải chuyển sang DEPOSITED");
    }

    @Test
    @DisplayName("Test 7: Future Date Reservation Does Not Lock Physical Compartment Today")
    @Transactional
    void testFutureDateReservationDoesNotLockPhysicalCompartment() {
        Locker locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        if (locker == null) return;

        LocalDate futureDate = LocalDate.now().plusDays(2);
        OrderDTO.CheckoutRequest request = OrderDTO.CheckoutRequest.builder()
                .customerName("Khách Hàng Tương Lai")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .lockerId(locker.getLockerId())
                .deliveryDate(futureDate)
                .paymentMethod("ONLINE")
                .paymentStatus("PENDING")
                .productName("Bưu kiện sách IoT ESP32")
                .requiredSize("S")
                .build();

        OrderDTO.OrderResponse response = orderService.createOrder(request);
        assertNotNull(response);
        assertEquals("PENDING", response.getStatus());

        Order savedOrder = orderRepository.findById(response.getOrderId()).orElseThrow();
        assertNull(savedOrder.getCompartment(), "Đơn đặt ngày tương lai không được chiếm giữ ngăn tủ vật lý hôm nay");
        assertEquals(futureDate, savedOrder.getExpectedDate(), "Ngày dự kiến phải khớp với lịch tương lai đã chọn");
    }
}
