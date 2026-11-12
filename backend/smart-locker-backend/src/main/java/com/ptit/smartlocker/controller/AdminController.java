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
    private final com.ptit.smartlocker.service.LockerService lockerService;
    private final com.ptit.smartlocker.service.OverdueSchedulerService overdueSchedulerService;

    public AdminController(OrderService orderService,
                           com.ptit.smartlocker.service.LockerService lockerService,
                           com.ptit.smartlocker.service.OverdueSchedulerService overdueSchedulerService) {
        this.orderService = orderService;
        this.lockerService = lockerService;
        this.overdueSchedulerService = overdueSchedulerService;
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

    /**
     * GĐ10 ý 4 — nhật ký bảo trì tủ/ngăn.
     *
     * <p>Trả lời "ai đã khoá tủ này, vì sao, lúc nào" — thứ {@code command_logs} không làm được
     * vì bảng đó ghi lệnh kỹ thuật chứ không ghi ý định của người vận hành.
     *
     * @param lockerId bỏ trống = mọi tủ
     * @param limit    số dòng tối đa (mặc định 50, chặn 1..200)
     */
    @GetMapping("/maintenance-logs")
    public ResponseEntity<ApiResponse<List<com.ptit.smartlocker.dto.MaintenanceLogDTO>>> getMaintenanceLogs(
            @RequestParam(required = false) String lockerId,
            @RequestParam(required = false, defaultValue = "50") Integer limit) {
        List<com.ptit.smartlocker.dto.MaintenanceLogDTO> logs =
                lockerService.getMaintenanceLogs(lockerId, limit);
        return ResponseEntity.ok(ApiResponse.ok(
                "Lấy nhật ký bảo trì thành công (" + logs.size() + " bản ghi)", logs));
    }

    /**
     * GĐ13 — chạy NGAY một lượt quét đơn quá hạn.
     *
     * <p><b>Vì sao cần:</b> nút "Quét đơn quá hạn" trên web trước đây gọi
     * {@code store.checkAndScanOverdueOrders()} — quét một mảng trong {@code localStorage} rồi báo
     * "phát hiện X đơn". Con số đó là của trình duyệt, không liên quan gì tới CSDL: bấm xong DB
     * vẫn y nguyên, và số báo ra có thể khác hoàn toàn với số đơn quá hạn thật.
     *
     * <p>Endpoint gọi đúng tác vụ mà {@code @Scheduled} chạy mỗi 10 phút, nên kết quả là thật.
     * CHỈ ADMIN: đây là thao tác hàng loạt đổi trạng thái đơn của toàn hệ thống.
     */
    @org.springframework.web.bind.annotation.PostMapping("/scan-overdue")
    public ResponseEntity<ApiResponse<Integer>> scanOverdue() {
        int changed = overdueSchedulerService.scanAndLockOverdueOrders();
        return ResponseEntity.ok(ApiResponse.ok(
                "Đã quét đơn quá hạn: " + changed + " đơn vừa chuyển sang OVERDUE", changed));
    }
}
