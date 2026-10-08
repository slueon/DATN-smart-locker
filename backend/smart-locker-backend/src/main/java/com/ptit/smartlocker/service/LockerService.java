package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.CapacityDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class LockerService {

    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;

    public List<Locker> getAllLockers() {
        return lockerRepository.findAll();
    }

    public Locker getLockerById(String lockerId) {
        return lockerRepository.findById(lockerId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tủ với mã: " + lockerId));
    }

    public List<Compartment> getCompartmentsByLocker(String lockerId) {
        return compartmentRepository.findByLocker_LockerId(lockerId);
    }

    /**
     * Kiểm tra sức chứa tủ theo ngày với cơ chế Graceful Degradation
     * Nếu tủ đầy: Gợi ý các ngày tiếp theo hoặc chuyển sang giao hàng tận nhà (Home Delivery)
     */
    @Transactional(readOnly = true)
    public CapacityDTO.CapacityCheckResponse checkCapacity(String lockerId, LocalDate requestedDate) {
        Locker locker = getLockerById(lockerId);

        LockerSlotSchedule schedule = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(lockerId, requestedDate)
                .orElseGet(() -> {
                    // Mặc định tạo slot nếu chưa có lịch
                    return LockerSlotSchedule.builder()
                            .locker(locker)
                            .scheduleDate(requestedDate)
                            .totalSlots(locker.getTotalCompartments())
                            .availableSlots(locker.getTotalCompartments())
                            .version(0L)
                            .build();
                });

        boolean isAvailable = schedule.getAvailableSlots() > 0;
        List<LocalDate> alternativeDates = new ArrayList<>();

        if (!isAvailable) {
            // Tìm kiếm các ngày tiếp theo còn chỗ trong 7 ngày tới
            for (int i = 1; i <= 7; i++) {
                LocalDate nextDate = requestedDate.plusDays(i);
                var nextSchedule = slotScheduleRepository
                        .findByLocker_LockerIdAndScheduleDate(lockerId, nextDate);
                
                int freeSlots = nextSchedule
                        .map(s -> s.getAvailableSlots() != null ? s.getAvailableSlots() : locker.getTotalCompartments())
                        .orElse(locker.getTotalCompartments());

                if (freeSlots > 0) {
                    alternativeDates.add(nextDate);
                    if (alternativeDates.size() >= 3) break;
                }
            }
        }

        return CapacityDTO.CapacityCheckResponse.builder()
                .lockerId(locker.getLockerId())
                .lockerName(locker.getName())
                .requestedDate(requestedDate)
                .isAvailable(isAvailable)
                .remainingSlots(schedule.getAvailableSlots())
                .totalSlots(schedule.getTotalSlots())
                .allowHomeDeliveryFallback(true) // Lựa chọn (A): Chuyển giao tận nhà
                .alternativeAvailableDates(alternativeDates) // Lựa chọn (B): Đổi sang ngày còn trống
                .build();
    }
}
