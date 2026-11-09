package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.service.PickupService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/pickup")
public class PickupController {

    private final PickupService pickupService;

    public PickupController(PickupService pickupService) {
        this.pickupService = pickupService;
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
}
