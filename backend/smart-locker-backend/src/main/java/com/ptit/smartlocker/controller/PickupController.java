package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.KioskEventDTO;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.service.KioskEventService;
import com.ptit.smartlocker.service.PickupService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/pickup")
public class PickupController {

    private final PickupService pickupService;
    private final KioskEventService kioskEventService;

    public PickupController(PickupService pickupService, KioskEventService kioskEventService) {
        this.pickupService = pickupService;
        this.kioskEventService = kioskEventService;
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
            @RequestParam String customerPhone) {
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
