package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "device_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DeviceEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "event_id")
    private Long eventId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    private Locker locker;

    @Column(name = "compartment_id")
    private Integer compartmentId;

    @Column(name = "event_type", nullable = false, length = 50)
    private String eventType; // DOOR_CLOSED, WEIGHT_CHANGED, QR_SCANNED

    @Column(name = "event_payload", columnDefinition = "TEXT")
    private String eventPayload;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;
}
