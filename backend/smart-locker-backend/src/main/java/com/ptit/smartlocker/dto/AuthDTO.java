package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

public class AuthDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class LoginRequest {
        private String username; // Có thể nhập username hoặc số điện thoại
        private String password;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class RegisterRequest {
        private String username;
        private String password;
        private String fullName;
        private String phone;
        // Role cố định là CUSTOMER, không cho phép client truyền role khác
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CreateAccountByAdminRequest {
        private String username;
        private String password;
        private String fullName;
        private String phone;
        private String role; // 'SHIPPER' hoặc 'ADMIN'
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class UserResponse {
        private Long id;
        private String username;
        private String fullName;
        private String phone;
        private String role;
        private LocalDateTime createdAt;
    }
}
