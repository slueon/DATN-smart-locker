package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

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
     * 3. Cấp tài khoản mới: CHỈ QUẢN TRỊ VIÊN CÓ QUYỀN CẤP (Dành cho Shipper hoặc Admin phụ)
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
}
