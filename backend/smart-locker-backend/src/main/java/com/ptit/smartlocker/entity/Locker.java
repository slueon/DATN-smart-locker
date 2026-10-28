package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "lockers")
@Getter
@Setter
@Builder
public class Locker {

    @Id
    @Column(name = "locker_id", length = 50)
    private String lockerId;

    public Locker() {}

    public Locker(String lockerId, String name, String address, Double latitude, Double longitude, String connectionStatus, Integer totalCompartments, LocalDateTime lastHeartbeat, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.lockerId = lockerId;
        this.name = name;
        this.address = address;
        this.latitude = latitude;
        this.longitude = longitude;
        this.connectionStatus = connectionStatus != null ? connectionStatus : "ONLINE";
        this.totalCompartments = totalCompartments != null ? totalCompartments : 3;
        this.lastHeartbeat = lastHeartbeat;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "address", nullable = false)
    private String address;

    @Column(name = "latitude", nullable = false)
    private Double latitude;

    @Column(name = "longitude", nullable = false)
    private Double longitude;

    @Column(name = "connection_status", length = 20)
    @Builder.Default
    private String connectionStatus = "ONLINE"; // ONLINE, OFFLINE, MAINTENANCE

    @Column(name = "total_compartments", nullable = false)
    @Builder.Default
    private Integer totalCompartments = 3;

    @Column(name = "last_heartbeat")
    private LocalDateTime lastHeartbeat;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
