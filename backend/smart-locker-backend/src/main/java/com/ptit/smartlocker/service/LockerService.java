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
    /** GĐ10 — nhật ký bảo trì. */
    private final com.ptit.smartlocker.repository.MaintenanceLogRepository maintenanceLogRepository;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private MqttService mqttService;

    public LockerService(
            LockerRepository lockerRepository,
            CompartmentRepository compartmentRepository,
            LockerSlotScheduleRepository slotScheduleRepository,
            OrderRepository orderRepository,
            com.ptit.smartlocker.repository.MaintenanceLogRepository maintenanceLogRepository) {
        this.lockerRepository = lockerRepository;
        this.compartmentRepository = compartmentRepository;
        this.slotScheduleRepository = slotScheduleRepository;
        this.orderRepository = orderRepository;
        this.maintenanceLogRepository = maintenanceLogRepository;
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
        // N+1: dùng bản NẠP SẴN compartment + locker. Nếu dùng findByLocker_LockerIdAndStatus
        // (LAZY), vòng lặp dưới đọc order.getCompartment() và sinh thêm 1 SELECT cho mỗi đơn.
        List<Order> pendingOrders = orderRepository.findByLockerAndStatusFetchAll(lockerId, "PENDING");
        for (Order order : pendingOrders) {
            if (order.getExpectedDate() != null && order.getExpectedDate().isBefore(today)) {
                Compartment comp = order.getCompartment();
                if (comp != null) {
                    // Chỉ giải phóng trạng thái chiếm dụng; cân nặng/cửa do cảm biến quyết định.
                    comp.setStatus("EMPTY");
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
                // Ngăn mồ côi: chỉ trả trạng thái về EMPTY, không bịa số cân.
                comp.setStatus("EMPTY");
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

        // Admin mở khoá khẩn cấp: chỉ giải phóng trạng thái CHIẾM DỤNG của ngăn.
        // KHÔNG ghi currentWeight/isDoorClosed ở đây — đó là trạng thái cảm biến (HX711, MC-38)
        // và sẽ được MqttService.handleCompartmentStatus cập nhật khi cửa thực sự mở.
        // Đoán "cửa đang mở, cân nặng 0" làm dashboard hiển thị sai so với tủ thật.
        comp.setStatus("EMPTY");
        Compartment saved = compartmentRepository.save(comp);
        log.info("Admin đã mở khóa khẩn cấp và giải phóng ngăn #{} của tủ {} (giữ nguyên trạng thái cảm biến: cửa {}, nặng {})",
                compIndex, lockerId, comp.getIsDoorClosed(), comp.getCurrentWeight());

        // Phát lệnh điều khiển mở khóa Solenoid qua MQTT tới Kiosk / MQTTX
        if (mqttService != null) {
            mqttService.publishCommand(lockerId, compIndex, "OPEN_DOOR", "EMERGENCY_OVERRIDE", null);
        }

        return saved;
    }

    /**
     * GĐ10 ý 1 — KHOÁ / MỞ KHOÁ một ngăn để bảo trì.
     *
     * <p><b>Chặn cứng: không cho khoá ngăn {@code OCCUPIED}.</b> Ngăn đang có kiện hàng thật của
     * khách; khoá nó là khoá luôn hàng của người ta và admin không còn cách nào mở cho khách lấy.
     * Muốn bảo trì thì phải thu hồi kiện trước.
     *
     * <p><b>Khoá ngăn {@code RESERVED} phải giải phóng đơn đang giữ ngăn.</b> Ngăn RESERVED nghĩa
     * là một đơn PENDING đang trỏ tới nó. Nếu chỉ đổi trạng thái ngăn mà để đơn trỏ vào, đơn đó
     * treo vĩnh viễn: không nạp được (ngăn không EMPTY) mà cũng không ai biết vì sao.
     *
     * <p><b>Publish MQTT:</b> {@code ptit/{dev}/maintenance/compartment} payload
     * {@code "<compIndex-1>,<1|0>"} với <b>{@code retain=true}</b>. Chỉ số phải trừ 1 vì DB dùng
     * 1-based còn firmware dùng 0-based (giống {@code publishCommand}).
     *
     * <p><b>Vì sao retain bắt buộc:</b> nếu không giữ lại bản tin, tủ mất điện rồi bật lại sẽ
     * KHÔNG nhận được lệnh khoá cũ ⇒ tự thoát bảo trì trong khi DB vẫn ghi đang bảo trì. Đó là
     * lỗi im lặng: admin tưởng đã khoá, tủ vẫn nhận khách.
     */
    @Transactional
    public Compartment setCompartmentMaintenance(String lockerId, Integer compIndex, boolean lock,
                                                 String reasonCode, String note, String byUsername) {
        Locker locker = lockerRepository.findById(lockerId)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy tủ với mã: " + lockerId));
        Compartment comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(lockerId, compIndex)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy ngăn " + compIndex + " của tủ " + lockerId));

        String status = comp.getStatus() == null ? "" : comp.getStatus().toUpperCase();

        if (lock) {
            if ("OCCUPIED".equals(status)) {
                throw new com.ptit.smartlocker.exception.BusinessException(
                        "Ngăn #" + compIndex + " đang có kiện hàng của khách nên KHÔNG thể khoá bảo trì. "
                                + "Vui lòng thu hồi kiện hàng trước khi bảo trì ngăn này.");
            }
            if ("OUT_OF_SERVICE".equals(status)) {
                // Đã ở trạng thái bảo trì: không tạo thêm dòng nhật ký trùng, không publish lại.
                return comp;
            }

            // Ngăn RESERVED: giải phóng đơn PENDING đang giữ ngăn, nếu không đơn treo vĩnh viễn.
            if ("RESERVED".equals(status)) {
                orderRepository.findByLocker_LockerIdAndStatus(lockerId, "PENDING").stream()
                        .filter(o -> o.getCompartment() != null
                                && comp.getCompartmentId() != null
                                && comp.getCompartmentId().equals(o.getCompartment().getCompartmentId()))
                        .forEach(o -> {
                            o.setCompartment(null);
                            o.setShipperReservedAt(null);
                            orderRepository.save(o);
                            log.info("Giải phóng đơn {} khỏi ngăn #{} để bảo trì ngăn",
                                    o.getOrderId(), compIndex);
                        });
            }

            comp.setStatus("OUT_OF_SERVICE");
        } else {
            if (!"OUT_OF_SERVICE".equals(status)) {
                // Đang không ở trạng thái bảo trì: coi như không có gì để mở.
                return comp;
            }
            comp.setStatus("EMPTY");
        }
        compartmentRepository.save(comp);

        maintenanceLogRepository.save(com.ptit.smartlocker.entity.MaintenanceLog.builder()
                .locker(locker)
                .compartmentId(comp.getCompartmentId())
                .action(lock ? "LOCK" : "UNLOCK")
                .reasonCode(reasonCode)
                .note(note)
                .byUsername(byUsername != null ? byUsername : "unknown")
                .build());

        publishMaintenanceCompartment(lockerId, compIndex, lock);

        log.info("Admin {} {} bảo trì ngăn #{} của tủ {} (lý do: {})",
                byUsername, lock ? "KHOÁ" : "MỞ KHOÁ", compIndex, lockerId, reasonCode);
        return comp;
    }

    /**
     * GĐ10 ý 2 — KHOÁ / MỞ KHOÁ toàn bộ tủ để bảo trì.
     *
     * <p><b>Chặn cứng: không khoá tủ khi còn đơn {@code PENDING} trỏ vào tủ.</b> Khoá lúc đó là
     * bỏ mặc các đơn đã nhận tiền của khách, không ai nạp được hàng. Thông báo lỗi phải liệt kê
     * mã đơn để admin biết cần chuyển tủ cho những đơn nào — không được im lặng khoá.
     *
     * <p><b>Publish:</b> {@code ptit/{dev}/maintenance/locker} payload {@code "1"}/{@code "0"},
     * <b>{@code retain=true}</b> (cùng lý do với bảo trì ngăn ở trên).
     */
    @Transactional
    public Locker setLockerMaintenance(String lockerId, boolean lock, String reasonCode,
                                       String note, String byUsername) {
        Locker locker = lockerRepository.findById(lockerId)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy tủ với mã: " + lockerId));

        if (lock) {
            List<Order> pending = orderRepository.findByLocker_LockerIdAndStatus(lockerId, "PENDING");
            if (!pending.isEmpty()) {
                String ids = pending.stream().map(Order::getOrderId).collect(java.util.stream.Collectors.joining(", "));
                throw new com.ptit.smartlocker.exception.BusinessException(
                        "Tủ " + lockerId + " còn " + pending.size() + " đơn đang chờ nạp: " + ids
                                + ". Vui lòng chuyển các đơn này sang tủ khác trước khi khoá bảo trì.");
            }
            locker.setConnectionStatus("MAINTENANCE");
        } else {
            // Mở lại: KHÔNG đặt thẳng ONLINE giả — trả về ONLINE là mức mặc định, nhưng nhịp tim
            // vẫn là nguồn sự thật để dashboard biết tủ có thật sự sống hay không.
            locker.setConnectionStatus("ONLINE");
        }
        lockerRepository.save(locker);

        maintenanceLogRepository.save(com.ptit.smartlocker.entity.MaintenanceLog.builder()
                .locker(locker)
                .compartmentId(null) // NULL = bảo trì toàn tủ
                .action(lock ? "LOCK" : "UNLOCK")
                .reasonCode(reasonCode)
                .note(note)
                .byUsername(byUsername != null ? byUsername : "unknown")
                .build());

        publishMaintenanceLocker(lockerId, lock);

        log.info("Admin {} {} bảo trì toàn tủ {} (lý do: {})",
                byUsername, lock ? "KHOÁ" : "MỞ KHOÁ", lockerId, reasonCode);
        return locker;
    }

    /**
     * GĐ10 ý 4 — nhật ký bảo trì gần nhất.
     *
     * <p>Query đã {@code LEFT JOIN FETCH} tủ nên map sang DTO không phát thêm SELECT (N+1).
     * {@code limit} chặn 1..200 giống {@code command-logs}: bảng này chỉ tăng theo thời gian.
     */
    @Transactional(readOnly = true)
    public List<com.ptit.smartlocker.dto.MaintenanceLogDTO> getMaintenanceLogs(String lockerId, Integer limit) {
        int safeLimit = 50;
        if (limit != null) {
            safeLimit = Math.max(1, Math.min(limit, 200));
        }
        String filter = (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId.trim()))
                ? null
                : lockerId.trim();

        return maintenanceLogRepository
                .findRecentWithLocker(filter, org.springframework.data.domain.PageRequest.of(0, safeLimit))
                .stream()
                .map(m -> com.ptit.smartlocker.dto.MaintenanceLogDTO.builder()
                        .logId(m.getLogId())
                        .lockerId(m.getLocker() != null ? m.getLocker().getLockerId() : null)
                        .compartmentId(m.getCompartmentId())
                        .action(m.getAction())
                        .reasonCode(m.getReasonCode())
                        .note(m.getNote())
                        .byUsername(m.getByUsername())
                        .createdAt(m.getCreatedAt())
                        .build())
                .toList();
    }

    /**
     * Publish trạng thái bảo trì của MỘT NGĂN xuống đúng thiết bị.
     *
     * <p>{@code compIndex - 1}: DB 1-based, firmware 0-based. Sai chỗ này là khoá nhầm ngăn.
     * {@code retain=true}: xem lý do ở {@link #setCompartmentMaintenance}.
     */
    private void publishMaintenanceCompartment(String lockerId, Integer compIndex, boolean lock) {
        if (mqttService == null) return;
        try {
            String dev = mqttService.resolveDeviceId(lockerId);
            String topic = mqttService.buildTopic(dev, "maintenance", "compartment");
            String payload = (compIndex - 1) + "," + (lock ? "1" : "0");
            mqttService.publishRawMessage(topic, payload, 1, true);
            log.info("Đã publish bảo trì ngăn: [{}] = {} (retain=true)", topic, payload);
        } catch (Exception e) {
            // Lỗi publish KHÔNG được làm rollback trạng thái DB: DB là nguồn sự thật, admin thấy
            // trạng thái đã đổi; lần reconnect sau retained sẽ bù. Ghi log để còn truy vết.
            log.error("Không publish được bảo trì ngăn {} của tủ {}: {}", compIndex, lockerId, e.getMessage());
        }
    }

    /** Publish trạng thái bảo trì TOÀN TỦ, {@code retain=true}. */
    private void publishMaintenanceLocker(String lockerId, boolean lock) {
        if (mqttService == null) return;
        try {
            String dev = mqttService.resolveDeviceId(lockerId);
            String topic = mqttService.buildTopic(dev, "maintenance", "locker");
            String payload = lock ? "1" : "0";
            mqttService.publishRawMessage(topic, payload, 1, true);
            log.info("Đã publish bảo trì toàn tủ: [{}] = {} (retain=true)", topic, payload);
        } catch (Exception e) {
            log.error("Không publish được bảo trì toàn tủ {}: {}", lockerId, e.getMessage());
        }
    }

    /**
     * Kiểm tra sức chứa tủ theo ngày với cơ chế Graceful Degradation
     * Nếu tủ đầy: Gợi ý các ngày tiếp theo hoặc chuyển sang giao hàng tận nhà (Home Delivery)
     */    @Transactional
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
