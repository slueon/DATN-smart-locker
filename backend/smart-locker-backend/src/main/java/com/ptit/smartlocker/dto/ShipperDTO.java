package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

public class ShipperDTO {

    @Getter
    @Setter
    @Builder
    public static class GenerateTokenResponse {
        private String shipperId;
        private String dynamicToken;
        private LocalDateTime expiresAt;
        private int validitySeconds; // 60s

        public GenerateTokenResponse() {
        }

        public GenerateTokenResponse(String shipperId, String dynamicToken, LocalDateTime expiresAt, int validitySeconds) {
            this.shipperId = shipperId;
            this.dynamicToken = dynamicToken;
            this.expiresAt = expiresAt;
            this.validitySeconds = validitySeconds;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class VerifyTokenRequest {
        private String dynamicToken;
        private String lockerId;

        public VerifyTokenRequest() {
        }

        public VerifyTokenRequest(String dynamicToken, String lockerId) {
            this.dynamicToken = dynamicToken;
            this.lockerId = lockerId;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class DepositPackageRequest {
        private String lockerId;
        private String dynamicToken; // Shipper's verified token
        private String orderId;      // Barcode scanned from package
        private Double weightGrams;  // Đọc từ Loadcell HX711
        private Boolean isDoorClosed;// Đọc từ công tắc từ MC-38

        public DepositPackageRequest() {
        }

        public DepositPackageRequest(String lockerId, String dynamicToken, String orderId, Double weightGrams, Boolean isDoorClosed) {
            this.lockerId = lockerId;
            this.dynamicToken = dynamicToken;
            this.orderId = orderId;
            this.weightGrams = weightGrams;
            this.isDoorClosed = isDoorClosed;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class DepositResponse {
        private boolean success;
        private String message;
        private String orderId;
        private Integer compartmentIndex;
        private Integer relayPin;
        private String lockerId;

        public DepositResponse() {
        }

        public DepositResponse(boolean success, String message, String orderId, Integer compartmentIndex, Integer relayPin, String lockerId) {
            this.success = success;
            this.message = message;
            this.orderId = orderId;
            this.compartmentIndex = compartmentIndex;
            this.relayPin = relayPin;
            this.lockerId = lockerId;
        }
    }
}
