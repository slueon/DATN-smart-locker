package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.service.ShipperService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/shipper")
public class ShipperController {

    private final ShipperService shipperService;

    public ShipperController(ShipperService shipperService) {
        this.shipperService = shipperService;
    }

    /**
     * Shipper bấm "Xác minh danh tính" trên Web Mobile -> Sinh mã QR động 60s.
     *
     * <p><b>ĐÃ BỊT:</b> trước đây nhận `@RequestParam(defaultValue = "SHIPPER_001") shipperId`,
     * nên bất kỳ ai gọi endpoint cũng xin được mã QR định danh cho shipper bất kỳ (kể cả
     * SHIPPER_001) rồi đem quét tại tủ để mở quyền giao hàng. Nay `shipperId` lấy từ
     * danh tính đã đăng nhập (principal), client KHÔNG tự khai được.
     */
    @PostMapping("/token/generate")
    public ResponseEntity<ApiResponse<ShipperDTO.GenerateTokenResponse>> generateToken(
            java.security.Principal principal) {
        String shipperId = (principal != null && principal.getName() != null)
                ? principal.getName().trim()
                : "";
        if (shipperId.isEmpty()) {
            return ResponseEntity.status(401)
                    .body(ApiResponse.error("Chưa xác thực: vui lòng đăng nhập bằng tài khoản shipper!"));
        }
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

    /**
     * T3 — Danh sách đơn PENDING để shipper chọn đặt trước trên web.
     *
     * <p>Mỗi phần tử có {@code trackingCode} (= {@code tracking_code} nếu đã đặt, ngược lại
     * {@code order_id}) và {@code compartmentIndex} (null nghĩa là chưa giữ ngăn).
     */
    @GetMapping("/orders/pending")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getPendingOrders(
            @RequestParam(required = false) String lockerId) {
        List<OrderDTO.OrderResponse> response = shipperService.getPendingOrders(lockerId);
        return ResponseEntity.ok(ApiResponse.ok("Lấy danh sách đơn chờ gửi thành công", response));
    }

    /**
     * T3 — Đặt trước một ngăn cụ thể cho đơn PENDING (shipper chọn trên WEB, Q2).
     */
    @PostMapping("/orders/{orderId}/reserve")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> reserveCompartment(
            @PathVariable String orderId,
            @RequestBody(required = false) OrderDTO.ReserveRequest request) {
        try {
            String trackingCode = request != null ? request.getTrackingCode() : null;
            Integer compartmentIndex = request != null ? request.getCompartmentIndex() : null;
            OrderDTO.OrderResponse response =
                    shipperService.reserveCompartment(orderId, trackingCode, compartmentIndex);
            return ResponseEntity.ok(ApiResponse.ok(
                    "Đặt trước ngăn " + response.getCompartmentIndex() + " cho đơn " + orderId + " thành công!",
                    response));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * T3 — Huỷ đặt trước, nhả ngăn về EMPTY và hoàn 1 slot.
     */
    @DeleteMapping("/orders/{orderId}/reserve")
    public ResponseEntity<ApiResponse<Void>> cancelReserve(@PathVariable String orderId) {
        try {
            shipperService.cancelReserve(orderId);
            return ResponseEntity.ok(ApiResponse.ok(
                    "Đã huỷ đặt trước cho đơn " + orderId + " và nhả ngăn về trống.", null));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Shipper truy vấn danh sách bưu kiện quá hạn cần thu hồi
     */
    @GetMapping("/overdue-orders")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getOverdueOrders(
            @RequestParam(required = false) String lockerId) {
        List<OrderDTO.OrderResponse> response = shipperService.getOverdueOrders(lockerId);
        return ResponseEntity.ok(ApiResponse.ok("Lấy danh sách đơn hàng quá hạn thành công", response));
    }

    /**
     * Shipper xác nhận thu hồi bưu kiện quá hạn về kho bãi và giải phóng ngăn tủ
     */
    @PostMapping("/recall-overdue")
    public ResponseEntity<ApiResponse<Void>> recallOverdue(@RequestParam String orderId) {
        try {
            shipperService.recallOverduePackage(orderId);
            return ResponseEntity.ok(ApiResponse.ok("Thu hồi bưu kiện " + orderId + " về kho bãi thành công!", null));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }
}
