package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.OrderService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private static final String ROLE_ADMIN = "ROLE_ADMIN";
    private static final String DENY_PHONE = "Bạn không có quyền xem đơn hàng của số điện thoại này!";

    private final OrderService orderService;
    private final UserRepository userRepository;

    public OrderController(OrderService orderService, UserRepository userRepository) {
        this.orderService = orderService;
        this.userRepository = userRepository;
    }

    /**
     * Đặt hàng E-Commerce (Áp dụng Pessimistic Locking chống Race Condition)
     *
     * <p><b>GĐ10 — đã bỏ {@code catch (Exception)} ở đây.</b> Trước đó mọi ngoại lệ bị nuốt và
     * trả về 400, nên {@code BusinessException} (ví dụ "tủ đang bảo trì") mất đúng mã 409 mà
     * {@code GlobalExceptionHandler} đã ánh xạ. Controller không còn quyết định status — việc đó
     * thuộc về advice, một nguồn duy nhất.
     */
    @PostMapping("/checkout")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> checkout(@RequestBody OrderDTO.CheckoutRequest request) {
        OrderDTO.OrderResponse response = orderService.createOrder(request);
        return ResponseEntity.ok(ApiResponse.ok("Đặt hàng thành công!", response));
    }

    /**
     * Tra cứu chi tiết đơn hàng (Hỗ trợ xác thực số điện thoại để chống IDOR).
     *
     * <p>W3: CUSTOMER chỉ được dùng SĐT của chính mình. Nếu không phải ADMIN mà tham số
     * {@code phone} không trùng SĐT của chủ phiên thì từ chối 403 — nếu không, bất kỳ ai biết
     * SĐT của người khác đều đọc được qrToken/otpCode của đơn DEPOSITED và mở được tủ.
     */
    @GetMapping("/{orderId}")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> getOrderById(
            @PathVariable String orderId,
            @RequestParam(required = false) String phone,
            Authentication authentication) {
        if (phone != null && !phone.isBlank() && !isAdmin(authentication)
                && !phone.equalsIgnoreCase(nullToEmpty(currentPhone(authentication)))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error(DENY_PHONE));
        }
        try {
            OrderDTO.OrderResponse order = orderService.getOrderById(orderId, phone);
            return ResponseEntity.ok(ApiResponse.ok(order));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Tra cứu danh sách đơn hàng theo số điện thoại khách hàng.
     *
     * <p>W3: khoá theo chủ phiên. ADMIN xem được mọi SĐT; các vai trò khác chỉ xem được
     * SĐT của chính mình (khác → 403). Danh sách không bao giờ chứa qrToken/otpCode —
     * xem {@code OrderService#getOrdersByCustomerPhone}.
     */
    @GetMapping("/by-phone")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getOrdersByPhone(
            @RequestParam String phone,
            Authentication authentication) {
        if (!isAdmin(authentication)
                && !phone.trim().equalsIgnoreCase(nullToEmpty(currentPhone(authentication)))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ApiResponse.error(DENY_PHONE));
        }
        return ResponseEntity.ok(ApiResponse.ok(orderService.getOrdersByCustomerPhone(phone)));
    }

    /** SĐT của người đang đăng nhập (null nếu không tra được — khi đó mọi so khớp đều trượt). */
    private String currentPhone(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            return null;
        }
        return userRepository.findByUsername(authentication.getName())
                .map(User::getPhone)
                .orElse(null);
    }

    private boolean isAdmin(Authentication authentication) {
        return authentication != null && authentication.getAuthorities() != null
                && authentication.getAuthorities().stream()
                        .anyMatch(a -> ROLE_ADMIN.equals(a.getAuthority()));
    }

    private static String nullToEmpty(String value) {
        return value != null ? value : "";
    }
}
