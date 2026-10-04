package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

public class PickupDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class VerifyCredentialRequest {
        private String lockerId;
        private String authMethod; // "OTP" hoặc "QR"
        private String code;       // 6-digit OTP hoặc chuỗi QR
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class PickupResponse {
        private boolean success;
        private String message;
        private String orderId;
        private Integer compartmentIndex;
        private Integer relayPin;
        private String customerName;
    }
}
