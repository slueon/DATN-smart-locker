package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
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
        private String lockerId;     // Tủ đích nếu đã chọn; không đặt trước ngăn khi tạo đơn
        private LocalDate deliveryDate; // Ngày mong muốn giao vào tủ
        private String paymentMethod; // "ONLINE_VIETQR", "ONLINE_MOMO", "ONLINE_VNPAY", "COD"
        private String paymentStatus; // "PAID", "UNPAID"
        private String productName;   // Tên hoặc mô tả bưu kiện
        /**
         * GĐ18 — <b>KHÔNG còn dùng để quyết định</b> chọn ngăn nào.
         *
         * <p>Hệ thống đã bỏ phân biệt size: mọi ngăn trống đều nhận được mọi kiện
         * Field này <b>giữ lại để không vỡ contract</b>; giá trị nhận vào không được dùng để giữ
         * ngăn lúc tạo đơn.
         */
        private String requiredSize;  // Giữ cho tương thích — GĐ18: không còn dùng
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
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderResponse {
        private String orderId;
        private String customerName;
        private String customerPhone;
        private String deliveryType;
        private String lockerId;
        private String lockerName;
        /**
         * GĐ36 — ĐỊA CHỈ trạm tủ, để màn khách hiện được "đi tới đâu".
         *
         * <p><b>Vì sao thêm:</b> `CustomerPickupTab:1151` đã render `{selectedOrder.lockerAddress}`
         * từ lâu nhưng DTO <b>chưa bao giờ có field này</b> — nên dòng địa chỉ trong khối
         * "Vị Trí Trạm Tủ" <b>luôn trống</b> kể từ khi khối đó được viết. Minh phát hiện khi nghiệm
         * thu GĐ35 (đo DOM thấy tiêu đề + tên tủ + số ngăn, nhưng địa chỉ rỗng; kiểm API trả 23
         * field không có `lockerAddress`).
         *
         * <p>Lấy từ {@code locker.getAddress()} (cột {@code lockers.address}). NULL khi đơn chưa
         * gán tủ — frontend phải xử lý trường hợp này, không in "undefined".
         */
        private String lockerAddress;
        private Integer compartmentIndex;
        /**
         * GĐ18 — cỡ của ngăn đơn đang trỏ tới, <b>chỉ để hiển thị/tương thích</b>.
         *
         * <p>Không còn là tiêu chí chọn ngăn hay điều kiện kiểm tra: mọi ngăn đều nhận được mọi
         * kiện. Giữ field vì frontend và các màn báo cáo còn đọc; cột {@code compartments.size}
         * vẫn còn trong DB.
         */
        private String compartmentSize;
        private Boolean isShipperReserved;
        /**
         * GĐ21 — hạn giữ chỗ của RIÊNG lần đặt trước này (shipper chọn 1 hoặc 2 giờ).
         *
         * <p>{@code null} = đơn chưa đặt trước, hoặc là đơn cũ trước GĐ21 (khi đó backend dùng
         * công thức 120 phút). Web dùng giá trị này để hiện "giữ đến HH:mm" thay vì tự cộng giờ —
         * client tự cộng sẽ lệch khi đồng hồ máy khác máy chủ.
         */
        private LocalDateTime reserveExpiresAt;
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
        /**
         * GĐ27 — hạn của mã OTP, lấy từ {@code pickup_credentials.expired_at}.
         *
         * <p><b>Vì sao thêm:</b> trước đây response chỉ có {@code otpCode} mà không có hạn, nên
         * {@code CustomerPickupTab.getOtpStatus} — hàm cần CẢ HAI để biết mã còn hiệu lực — luôn
         * trả {@code isGenerated:false}, và modal OTP **luôn hiện "Mã OTP đã hết hạn"** dù mã vừa
         * tạo. Client phải tự gắn hạn 5 phút tại chỗ, tức là đoán thay vì đọc dữ liệu thật.
         *
         * <p>Chỉ trả khi {@code includeSecrets = true} (chủ đơn đúng SĐT), giống {@code otpCode}.
         */
        private LocalDateTime otpExpiresAt;
        private LocalDateTime createdAt;
        /** T3: mã vận đơn in trên nhãn; null thì coi như bằng orderId. */
        private String trackingCode;
        private String assignedShipperUsername;

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

        /** Constructor đầy đủ 21 tham số — Lombok @Builder cần đúng bộ tham số này. */
        public OrderResponse(String orderId, String customerName, String customerPhone, String deliveryType,
                             String lockerId, String lockerName, String lockerAddress,
                             Integer compartmentIndex, LocalDate expectedDate,
                             LocalDateTime depositedAt, LocalDateTime expiryDeadline, String status, String productName,
                             BigDecimal totalAmount, String paymentMethod, String paymentStatus, String qrToken,
                             String otpCode, LocalDateTime otpExpiresAt, LocalDateTime createdAt, String trackingCode) {
            this(orderId, customerName, customerPhone, deliveryType, lockerId, lockerName, compartmentIndex,
                    expectedDate, depositedAt, expiryDeadline, status, productName, totalAmount,
                    paymentMethod, paymentStatus, qrToken, otpCode, createdAt);
            this.lockerAddress = lockerAddress;
            this.otpExpiresAt = otpExpiresAt;
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
        /**
         * GĐ21 — số giờ giữ chỗ shipper chọn: <b>chỉ 1 hoặc 2</b>. Bỏ trống = 2 giờ (mặc định cũ).
         * Giá trị khác bị backend từ chối bằng 400 kèm message, KHÔNG âm thầm kẹp về 1.
         */
        private Integer reserveHours;

        public ReserveRequest() {
        }

        /**
         * Constructor đủ field — {@code @Builder} của Lombok cần bản bao trùm MỌI field, thiếu là
         * không biên dịch được (đã dính đúng lỗi này khi thêm {@code reserveHours}).
         */
        public ReserveRequest(String trackingCode, Integer compartmentIndex, Integer reserveHours) {
            this.trackingCode = trackingCode;
            this.compartmentIndex = compartmentIndex;
            this.reserveHours = reserveHours;
        }

        public ReserveRequest(String trackingCode, Integer compartmentIndex) {
            this(trackingCode, compartmentIndex, null);
        }
    }
}
