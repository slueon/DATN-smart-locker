package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;

@Entity
@Table(name = "locker_slot_schedules", uniqueConstraints = {
        @UniqueConstraint(name = "uk_locker_date", columnNames = {"locker_id", "schedule_date"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LockerSlotSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

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
