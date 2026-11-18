package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.NotificationDTO;
import com.ptit.smartlocker.service.NotificationService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

/**
 * GĐ64a — thông báo của NGƯỜI ĐANG ĐĂNG NHẬP.
 *
 * <p><b>Danh tính chỉ lấy từ {@code SecurityContext}</b> (username do {@code TokenAuthFilter} đặt
 * từ phiên Bearer) → {@code users} → phone/role. Cố ý KHÔNG có tham số phone/role nào: nhận từ
 * client là IDOR (ai cũng đọc được thông báo của SĐT bất kỳ).
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<NotificationDTO.ListResponse>> list() {
        return ResponseEntity.ok(ApiResponse.ok("Lấy thông báo thành công",
                notificationService.listMine(currentUsername())));
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<ApiResponse<Void>> markRead(@PathVariable Long id) {
        notificationService.markRead(currentUsername(), id);
        return ResponseEntity.ok(ApiResponse.ok("Đã đánh dấu đã đọc", null));
    }

    @PostMapping("/read-all")
    public ResponseEntity<ApiResponse<NotificationDTO.ReadAllResponse>> markAllRead() {
        int updated = notificationService.markAllRead(currentUsername());
        return ResponseEntity.ok(ApiResponse.ok("Đã đánh dấu tất cả đã đọc",
                NotificationDTO.ReadAllResponse.builder().updated(updated).build()));
    }

    private static String currentUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth instanceof AnonymousAuthenticationToken) {
            return null; // service ném ResourceNotFoundException ⇒ 404, không lộ dữ liệu
        }
        return auth.getName();
    }
}
