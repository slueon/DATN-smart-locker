package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "compartments", uniqueConstraints = {
        @UniqueConstraint(name = "uk_locker_comp", columnNames = {"locker_id", "comp_index"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Compartment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "compartment_id")
    private Integer compartmentId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Locker locker;

    public String getLockerId() {
        return locker != null ? locker.getLockerId() : null;
    }

    @Column(name = "comp_index", nullable = false)
    private Integer compIndex;

    @Column(name = "size", nullable = false, length = 10)
    @Builder.Default
    private String size = "M"; // S, M, L

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "EMPTY"; // EMPTY, OCCUPIED, RESERVED, OUT_OF_SERVICE

    @Column(name = "current_weight")
    @Builder.Default
    private Double currentWeight = 0.0;

    @Column(name = "is_door_closed", nullable = false)
    @Builder.Default
    private Boolean isDoorClosed = true;

    @Column(name = "relay_pin")
    private Integer relayPin;
}
