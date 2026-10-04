package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "products")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Product {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "product_id")
    private Long productId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "price", nullable = false, precision = 12, scale = 2)
    private BigDecimal price;

    @Column(name = "image_url")
    private String imageUrl;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "required_size", nullable = false, length = 10)
    @Builder.Default
    private String requiredSize = "S";

    @Column(name = "weight_kg", nullable = false)
    @Builder.Default
    private Double weightKg = 0.5;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
