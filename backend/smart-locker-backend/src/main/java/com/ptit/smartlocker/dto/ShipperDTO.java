package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

public class ShipperDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GenerateTokenResponse {
        private String shipperId;
        private String dynamicToken;
        private LocalDateTime expiresAt;
        private int validitySeconds; // 60s
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VerifyTokenRequest {
        private String dynamicToken;
        private String lockerId;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class DepositPackageRequest {
        private String lockerId;
        private String dynamicToken; // Shipper's verified token
        private String orderId;      // Barcode scanned from package
        private Double weightGrams;  // Đọc từ Loadcell HX711
        private Boolean isDoorClosed;// Đọc từ công tắc từ MC-38
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class DepositResponse {
        private boolean success;
        private String message;
        private String orderId;
        private Integer compartmentIndex;
        private Integer relayPin;
        private String lockerId;
    }
}
