package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;

import java.time.LocalDate;

@Entity
@Table(name = "locker_slot_schedules", uniqueConstraints = {
        @UniqueConstraint(name = "uk_locker_date", columnNames = {"locker_id", "schedule_date"})
})
@Getter
@Setter
@Builder
public class LockerSlotSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    public LockerSlotSchedule() {}

    public LockerSlotSchedule(Long id, Locker locker, LocalDate scheduleDate, Integer totalSlots, Integer availableSlots, Long version) {
        this.id = id;
        this.locker = locker;
        this.scheduleDate = scheduleDate;
        this.totalSlots = totalSlots != null ? totalSlots : 3;
        this.availableSlots = availableSlots != null ? availableSlots : 3;
        this.version = version != null ? version : 0L;
    }

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    private Locker locker;

    @Column(name = "schedule_date", nullable = false)
    private LocalDate scheduleDate;

    @Column(name = "total_slots", nullable = false)
    @Builder.Default
    private Integer totalSlots = 3;

    @Column(name = "available_slots", nullable = false)
    @Builder.Default
    private Integer availableSlots = 3;

    @Version
    @Column(name = "version", nullable = false)
    @Builder.Default
    private Long version = 0L;
}
