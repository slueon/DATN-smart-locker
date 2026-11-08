package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(
        name = "orders",
        // Tên UNIQUE đặt tường minh để khớp `smart_locker_db.sql`; nếu chỉ dùng
        // @Column(unique=true) thì Hibernate sinh tên ngẫu nhiên (UK8g2mgw...) và
        // file SQL sẽ không còn mô tả đúng schema thật.
        uniqueConstraints = @UniqueConstraint(
                name = "uk_orders_tracking",
                columnNames = "tracking_code")
)
@Getter
@Setter
@Builder
public class Order {

    @Id
    @Column(name = "order_id", length = 50)
    private String orderId;

    public Order() {}

    public Order(String orderId, String customerName, String customerPhone, String deliveryType, Locker locker, Compartment compartment, LocalDate expectedDate, LocalDateTime depositedAt, LocalDateTime expiryDeadline, String status, BigDecimal totalAmount, String paymentMethod, String paymentStatus, LocalDateTime createdAt, String productName) {
        this(orderId, customerName, customerPhone, deliveryType, locker, compartment, expectedDate,
                depositedAt, expiryDeadline, status, totalAmount, paymentMethod, paymentStatus,
                createdAt, productName, null);
    }

    /**
     * Constructor đầy đủ (16 tham số) — có {@code trackingCode}.
     *
     * <p>Phải giữ CẢ HAI constructor: bản 15 tham số ở trên được code cũ gọi, bản này
     * dùng khi cần gán mã vận đơn ngay lúc tạo. Có {@code @Builder} nên nếu chỉ khai
     * một constructor thì Lombok vẫn sinh builder từ field, nhưng code gọi `new Order(...)`
     * sẽ gãy — nên giữ tương thích.
     */
    public Order(String orderId, String customerName, String customerPhone, String deliveryType,
                 Locker locker, Compartment compartment, LocalDate expectedDate, LocalDateTime depositedAt,
                 LocalDateTime expiryDeadline, String status, BigDecimal totalAmount, String paymentMethod,
                 String paymentStatus, LocalDateTime createdAt, String productName, String trackingCode) {
        this.orderId = orderId;
        this.customerName = customerName;
        this.customerPhone = customerPhone;
        this.deliveryType = deliveryType;
        this.locker = locker;
        this.compartment = compartment;
        this.expectedDate = expectedDate;
        this.depositedAt = depositedAt;
        this.expiryDeadline = expiryDeadline;
        this.status = status != null ? status : "PENDING";
        this.totalAmount = totalAmount;
        this.paymentMethod = paymentMethod != null ? paymentMethod : "ONLINE_VIETQR";
        this.paymentStatus = paymentStatus != null ? paymentStatus : "PAID";
        this.createdAt = createdAt;
        this.productName = productName != null ? productName : "Bưu kiện Smart Locker";
        this.trackingCode = trackingCode;
    }

    /**
     * Constructor đầy đủ 17 tham số — Lombok {@code @Builder} cần đúng bộ tham số này
     * (builder của nó gọi constructor bao trùm mọi field, kể cả {@code shipperReservedAt}).
     */
    public Order(String orderId, String customerName, String customerPhone, String deliveryType,
                 Locker locker, Compartment compartment, LocalDate expectedDate, LocalDateTime depositedAt,
                 LocalDateTime expiryDeadline, String status, BigDecimal totalAmount, String paymentMethod,
                 String paymentStatus, LocalDateTime createdAt, String productName, String trackingCode,
                 LocalDateTime shipperReservedAt) {
        this(orderId, customerName, customerPhone, deliveryType, locker, compartment, expectedDate,
                depositedAt, expiryDeadline, status, totalAmount, paymentMethod, paymentStatus,
                createdAt, productName, trackingCode);
        this.shipperReservedAt = shipperReservedAt;
    }

    @Column(name = "customer_name", nullable = false, length = 100)
    private String customerName;

    @Column(name = "customer_phone", nullable = false, length = 20)
    private String customerPhone;

    @Column(name = "delivery_type", nullable = false, length = 20)
    private String deliveryType; // 'LOCKER' or 'STANDARD'

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id")
    private Locker locker;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "compartment_id")
    private Compartment compartment;

    @Column(name = "expected_date", nullable = false)
    private LocalDate expectedDate;

    @Column(name = "deposited_at")
    private LocalDateTime depositedAt;

    @Column(name = "expiry_deadline")
    private LocalDateTime expiryDeadline; // 24h00 of day N+1

    @Column(name = "status", nullable = false, length = 30)
    @Builder.Default
    private String status = "PENDING"; // PENDING, DEPOSITED, COMPLETED, OVERDUE

    @Column(name = "total_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "payment_method", length = 30)
    @Builder.Default
    private String paymentMethod = "ONLINE_VIETQR"; // ONLINE_VIETQR, ONLINE_MOMO, ONLINE_VNPAY, COD

    @Column(name = "payment_status", length = 20)
    @Builder.Default
    private String paymentStatus = "PAID"; // PAID, UNPAID

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "product_name", length = 255)
    @Builder.Default
    private String productName = "Bưu kiện Smart Locker";

    /**
     * Mã vận đơn in trên nhãn kiện hàng (T3).
     *
     * <p>Mặc định bằng {@code order_id} (user chốt Q1 = (c)), nhưng shipper được sửa khi
     * nhãn in mã khác. {@code order_id} vẫn là khoá chính và không đổi; đây chỉ là mã tra cứu.
     * UNIQUE để 2 đơn không bao giờ trùng mã vận đơn (nếu trùng, quét nhãn sẽ mở nhầm đơn).
     */
    @Column(name = "tracking_code", length = 50)
    private String trackingCode;

    /**
     * T3 (Q4) — thời điểm SHIPPER chủ động đặt trước/đổi ngăn trên web.
     *
     * <p><b>NULL</b> = ngăn do hệ thống gán lúc khách checkout ({@code createOrder} gán ngăn
     * cho đơn giao hôm nay) → shipper CHƯA đặt trước. <b>NOT NULL</b> = shipper đã chủ động
     * chọn ngăn. Đây là cột DUY NHẤT phân biệt được hai trường hợp đó, vì cả hai đều có
     * {@code compartment_id} khác NULL.
     */
    @Column(name = "shipper_reserved_at")
    private LocalDateTime shipperReservedAt;
}
