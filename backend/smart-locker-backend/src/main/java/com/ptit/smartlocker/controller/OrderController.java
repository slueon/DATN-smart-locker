package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.service.OrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    /**
     * Đặt hàng E-Commerce (Áp dụng Pessimistic Locking chống Race Condition)
     */
    @PostMapping("/checkout")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> checkout(@RequestBody OrderDTO.CheckoutRequest request) {
        try {
            OrderDTO.OrderResponse response = orderService.createOrder(request);
            return ResponseEntity.ok(ApiResponse.ok("Đặt hàng thành công!", response));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Tra cứu chi tiết đơn hàng (Hỗ trợ xác thực số điện thoại để chống IDOR)
     */
    @GetMapping("/{orderId}")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> getOrderById(
            @PathVariable String orderId,
            @RequestParam(required = false) String phone) {
        try {
            OrderDTO.OrderResponse order = orderService.getOrderById(orderId, phone);
            return ResponseEntity.ok(ApiResponse.ok(order));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Tra cứu danh sách đơn hàng theo số điện thoại khách hàng
     */
    @GetMapping("/by-phone")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getOrdersByPhone(@RequestParam String phone) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.getOrdersByCustomerPhone(phone)));
    }
}
