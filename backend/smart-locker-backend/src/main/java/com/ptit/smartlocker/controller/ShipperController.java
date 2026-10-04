package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.service.ShipperService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/shipper")
@RequiredArgsConstructor
public class ShipperController {

    private final ShipperService shipperService;

    /**
     * Shipper bấm "Xác minh danh tính" trên Web Mobile -> Sinh mã QR động 60s
     */
    @PostMapping("/token/generate")
    public ResponseEntity<ApiResponse<ShipperDTO.GenerateTokenResponse>> generateToken(
            @RequestParam(defaultValue = "SHIPPER_001") String shipperId) {
        ShipperDTO.GenerateTokenResponse response = shipperService.generateDynamicToken(shipperId);
        return ResponseEntity.ok(ApiResponse.ok("Mã QR Shipper đã được tạo, hiệu lực trong 60 giây", response));
    }

    /**
     * Tủ thông minh (GM65) quét mã QR động của Shipper để mở quyền giao hàng
     */
    @PostMapping("/token/verify")
    public ResponseEntity<ApiResponse<Boolean>> verifyToken(@RequestBody ShipperDTO.VerifyTokenRequest request) {
        try {
            boolean isValid = shipperService.verifyDynamicToken(request.getLockerId(), request.getDynamicToken());
            return ResponseEntity.ok(ApiResponse.ok("Xác thực Shipper thành công! Vui lòng quét kiện hàng.", isValid));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Shipper quét mã vận đơn kiện hàng và hoàn tất gửi đồ vào tủ
     * Có tích hợp kiểm tra cảm biến kép: Công tắc từ MC-38 và Cảm biến cân nặng HX711
     */
    @PostMapping("/deposit")
    public ResponseEntity<ApiResponse<ShipperDTO.DepositResponse>> depositPackage(
            @RequestBody ShipperDTO.DepositPackageRequest request) {
        try {
            ShipperDTO.DepositResponse response = shipperService.depositPackage(request);
            return ResponseEntity.ok(ApiResponse.ok(response.getMessage(), response));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }
}
