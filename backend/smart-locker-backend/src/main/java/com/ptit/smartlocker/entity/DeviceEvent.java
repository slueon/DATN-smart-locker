package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "device_events")
@Getter
@Setter
@Builder
public class DeviceEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "event_id")
    private Long eventId;

    public DeviceEvent() {}

    public DeviceEvent(Long eventId, Locker locker, Integer compartmentId, String eventType, String eventPayload, LocalDateTime createdAt) {
        this.eventId = eventId;
        this.locker = locker;
        this.compartmentId = compartmentId;
        this.eventType = eventType;
        this.eventPayload = eventPayload;
        this.createdAt = createdAt;
    }

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
