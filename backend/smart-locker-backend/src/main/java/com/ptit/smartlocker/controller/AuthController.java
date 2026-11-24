package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.service.AuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * 1. Đăng nhập dành cho cả 3 nhân vật: KHÁCH HÀNG, SHIPPER, QUẢN TRỊ VIÊN
     */
    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthDTO.UserResponse>> login(@RequestBody AuthDTO.LoginRequest request) {
        try {
            AuthDTO.UserResponse user = authService.login(request);
            return ResponseEntity.ok(ApiResponse.ok("Đăng nhập thành công!", user));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/login/replace-session")
    public ResponseEntity<ApiResponse<AuthDTO.UserResponse>> replaceActiveSession(
            @RequestBody AuthDTO.LoginRequest request) {
        try {
            AuthDTO.UserResponse user = authService.replaceActiveSession(request);
            return ResponseEntity.ok(ApiResponse.ok("Đăng nhập thành công trên phiên mới.", user));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Integer>> logout(Authentication authentication) {
        try {
            int deletedSessions = authService.logout(authentication.getName());
            return ResponseEntity.ok(ApiResponse.ok(
                    "Đăng xuất thành công. Đã thu hồi " + deletedSessions + " phiên.", deletedSessions));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * 2. Đăng ký tài khoản: CHỈ DÀNH CHO KHÁCH HÀNG
     */
    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthDTO.UserResponse>> register(@RequestBody AuthDTO.RegisterRequest request) {
        try {
            AuthDTO.UserResponse user = authService.registerCustomer(request);
            return ResponseEntity.ok(ApiResponse.ok("Đăng ký tài khoản Khách hàng thành công!", user));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * 3. Cấp tài khoản mới: CHỈ QUẢN TRỊ VIÊN CÓ QUYỀN CẤP
     */
    @PostMapping("/admin/create-user")
    public ResponseEntity<ApiResponse<AuthDTO.UserResponse>> createUserByAdmin(
            @RequestBody AuthDTO.CreateAccountByAdminRequest request) {
        try {
            AuthDTO.UserResponse user = authService.createAccountByAdmin(request);
            return ResponseEntity.ok(ApiResponse.ok("Quản trị viên cấp tài khoản thành công!", user));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * 4. Lấy danh sách toàn bộ người dùng (Dành cho Quản trị viên)
     */
    @GetMapping("/users")
    public ResponseEntity<ApiResponse<List<AuthDTO.UserResponse>>> getAllUsers(
            @RequestParam(required = false) String role) {
        List<AuthDTO.UserResponse> users = (role != null && !role.isBlank())
                ? authService.getUsersByRole(role)
                : authService.getAllUsers();
        return ResponseEntity.ok(ApiResponse.ok(users));
    }

    @PatchMapping("/admin/users/{userId}/role")
    public ResponseEntity<ApiResponse<AuthDTO.UserResponse>> updateUserRole(
            @PathVariable Long userId,
            @RequestBody AuthDTO.UpdateUserRoleRequest request,
            Authentication authentication) {
        try {
            AuthDTO.UserResponse user = authService.updateUserRole(
                    userId, request.getRole(), authentication.getName());
            return ResponseEntity.ok(ApiResponse.ok("Cập nhật vai trò thành công.", user));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    @DeleteMapping("/admin/users/{userId}")
    public ResponseEntity<ApiResponse<Void>> deleteUser(
            @PathVariable Long userId,
            Authentication authentication) {
        try {
            authService.deleteUser(userId, authentication.getName());
            return ResponseEntity.ok(ApiResponse.ok("Xóa tài khoản thành công.", null));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }
}
