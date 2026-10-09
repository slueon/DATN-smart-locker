package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.LockerSlotSchedule;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface LockerSlotScheduleRepository extends JpaRepository<LockerSlotSchedule, Long> {

    Optional<LockerSlotSchedule> findByLocker_LockerIdAndScheduleDate(String lockerId, LocalDate scheduleDate);

    /**
     * Khóa dòng (Pessimistic Write Lock - SELECT ... FOR UPDATE)
     * Ngăn chặn hoàn toàn tranh chấp đặt chỗ đồng thời (Race Condition/Double-Booking)
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM LockerSlotSchedule s WHERE s.locker.lockerId = :lockerId AND s.scheduleDate = :scheduleDate")
    Optional<LockerSlotSchedule> findWithLockByLockerIdAndDate(
            @Param("lockerId") String lockerId,
            @Param("scheduleDate") LocalDate scheduleDate
    );

    /**
     * Khởi tạo bản ghi lịch biểu an toàn đa luồng bằng INSERT IGNORE (MySQL Atomic Insert)
     * Nếu đã có bản ghi cho (locker_id, schedule_date), MySQL sẽ bỏ qua mà không gây lỗi khóa Unique Key
     */
    @Modifying
    @Transactional
    @Query(value = "INSERT IGNORE INTO locker_slot_schedules (locker_id, schedule_date, total_slots, available_slots, version) " +
                   "VALUES (:lockerId, :scheduleDate, :totalSlots, :totalSlots, 0)", nativeQuery = true)
    void initScheduleIfNotExists(
            @Param("lockerId") String lockerId,
            @Param("scheduleDate") LocalDate scheduleDate,
            @Param("totalSlots") Integer totalSlots
    );

    List<LockerSlotSchedule> findByLocker_LockerIdAndScheduleDateGreaterThanEqualOrderByScheduleDateAsc(
            String lockerId, LocalDate fromDate
    );
}
