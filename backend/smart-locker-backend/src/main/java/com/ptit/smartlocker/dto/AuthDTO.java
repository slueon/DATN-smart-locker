package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

public class AuthDTO {

    @Getter
    @Setter
    @Builder
    public static class LoginRequest {
        private String username; // Có thể nhập username hoặc số điện thoại
        private String password;

        public LoginRequest() {
        }

        public LoginRequest(String username, String password) {
            this.username = username;
            this.password = password;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class RegisterRequest {
        private String username;
        private String password;
        private String fullName;
        private String phone;
        // Role cố định là CUSTOMER, không cho phép client truyền role khác

        public RegisterRequest() {
        }

        public RegisterRequest(String username, String password, String fullName, String phone) {
            this.username = username;
            this.password = password;
            this.fullName = fullName;
            this.phone = phone;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class CreateAccountByAdminRequest {
        private String username;
        private String password;
        private String fullName;
        private String phone;
        private String role; // 'SHIPPER' hoặc 'ADMIN'

        public CreateAccountByAdminRequest() {
        }

        public CreateAccountByAdminRequest(String username, String password, String fullName, String phone, String role) {
            this.username = username;
            this.password = password;
            this.fullName = fullName;
            this.phone = phone;
            this.role = role;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class UserResponse {
        private Long id;
        private String username;
        private String fullName;
        private String phone;
        private String role;
        private LocalDateTime createdAt;

        public UserResponse() {
        }

        public UserResponse(Long id, String username, String fullName, String phone, String role, LocalDateTime createdAt) {
            this.id = id;
            this.username = username;
            this.fullName = fullName;
            this.phone = phone;
            this.role = role;
            this.createdAt = createdAt;
        }
    }
}
