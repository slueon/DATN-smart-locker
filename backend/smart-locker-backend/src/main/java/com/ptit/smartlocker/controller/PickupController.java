package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.service.PickupService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/pickup")
@RequiredArgsConstructor
public class PickupController {

    private final PickupService pickupService;

    /**
     * Khách hàng lấy đồ tại tủ (Hỗ trợ xác thực bằng mã OTP 6 số hoặc quét mã QR qua GM65)
     */
    @PostMapping("/verify")
    public ResponseEntity<ApiResponse<PickupDTO.PickupResponse>> verifyPickup(
            @RequestBody PickupDTO.VerifyCredentialRequest request) {
        try {
            PickupDTO.PickupResponse response = pickupService.verifyAndPickup(request);
            return ResponseEntity.ok(ApiResponse.ok(response.getMessage(), response));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }
}
