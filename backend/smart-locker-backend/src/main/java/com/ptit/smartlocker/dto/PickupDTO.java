package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

/**
 * DTO định nghĩa đối tượng dữ liệu cho nghiệp vụ nhận hàng tại Kiosk (Mã OTP & Mã QR)
 */
public class PickupDTO {

    @Getter
    @Setter
    @Builder
    public static class VerifyCredentialRequest {
        private String lockerId;
        private String authMethod; // "OTP" hoặc "QR"
        private String pickupMethod; // Hỗ trợ tương thích ngược với frontend
        private String code; // 6-digit OTP hoặc chuỗi QR
        private String orderId; // Tùy chọn: Mã đơn hàng (nếu kiosk gửi kèm để đối chiếu)

        public VerifyCredentialRequest() {
        }

        public VerifyCredentialRequest(String lockerId, String authMethod, String pickupMethod, String code, String orderId) {
            this.lockerId = lockerId;
            this.authMethod = authMethod;
            this.pickupMethod = pickupMethod;
            this.code = code;
            this.orderId = orderId;
        }

        public String getAuthMethod() {
            if (authMethod != null && !authMethod.isBlank()) return authMethod;
            return pickupMethod;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class PickupResponse {
        private boolean success;
        private String message;
        private String orderId;
        private Integer compartmentIndex;
        private Integer relayPin;
        private String customerName;

        public PickupResponse() {
        }

        public PickupResponse(boolean success, String message, String orderId, Integer compartmentIndex, Integer relayPin, String customerName) {
            this.success = success;
            this.message = message;
            this.orderId = orderId;
            this.compartmentIndex = compartmentIndex;
            this.relayPin = relayPin;
            this.customerName = customerName;
        }
    }
}
