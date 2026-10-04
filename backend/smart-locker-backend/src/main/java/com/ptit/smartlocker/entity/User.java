package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "username", unique = true, nullable = false, length = 50)
    private String username;

    @Column(name = "password", nullable = false, length = 100)
    private String password;

    @Column(name = "full_name", nullable = false, length = 100)
    private String fullName;

    @Column(name = "phone", unique = true, nullable = false, length = 20)
    private String phone;

    @Column(name = "role", nullable = false, length = 20)
    private String role; // 'CUSTOMER', 'SHIPPER', 'ADMIN'

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
