package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

public class OrderDTO {

    @Getter
    @Setter
    @Builder
    public static class CheckoutRequest {
        private String customerName;
        private String customerPhone;
        private String deliveryType; // "LOCKER" hoặc "STANDARD"
        private String lockerId;     // Bắt buộc nếu deliveryType = "LOCKER"
        private LocalDate deliveryDate; // Ngày mong muốn giao vào tủ
        private String paymentMethod; // "ONLINE_VIETQR", "ONLINE_MOMO", "ONLINE_VNPAY", "COD"
        private String paymentStatus; // "PAID", "UNPAID"
        private String productName;   // Tên hoặc mô tả bưu kiện
        private String requiredSize;  // Kích thước ngăn tủ yêu cầu: "S", "M", "L"
        private BigDecimal totalAmount;

        public CheckoutRequest() {
        }

        public CheckoutRequest(String customerName, String customerPhone, String deliveryType, String lockerId, LocalDate deliveryDate, String paymentMethod, String paymentStatus, String productName, String requiredSize, BigDecimal totalAmount) {
            this.customerName = customerName;
            this.customerPhone = customerPhone;
            this.deliveryType = deliveryType;
            this.lockerId = lockerId;
            this.deliveryDate = deliveryDate;
            this.paymentMethod = paymentMethod;
            this.paymentStatus = paymentStatus;
            this.productName = productName;
            this.requiredSize = requiredSize != null ? requiredSize : "S";
            this.totalAmount = totalAmount;
        }
    }

    @Getter
    @Setter
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
        private String productName;
        private BigDecimal totalAmount;
        private String paymentMethod;
        private String paymentStatus;
        private String qrToken;
        private String otpCode;
        private LocalDateTime createdAt;
        /** T3: mã vận đơn in trên nhãn; null thì coi như bằng orderId. */
        private String trackingCode;

        public OrderResponse() {
        }

        public OrderResponse(String orderId, String customerName, String customerPhone, String deliveryType, String lockerId, String lockerName, Integer compartmentIndex, LocalDate expectedDate, LocalDateTime depositedAt, LocalDateTime expiryDeadline, String status, String productName, BigDecimal totalAmount, String paymentMethod, String paymentStatus, String qrToken, String otpCode, LocalDateTime createdAt) {
            this.orderId = orderId;
            this.customerName = customerName;
            this.customerPhone = customerPhone;
            this.deliveryType = deliveryType;
            this.lockerId = lockerId;
            this.lockerName = lockerName;
            this.compartmentIndex = compartmentIndex;
            this.expectedDate = expectedDate;
            this.depositedAt = depositedAt;
            this.expiryDeadline = expiryDeadline;
            this.status = status;
            this.productName = productName;
            this.totalAmount = totalAmount;
            this.paymentMethod = paymentMethod;
            this.paymentStatus = paymentStatus;
            this.qrToken = qrToken;
            this.otpCode = otpCode;
            this.createdAt = createdAt;
        }

        /** Constructor đầy đủ 19 tham số — Lombok @Builder cần đúng bộ tham số này. */
        public OrderResponse(String orderId, String customerName, String customerPhone, String deliveryType,
                             String lockerId, String lockerName, Integer compartmentIndex, LocalDate expectedDate,
                             LocalDateTime depositedAt, LocalDateTime expiryDeadline, String status, String productName,
                             BigDecimal totalAmount, String paymentMethod, String paymentStatus, String qrToken,
                             String otpCode, LocalDateTime createdAt, String trackingCode) {
            this(orderId, customerName, customerPhone, deliveryType, lockerId, lockerName, compartmentIndex,
                    expectedDate, depositedAt, expiryDeadline, status, productName, totalAmount,
                    paymentMethod, paymentStatus, qrToken, otpCode, createdAt);
            this.trackingCode = trackingCode;
        }
    }

    /**
     * T3 — Yêu cầu đặt trước ngăn tủ cho một đơn PENDING.
     *
     * <p>Shipper chọn ngăn trên WEB (user chốt Q2), không phải trên TFT. {@code trackingCode}
     * là mã in trên nhãn; để trống thì backend giữ/đặt bằng {@code order_id}.
     */
    @Getter
    @Setter
    @Builder
    public static class ReserveRequest {
        private String trackingCode;
        private Integer compartmentIndex;

        public ReserveRequest() {
        }

        public ReserveRequest(String trackingCode, Integer compartmentIndex) {
            this.trackingCode = trackingCode;
            this.compartmentIndex = compartmentIndex;
        }
    }
}
