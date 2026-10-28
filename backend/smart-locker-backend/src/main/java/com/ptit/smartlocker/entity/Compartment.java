package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;

@Entity
@Table(name = "compartments", uniqueConstraints = {
        @UniqueConstraint(name = "uk_locker_comp", columnNames = {"locker_id", "comp_index"})
})
@Getter
@Setter
@Builder
public class Compartment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "compartment_id")
    private Integer compartmentId;

    public Compartment() {}

    public Compartment(Integer compartmentId, Locker locker, Integer compIndex, String size, String status, Double currentWeight, Boolean isDoorClosed, Integer relayPin) {
        this.compartmentId = compartmentId;
        this.locker = locker;
        this.compIndex = compIndex;
        this.size = size != null ? size : "M";
        this.status = status != null ? status : "EMPTY";
        this.currentWeight = currentWeight != null ? currentWeight : 0.0;
        this.isDoorClosed = isDoorClosed != null ? isDoorClosed : true;
        this.relayPin = relayPin;
    }

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
