package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.KioskEventDTO;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.KioskEventService;
import com.ptit.smartlocker.service.PickupService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/pickup")
public class PickupController {

    /** GĐ73 (N1) — xin OTP cho đơn không thuộc SĐT của tài khoản đang đăng nhập. */
    static final String DENY_OTP = "Bạn không có quyền tạo mã OTP cho đơn hàng của số điện thoại này!";

    private final PickupService pickupService;
    private final KioskEventService kioskEventService;
    private final UserRepository userRepository;

    public PickupController(PickupService pickupService, KioskEventService kioskEventService,
                            UserRepository userRepository) {
        this.pickupService = pickupService;
        this.kioskEventService = kioskEventService;
        this.userRepository = userRepository;
    }

    /**
     * Khách hàng lấy đồ tại tủ (Hỗ trợ xác thực bằng mã OTP 6 số hoặc quét mã QR qua GM65).
     *
     * <p>Không {@code catch} tại đây nữa: {@code GlobalExceptionHandler} ánh xạ
     * {@code ResourceNotFoundException → 404}, {@code BusinessException → 409}.
     * Message tiếng Việt vẫn nguyên văn nên client không phải đổi gì.
     */
    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<PickupDTO.PickupResponse>> verifyPickup(
            @RequestBody PickupDTO.VerifyCredentialRequest request) {
        PickupDTO.PickupResponse response = pickupService.verifyAndPickup(request);
        return ResponseEntity.ok(ApiResponse.ok(response.getMessage(), response));
    }

    /**
     * Khách hàng yêu cầu tạo mã OTP mới (Hiệu lực 5 phút)
     * Hỗ trợ kiểm tra số điện thoại khách hàng (Chống IDOR)
     */
    @PostMapping("/request-otp")
    public ResponseEntity<ApiResponse<String>> requestOtp(
            @RequestParam String orderId,
            @RequestParam String customerPhone,
            Authentication authentication) {
        // GĐ73 (N1) — chống IDOR: SĐT gửi lên phải là SĐT của CHÍNH tài khoản đang đăng nhập.
        // Trước GĐ73 chỉ so SĐT gửi lên với SĐT của đơn ⇒ khách A biết orderId + SĐT của khách B
        // là xin được OTP của B (trả thẳng trong response) rồi mở tủ của B.
        String sdtPhien = authentication == null || authentication.getName() == null ? null
                : userRepository.findByUsername(authentication.getName()).map(User::getPhone).orElse(null);
        if (sdtPhien == null || customerPhone == null || !sdtPhien.trim().equalsIgnoreCase(customerPhone.trim())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error(DENY_OTP));
        }
        String otp = pickupService.generateNewOtp(orderId, customerPhone);
        return ResponseEntity.ok(ApiResponse.ok("Tạo mã OTP thành công (hiệu lực 5 phút)!", otp));
    }

    /**
     * GĐ20 — Sự kiện Kiosk của tủ, dành cho **web khách hàng**.
     *
     * <p><b>Vì sao khách cần endpoint này:</b> khi khách đứng ở tủ và bấm "nhận hàng bằng QR/OTP"
     * trên màn hình tủ, firmware phát {@code ptit/{dev}/receive/method}. Backend ghi sự kiện, và
     * web khách poll endpoint này để <b>tự mở</b> đúng modal (QR hoặc OTP) — khách không phải bấm
     * thêm lần nữa trên điện thoại.
     *
     * <p><b>Bảo mật — đọc kỹ trước khi mở rộng:</b> endpoint trả về sự kiện của <b>mọi khách đứng
     * cùng tủ</b> (bộ đệm gắn theo TỦ, giống {@code /api/shipper/kiosk-events}), nên nó chỉ chứa
     * {@code orderId}, {@code trackingCode}, {@code compartment}, {@code message} — <b>TUYỆT ĐỐI
     * KHÔNG được đưa {@code qrToken}/{@code otpCode} vào {@code KioskEvent}</b>. Nếu cần mã mở tủ,
     * phải đi qua {@code POST /api/pickup/request-otp} hoặc {@code GET /api/orders/{id}?phone=...},
     * nơi có kiểm chủ sở hữu theo SĐT.
     *
     * <p>Cùng kiểu trả {@link KioskEventDTO} với endpoint của shipper — không tạo DTO thứ hai, để
     * hai màn hình đọc cùng một hợp đồng.
     */
    @GetMapping("/kiosk-events")
    public ResponseEntity<ApiResponse<KioskEventDTO>> getKioskEvents(
            @RequestParam(required = false) String lockerId,
            @RequestParam(required = false) Long after) {
        KioskEventDTO payload = KioskEventDTO.builder()
                .latestSeq(kioskEventService.latestSeq())
                .events(kioskEventService.since(lockerId, after))
                .build();
        return ResponseEntity.ok(ApiResponse.ok("Lấy sự kiện Kiosk thành công", payload));
    }
}
