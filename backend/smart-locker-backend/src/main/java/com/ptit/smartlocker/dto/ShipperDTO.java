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
        /** GĐ15 — luôn là mốc {@code 9999-12-31T23:59:59}: mã QR shipper KHÔNG còn hạn. */
        private LocalDateTime expiresAt;
        /** GĐ15 — {@code 0} = không giới hạn thời gian sống (trước đây là 60 giây). */
        private int validitySeconds;

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
     * GĐ21 — một KHÁCH HÀNG để shipper chọn khi tạo đơn hộ.
     *
     * <p><b>Vì sao chỉ 3 field:</b> màn "Thêm đơn" chỉ cần biết gán đơn cho ai. KHÔNG trả
     * {@code password}, {@code role}, {@code createdAt} — dữ liệu thừa ở API nội bộ là bề mặt tấn
     * công miễn phí, và {@code password} thì tuyệt đối không bao giờ được ra khỏi CSDL.
     *
     * <p>{@code userId} để frontend giữ khoá ổn định khi SĐT/tên bị sửa.
     */
    @Getter
    @Setter
    @Builder
    public static class CustomerOptionResponse {
        private Long userId;
        /**
         * GĐ51 — tên đăng nhập, KHOÁ DUY NHẤT để chọn khách.
         *
         * <p>Trước GĐ51 DTO này cố ý không trả `username` (GĐ21 chỉ cần hiển thị), nên hộp chọn chỉ
         * có họ tên. Họ tên KHÔNG duy nhất — hai khách cùng tên là chọn nhầm người. Nay UI gửi
         * `username` (hoặc `userId`) và backend tra theo khoá đó; `fullName` chỉ để HIỂN THỊ.
         */
        private String username;
        private String fullName;
        private String phone;

        public CustomerOptionResponse() {
        }

        public CustomerOptionResponse(Long userId, String username, String fullName, String phone) {
            this.userId = userId;
            this.username = username;
            this.fullName = fullName;
            this.phone = phone;
        }
    }

    /** Request gán tủ; các trường đặt ngăn cũ được giữ để tương thích nhưng không còn sử dụng. */
    @Getter
    @Setter
    @Builder
    public static class AssignLockerRequest {
        private String lockerId;
        private Integer compartmentIndex;
        /** @deprecated Đặt ngăn qua {@code ReserveRequest}, không qua gán tủ. */
        private Integer reserveHours;

        public AssignLockerRequest() {
        }

        /** Constructor giữ tương thích với các client cũ. */
        public AssignLockerRequest(String lockerId, Integer compartmentIndex, Integer reserveHours) {
            this.lockerId = lockerId;
            this.compartmentIndex = compartmentIndex;
            this.reserveHours = reserveHours;
        }

        public AssignLockerRequest(String lockerId, Integer compartmentIndex) {
            this(lockerId, compartmentIndex, null);
        }
    }

    /**
     * GĐ51 — body của {@code POST /api/shipper/overdue-orders} (nút "+ Thêm đơn quá hạn").
     *
     * <p><b>KHÔNG có trường "người tạo":</b> danh tính lấy từ {@code Principal} của phiên đăng nhập
     * (cùng luật với {@code recall-overdue}) — client không được tự khai danh tính.
     *
     * <p>Cả hai trường đều tuỳ chọn: bỏ trống thì backend dùng tủ {@code LOCKER_HN_01} và khách
     * {@code khachhang} (đúng bộ dữ liệu mẫu của dự án).
     */
    @Getter
    @Setter
    @Builder
    public static class CreateOverdueOrderRequest {
        /** Mã tủ trong CSDL (vd. {@code LOCKER_HN_01}); bỏ trống = tủ mặc định. */
        private String lockerId;
        /**
         * KHOÁ DUY NHẤT của khách: tên đăng nhập (hoặc mã {@code userId} dạng chuỗi).
         *
         * <p>Bỏ trống = {@code khachhang}. <b>KHÔNG nhận họ tên</b> — họ tên có thể trùng nên sẽ gán
         * nhầm đơn cho người khác (Chief chốt 16:41). `fullName` chỉ để hiển thị ở UI.
         */
        private String customerUsername;

        public CreateOverdueOrderRequest() {
        }

        public CreateOverdueOrderRequest(String lockerId, String customerUsername) {
            this.lockerId = lockerId;
            this.customerUsername = customerUsername;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class CreateOrderByAdminRequest {
        private String customerUsername;
        private String lockerId;
        private String productName;
        private java.math.BigDecimal totalAmount;
        private String paymentMethod;
        private String paymentStatus;
        private Long shipperUserId;
        private String shipperUsername;

        public CreateOrderByAdminRequest() {}

        public CreateOrderByAdminRequest(String customerUsername, String lockerId, String productName,
                                         java.math.BigDecimal totalAmount, String paymentMethod,
                                         String paymentStatus, Long shipperUserId, String shipperUsername) {
            this.customerUsername = customerUsername;
            this.lockerId = lockerId;
            this.productName = productName;
            this.totalAmount = totalAmount;
            this.paymentMethod = paymentMethod;
            this.paymentStatus = paymentStatus;
            this.shipperUserId = shipperUserId;
            this.shipperUsername = shipperUsername;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class AssignShipperRequest {
        private Long shipperUserId;
        private String shipperUsername;

        public AssignShipperRequest() {}

        public AssignShipperRequest(Long shipperUserId, String shipperUsername) {
            this.shipperUserId = shipperUserId;
            this.shipperUsername = shipperUsername;
        }
    }

    @Getter
    @Setter
    @Builder
    public static class ShipperOptionResponse {
        private Long userId;
        private String username;
        private String fullName;
        private String phone;

        public ShipperOptionResponse() {}

        public ShipperOptionResponse(Long userId, String username, String fullName, String phone) {
            this.userId = userId;
            this.username = username;
            this.fullName = fullName;
            this.phone = phone;
        }
    }
}
