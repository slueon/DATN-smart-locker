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

    /**
     * GĐ11 — một tủ mà shipper CÓ THỂ chọn để giao đơn, do backend lọc sẵn.
     *
     * <p>Chỉ là <b>gợi ý</b>: shipper vẫn tự quyết định. Backend lọc cứng 4 điều kiện (còn ngăn
     * trống đúng cỡ, không bảo trì, có nhịp tim trong 5 phút, lấp đầy dưới 80%) để shipper không
     * phải tự đọc bảng sức chứa rồi chọn nhầm tủ đang chết hoặc đã kín.
     */
    @Getter
    @Setter
    @Builder
    public static class SuggestLockerResponse {
        private String lockerId;
        private String name;
        private String address;
        private Double latitude;
        private Double longitude;
        /** Số ngăn EMPTY có cỡ chứa được kiện của đơn này. */
        private Integer availableCompartments;
        /** Tổng số ngăn thực tế trong bảng `compartments` của tủ. */
        private Integer totalCompartments;
        private String connectionStatus;
        /** ONLINE / Không rõ / MẤT KẾT NỐI — suy từ `lastHeartbeat`, KHÔNG đọc `connection_status`. */
        private String healthLabel;
        /** true nếu đây là tủ đang gán trong đơn (tủ đề xuất lúc tạo đơn). */
        private Boolean isSuggestedByOrder;

        public SuggestLockerResponse() {
        }

        /**
         * Constructor đủ tham số — {@code @Builder} của Lombok cần một constructor bao trùm mọi
         * field. Thiếu nó thì builder gọi constructor rỗng và không biên dịch được (đã dính lỗi
         * này ngay lần compile đầu).
         */
        public SuggestLockerResponse(String lockerId, String name, String address, Double latitude,
                                     Double longitude, Integer availableCompartments, Integer totalCompartments,
                                     String connectionStatus, String healthLabel, Boolean isSuggestedByOrder) {
            this.lockerId = lockerId;
            this.name = name;
            this.address = address;
            this.latitude = latitude;
            this.longitude = longitude;
            this.availableCompartments = availableCompartments;
            this.totalCompartments = totalCompartments;
            this.connectionStatus = connectionStatus;
            this.healthLabel = healthLabel;
            this.isSuggestedByOrder = isSuggestedByOrder;
        }
    }

    /**
     * GĐ11 — shipper chốt tủ cho đơn. {@code compartmentIndex} để trống thì backend tự chọn ngăn
     * trống phù hợp cỡ kiện.
     */
    @Getter
    @Setter
    @Builder
    public static class AssignLockerRequest {
        private String lockerId;
        private Integer compartmentIndex;

        public AssignLockerRequest() {
        }

        public AssignLockerRequest(String lockerId, Integer compartmentIndex) {
            this.lockerId = lockerId;
            this.compartmentIndex = compartmentIndex;
        }
    }
}
