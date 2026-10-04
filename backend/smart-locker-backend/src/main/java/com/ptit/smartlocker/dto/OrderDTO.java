package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public class OrderDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CartItemRequest {
        private Long productId;
        private Integer quantity;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CheckoutRequest {
        private String customerName;
        private String customerPhone;
        private String deliveryType; // "LOCKER" hoặc "STANDARD"
        private String lockerId;     // Bắt buộc nếu deliveryType = "LOCKER"
        private LocalDate deliveryDate; // Ngày mong muốn giao vào tủ
        private List<CartItemRequest> items;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class OrderResponse {
        private String orderId;
        private String customerName;
        private String customerPhone;
        private String deliveryType;
        private String lockerId;
        private String lockerName;
        private Integer compartmentIndex;
        private LocalDate expectedDate;
        private LocalDateTime depositedAt;
        private LocalDateTime expiryDeadline;
        private String status;
        private BigDecimal totalAmount;
        private String qrToken;
        private String otpCode;
        private LocalDateTime createdAt;
    }
}
