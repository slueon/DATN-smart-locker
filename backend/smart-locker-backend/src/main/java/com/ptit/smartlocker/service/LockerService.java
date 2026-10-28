package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.CapacityDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Slf4j
@Service
public class LockerService {

    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;
    private final OrderRepository orderRepository;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private MqttService mqttService;

    public LockerService(
            LockerRepository lockerRepository,
            CompartmentRepository compartmentRepository,
            LockerSlotScheduleRepository slotScheduleRepository,
            OrderRepository orderRepository) {
        this.lockerRepository = lockerRepository;
        this.compartmentRepository = compartmentRepository;
        this.slotScheduleRepository = slotScheduleRepository;
        this.orderRepository = orderRepository;
    }

    public List<Locker> getAllLockers() {
        return lockerRepository.findAll();
    }

    public Locker getLockerById(String lockerId) {
        return lockerRepository.findById(lockerId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tủ với mã: " + lockerId));
    }

    @Transactional
    public List<Compartment> getCompartmentsByLocker(String lockerId) {
        autoReleaseExpiredReservations(lockerId);
        return compartmentRepository.findByLocker_LockerId(lockerId);
    }

    /**
     * Tự động giải phóng các ngăn tủ bị kẹt trạng thái RESERVED do đơn đặt PENDING trong quá khứ không được nạp
     */
    @Transactional
    public void autoReleaseExpiredReservations(String lockerId) {
        LocalDate today = LocalDate.now();
        List<Order> pendingOrders = orderRepository.findByLocker_LockerIdAndStatus(lockerId, "PENDING");
        for (Order order : pendingOrders) {
            if (order.getExpectedDate() != null && order.getExpectedDate().isBefore(today)) {
                Compartment comp = order.getCompartment();
                if (comp != null) {
                    comp.setStatus("EMPTY");
                    comp.setCurrentWeight(0.0);
                    compartmentRepository.save(comp);
                    order.setCompartment(null);
                }
                order.setStatus("CANCELLED");
                orderRepository.save(order);
                log.info("Đã tự động hủy đơn quá hạn {} và giải phóng ngăn tủ về EMPTY", order.getOrderId());
            }
        }

        // Kiểm tra an toàn: Nếu ngăn tủ nào đang ghi RESERVED nhưng không có đơn PENDING hợp lệ nào giữ chỗ, giải phóng về EMPTY
        List<Compartment> reservedComps = compartmentRepository.findByLocker_LockerIdAndStatus(lockerId, "RESERVED");
        for (Compartment comp : reservedComps) {
            boolean hasActiveReservation = pendingOrders.stream().anyMatch(o ->
                    o.getCompartment() != null && o.getCompartment().getCompartmentId().equals(comp.getCompartmentId())
                            && o.getExpectedDate() != null && !o.getExpectedDate().isBefore(today)
            );
            if (!hasActiveReservation) {
                comp.setStatus("EMPTY");
                comp.setCurrentWeight(0.0);
                compartmentRepository.save(comp);
                log.info("Giải phóng ngăn mồ côi {} của tủ {} về EMPTY", comp.getCompIndex(), lockerId);
            }
        }
    }

    /**
     * Mở khóa khẩn cấp / Giải phóng cưỡng bức ngăn tủ từ Admin từ xa
     */
    @Transactional
    public Compartment forceUnlockCompartment(String lockerId, Integer compIndex) {
        Compartment comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(lockerId, compIndex)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy ngăn " + compIndex + " của tủ " + lockerId));

        comp.setStatus("EMPTY");
        comp.setCurrentWeight(0.0);
        comp.setIsDoorClosed(false);
        Compartment saved = compartmentRepository.save(comp);
        log.info("Admin đã mở khóa khẩn cấp và giải phóng ngăn #{} của tủ {}", compIndex, lockerId);

        // Phát lệnh điều khiển mở khóa Solenoid qua MQTT tới Kiosk / MQTTX
        if (mqttService != null) {
            mqttService.publishCommand(lockerId, compIndex, "OPEN_DOOR", "EMERGENCY_OVERRIDE", null);
        }

        return saved;
    }

    /**
     * Kiểm tra sức chứa tủ theo ngày với cơ chế Graceful Degradation
     * Nếu tủ đầy: Gợi ý các ngày tiếp theo hoặc chuyển sang giao hàng tận nhà (Home Delivery)
     */
    @Transactional
    public CapacityDTO.CapacityCheckResponse checkCapacity(String lockerId, LocalDate requestedDate) {
        Locker locker = getLockerById(lockerId);
        LocalDate targetDate = requestedDate != null ? requestedDate : LocalDate.now();

        // Tự động dọn dẹp các đơn PENDING cũ bị kẹt giữ chỗ
        autoReleaseExpiredReservations(lockerId);

        LockerSlotSchedule schedule = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(lockerId, targetDate)
                .orElseGet(() -> {
                    // Mặc định tạo slot nếu chưa có lịch
                    return LockerSlotSchedule.builder()
                            .locker(locker)
                            .scheduleDate(targetDate)
                            .totalSlots(locker.getTotalCompartments())
                            .availableSlots(locker.getTotalCompartments())
                            .version(0L)
                            .build();
                });

        int remainingSlots;

        // Nếu ngày yêu cầu là HÔM NAY: Sức chứa khả dụng dựa trên số lượng ngăn EMPTY vật lý thực tế
        if (targetDate.isEqual(LocalDate.now())) {
            remainingSlots = compartmentRepository
                    .findByLocker_LockerIdAndStatus(lockerId, "EMPTY")
                    .size();
            if (schedule.getAvailableSlots() == null || schedule.getAvailableSlots() < remainingSlots) {
                schedule.setAvailableSlots(remainingSlots);
                slotScheduleRepository.save(schedule);
            }
        } else {
            // Ngày tương lai: Sức chứa khả dụng dựa trên lịch biểu slot đã đặt trước
            remainingSlots = schedule.getAvailableSlots() != null ? schedule.getAvailableSlots() : locker.getTotalCompartments();
        }

        boolean isAvailable = remainingSlots > 0;
        List<LocalDate> alternativeDates = new ArrayList<>();

        if (!isAvailable) {
            // Tìm kiếm các ngày tiếp theo còn chỗ trong 7 ngày tới
            for (int i = 1; i <= 7; i++) {
                LocalDate nextDate = targetDate.plusDays(i);
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
                .requestedDate(targetDate)
                .isAvailable(isAvailable)
                .remainingSlots(remainingSlots)
                .totalSlots(schedule.getTotalSlots())
                .allowHomeDeliveryFallback(true) // Lựa chọn (A): Chuyển giao tận nhà
                .alternativeAvailableDates(alternativeDates) // Lựa chọn (B): Đổi sang ngày còn trống
                .build();
    }
}
