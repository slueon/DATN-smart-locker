package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.service.OrderService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * GĐ7 — API riêng cho ADMIN.
 *
 * <p><b>Vì sao tạo controller mới thay vì nhét vào {@code OrderController}:</b> đường dẫn
 * {@code /api/admin/**} đã có sẵn một luật duy nhất trong {@code SecurityConfig}
 * ({@code .requestMatchers("/api/auth/admin/**").hasRole("ADMIN")} — cùng nhóm quản trị), nên
 * quyền được khoá ở đúng một nơi và không phải thêm matcher cho từng endpoint lẻ. Nếu nhét vào
 * {@code OrderController} (đường dẫn {@code /api/orders/**}) thì phải thêm matcher
 * {@code GET /api/orders/admin-list} và **phải đặt trước** luật
 * {@code .requestMatchers(HttpMethod.GET, "/api/orders/**").authenticated()} — rất dễ đặt sai
 * thứ tự và âm thầm cho CUSTOMER đọc được toàn bộ đơn của hệ thống.
 *
 * <p>Controller này chỉ phục vụ mục đích quản trị; mọi method ở đây đều là "chỉ đọc".
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final OrderService orderService;

    public AdminController(OrderService orderService) {
        this.orderService = orderService;
    }

    /**
     * Danh sách đơn cho dashboard quản trị.
     *
     * <p>Trước GĐ7 không có endpoint nào trả danh sách đơn cho ADMIN, nên
     * {@code AdminTab} phải tính 3 chỉ số KPI (đã giao, quá hạn, doanh thu) từ
     * {@code localStorage} — số liệu có thể lệch hoàn toàn so với DB thật.
     *
     * @param status  {@code PENDING|DEPOSITED|COMPLETED|OVERDUE|CANCELLED|ALL} (mặc định ALL)
     * @param lockerId lọc theo tủ; bỏ trống = mọi tủ
     */
    @GetMapping("/orders")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getOrders(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String lockerId) {
        List<OrderDTO.OrderResponse> orders = orderService.getOrdersForAdmin(status, lockerId);
        return ResponseEntity.ok(ApiResponse.ok(
                "Lấy danh sách đơn hàng thành công (" + orders.size() + " đơn)", orders));
    }
}
