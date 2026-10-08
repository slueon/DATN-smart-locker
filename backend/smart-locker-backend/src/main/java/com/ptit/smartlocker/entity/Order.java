package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "orders")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Order {

    @Id
    @Column(name = "order_id", length = 50)
    private String orderId;

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

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<OrderItem> orderItems = new ArrayList<>();
}
