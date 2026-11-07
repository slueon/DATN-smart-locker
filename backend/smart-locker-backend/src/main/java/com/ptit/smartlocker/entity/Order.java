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
@Table(name = "orders")
@Getter
@Setter
@Builder
public class Order {

    @Id
    @Column(name = "order_id", length = 50)
    private String orderId;

    public Order() {}

    public Order(String orderId, String customerName, String customerPhone, String deliveryType, Locker locker, Compartment compartment, LocalDate expectedDate, LocalDateTime depositedAt, LocalDateTime expiryDeadline, String status, BigDecimal totalAmount, String paymentMethod, String paymentStatus, LocalDateTime createdAt, String productName) {
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
}
