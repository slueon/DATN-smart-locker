package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ShipperService {

    private final ShipperIdentityTokenRepository tokenRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;
    private final PickupCredentialRepository credentialRepository;
    private final DeviceEventRepository deviceEventRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;

    @Autowired(required = false)
    @Lazy
    private MqttService mqttService;

    public ShipperService(
            ShipperIdentityTokenRepository tokenRepository,
            OrderRepository orderRepository,
            CompartmentRepository compartmentRepository,
            PickupCredentialRepository credentialRepository,
            DeviceEventRepository deviceEventRepository,
            LockerSlotScheduleRepository slotScheduleRepository) {
        this.tokenRepository = tokenRepository;
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
        this.credentialRepository = credentialRepository;
        this.deviceEventRepository = deviceEventRepository;
        this.slotScheduleRepository = slotScheduleRepository;
    }

    /**
     * 1. Sinh mã QR định danh động cho Shipper (Hiệu lực chính xác 60 giây)
     */
    @Transactional
    public ShipperDTO.GenerateTokenResponse generateDynamicToken(String shipperId) {
        String dynamicToken = "SHIP-" + UUID.randomUUID().toString();
        LocalDateTime expiresAt = LocalDateTime.now().plusSeconds(60);

        ShipperIdentityToken token = ShipperIdentityToken.builder()
                .shipperId(shipperId)
                .dynamicToken(dynamicToken)
                .expiredAt(expiresAt)
                .isVerified(false)
                .build();
        tokenRepository.save(token);

        return ShipperDTO.GenerateTokenResponse.builder()
                .shipperId(shipperId)
                .dynamicToken(dynamicToken)
                .expiresAt(expiresAt)
                .validitySeconds(60)
                .build();
    }

    /**
     * 2. Tủ (đầu đọc GM65) quét và xác thực mã QR động của Shipper
     */
    @Transactional
    public boolean verifyDynamicToken(String lockerId, String dynamicToken) {
        ShipperIdentityToken token = tokenRepository.findByDynamicToken(dynamicToken)
                .orElseThrow(() -> new RuntimeException("Mã QR Shipper không hợp lệ!"));

        if (LocalDateTime.now().isAfter(token.getExpiredAt())) {
            throw new RuntimeException("Mã QR Shipper đã hết hạn (quá 60 giây). Vui lòng tạo lại mã mới trên Web!");
        }

        if (Boolean.TRUE.equals(token.getIsVerified())) {
            throw new RuntimeException("Mã QR Shipper này đã được sử dụng!");
        }

        token.setIsVerified(true);
        // Ghi lại TỦ đã quét mã. Thiếu bước này thì token xác thực ở tủ A
        // vẫn dùng được để mở cửa tủ B (lỗi cross-locker).
        token.setLockerId(lockerId);
        tokenRepository.save(token);
        return true;
    }

    /**
     * Có phiên shipper ĐÃ xác thực tại ĐÚNG tủ này và CÒN hiệu lực hay không.
     *
     * <p>Dùng để chặn topic `ptit/QR_send`. Bắt buộc lọc theo {@code lockerId}:
     * nếu chỉ kiểm "có token verified nào đó", shipper xác thực ở tủ A sẽ mở được
     * cửa tủ B — và tệ hơn, mở nhầm sang tủ khác với đơn hàng.
     */
    @Transactional(readOnly = true)
    public boolean hasAnyVerifiedShipperToken(String lockerId, LocalDateTime now) {
        if (lockerId == null || lockerId.isBlank()) {
            return false;
        }
        return !tokenRepository.findActiveVerifiedTokensForLocker(lockerId, now).isEmpty();
    }

    /**
     * 3. Shipper quét mã vận đơn đơn hàng và bỏ hàng vào ngăn tủ
     * Kiểm tra cảm biến kép: Cảm biến trọng lượng HX711 + Cảm biến đóng cửa MC-38
     */
    @Transactional
    public ShipperDTO.DepositResponse depositPackage(ShipperDTO.DepositPackageRequest request) {
        // Kiểm tra danh tính Shipper (Quy trình bảo mật 2 bước tại Kiosk)
        if (request.getDynamicToken() == null || request.getDynamicToken().isBlank()) {
            throw new RuntimeException("Vui lòng quét mã QR xác thực danh tính Shipper trước khi gửi hàng!");
        }

        ShipperIdentityToken token = tokenRepository.findByDynamicToken(request.getDynamicToken().trim())
                .orElseThrow(() -> new RuntimeException("Mã QR định danh Shipper không hợp lệ!"));

        if (!Boolean.TRUE.equals(token.getIsVerified())) {
            throw new RuntimeException("Mã QR Shipper chưa được quét xác thực tại trạm tủ!");
        }

        Order order = orderRepository.findById(request.getOrderId())
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + request.getOrderId()));

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new RuntimeException("Đơn hàng không ở trạng thái chờ gửi (Hiện tại: " + order.getStatus() + ")");
        }

        if (order.getLocker() == null || !order.getLocker().getLockerId().equals(request.getLockerId())) {
            throw new RuntimeException("Đơn hàng này không được phân bổ tới tủ: " + request.getLockerId());
        }

        Compartment compartment = order.getCompartment();
        if (compartment == null) {
            // Tự động tìm ngăn tủ còn EMPTY tại trạm để nạp hàng nếu lúc đặt chưa gán
            List<Compartment> empties = compartmentRepository.findByLocker_LockerIdAndStatus(request.getLockerId(), "EMPTY");
            if (empties.isEmpty()) {
                throw new RuntimeException("Tủ " + request.getLockerId() + " hiện tại không còn ngăn trống để nạp hàng!");
            }
            compartment = empties.get(0);
            order.setCompartment(compartment);
        }

        // Kiểm tra điều kiện Cảm biến kép:
        if (request.getIsDoorClosed() != null && !request.getIsDoorClosed()) {
            throw new RuntimeException("Cửa ngăn tủ chưa được đóng kín! Vui lòng đóng cửa để hoàn tất gửi hàng.");
        }

        if (request.getWeightGrams() != null && request.getWeightGrams() <= 0.05) {
            throw new RuntimeException("Cảm biến chưa phát hiện kiện hàng được đặt vào ngăn tủ!");
        }

        // Cập nhật trạng thái ngăn tủ
        compartment.setStatus("OCCUPIED");
        if (request.getWeightGrams() != null) {
            compartment.setCurrentWeight(request.getWeightGrams());
        }
        compartment.setIsDoorClosed(true);
        compartmentRepository.save(compartment);

        // Quy định lưu trữ: Đến hết ngày tiếp theo (24h00 của ngày N+1)
        LocalDateTime now = LocalDateTime.now();
        LocalDate nextDay = now.toLocalDate().plusDays(1);
        LocalDateTime expiryDeadline = LocalDateTime.of(nextDay, LocalTime.MAX); // 23:59:59.999999999

        order.setStatus("DEPOSITED");
        order.setDepositedAt(now);
        order.setExpiryDeadline(expiryDeadline);
        orderRepository.save(order);

        // Đồng bộ thời hạn mã nhận hàng của khách
        credentialRepository.findByOrder_OrderId(order.getOrderId()).ifPresent(cred -> {
            cred.setExpiredAt(expiryDeadline);
            credentialRepository.save(cred);
        });

        // Ghi nhật ký sự kiện cảm biến
        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(compartment.getCompartmentId())
                .eventType("DEPOSIT_SUCCESS")
                .eventPayload("Weight: " + request.getWeightGrams() + "kg, Door: CLOSED")
                .build();
        deviceEventRepository.save(event);

        // Bắn lệnh MQTT thông báo trạng thái nạp hàng thành công tới Kiosk và MQTTX
        if (mqttService != null && order.getLocker() != null) {
            mqttService.publishCommand(order.getLocker().getLockerId(), compartment.getCompIndex(), "OPEN_DOOR", "SHIPPER_DEPOSIT", order.getOrderId());
        }

        return ShipperDTO.DepositResponse.builder()
                .success(true)
                .message("Gửi hàng vào ngăn tủ số " + compartment.getCompIndex() + " thành công!")
                .orderId(order.getOrderId())
                .compartmentIndex(compartment.getCompIndex())
                .relayPin(compartment.getRelayPin())
                .lockerId(order.getLocker().getLockerId())
                .build();
    }

    /**
     * T3 — Danh sách đơn PENDING cho shipper chọn đặt trước trên web.
     *
     * <p>{@code trackingCode} trả về = {@code tracking_code} nếu đã đặt, ngược lại là
     * {@code order_id} (user chốt Q1 = (c): mặc định lấy order_id, cho phép sửa).
     *
     * @param lockerId null/rỗng/"ALL" = mọi tủ
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getPendingOrders(String lockerId) {
        List<Order> list;
        if (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId)) {
            list = orderRepository.findByStatusWithCompartment("PENDING");
        } else {
            list = orderRepository.findByLockerAndStatusWithCompartment(lockerId, "PENDING");
        }

        return list.stream()
                .map(o -> OrderDTO.OrderResponse.builder()
                        .orderId(o.getOrderId())
                        .customerName(o.getCustomerName())
                        .customerPhone(o.getCustomerPhone())
                        .deliveryType(o.getDeliveryType())
                        .lockerId(o.getLocker() != null ? o.getLocker().getLockerId() : null)
                        .lockerName(o.getLocker() != null ? o.getLocker().getName() : null)
                        .compartmentIndex(o.getCompartment() != null ? o.getCompartment().getCompIndex() : null)
                        .expectedDate(o.getExpectedDate())
                        .status(o.getStatus())
                        .productName(o.getProductName())
                        .totalAmount(o.getTotalAmount())
                        .paymentMethod(o.getPaymentMethod())
                        .paymentStatus(o.getPaymentStatus())
                        .createdAt(o.getCreatedAt())
                        // Mặc định mã vận đơn = order_id khi chưa đặt trước (Q1 = (c)).
                        .trackingCode(o.getTrackingCode() != null && !o.getTrackingCode().isBlank()
                                ? o.getTrackingCode()
                                : o.getOrderId())
                        .build())
                .collect(Collectors.toList());
    }

    /**
     * T3 — Shipper đặt trước một ngăn cụ thể cho đơn PENDING.
     *
     * <p><b>R2:</b> hàm này KHÔNG đụng {@code available_slots}. {@code createOrder} đã trừ slot
     * lúc khách đặt; trừ lần nữa là một đơn ăn hai slot. Chỉ {@link #cancelReserve} mới cộng lại,
     * và chỉ khi ngăn thật sự về {@code EMPTY}.
     *
     * <p>Dùng {@code findWithLockByLockerIdAndStatus} để giữ khoá bi quan trên các ngăn EMPTY của
     * tủ: hai shipper bấm cùng lúc thì chỉ một người giành được ngăn, người kia nhận lỗi.
     */
    @Transactional
    public OrderDTO.OrderResponse reserveCompartment(String orderId, String trackingCode, Integer compartmentIndex) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần đặt trước!");
        }
        if (compartmentIndex == null || compartmentIndex < 1) {
            throw new IllegalArgumentException("Chỉ số ngăn không hợp lệ (phải từ 1 trở lên)!");
        }

        Order order = orderRepository.findByIdWithCompartment(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Chỉ đặt trước được đơn đang chờ gửi. Đơn " + orderId + " hiện ở trạng thái "
                            + order.getStatus() + ".");
        }

        // Q4 (08:40): shipper ĐƯỢC ĐỔI NGĂN kể cả khi khách đã chọn ngăn lúc checkout —
        // nên KHÔNG chặn theo `order.getCompartment() != null` nữa. Chỉ chặn khi đơn
        // ĐÃ được shipper đặt trước rồi (cột `shipper_reserved_at` khác NULL).
        if (order.getShipperReservedAt() != null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " đã được đặt trước. Huỷ đặt trước trước khi đổi ngăn.");
        }

        if (order.getLocker() == null || order.getLocker().getLockerId() == null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " chưa được gán trạm tủ nên không thể đặt trước ngăn.");
        }
        String lockerId = order.getLocker().getLockerId();

        // Mã vận đơn: để trống thì lấy order_id (Q1 = (c)).
        String finalTracking = (trackingCode == null || trackingCode.isBlank())
                ? order.getOrderId()
                : trackingCode.trim();
        if (finalTracking.length() > 50) {
            throw new IllegalArgumentException("Mã vận đơn quá dài (tối đa 50 ký tự)!");
        }

        // Mã vận đơn không được trùng đơn KHÁC.
        orderRepository.findByTrackingCode(finalTracking).ifPresent(other -> {
            if (!other.getOrderId().equalsIgnoreCase(order.getOrderId())) {
                throw new IllegalArgumentException(
                        "Mã vận đơn '" + finalTracking + "' đã thuộc đơn " + other.getOrderId() + "!");
            }
        });

        // Khoá bi quan toàn bộ ngăn EMPTY của tủ → chống 2 shipper giành cùng ngăn.
        List<Compartment> empties = compartmentRepository
                .findWithLockByLockerIdAndStatus(lockerId, "EMPTY");
        Compartment target = empties.stream()
                .filter(c -> compartmentIndex.equals(c.getCompIndex()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Ngăn " + compartmentIndex + " của tủ " + lockerId
                                + " không trống (đã có người giữ hoặc đang chứa hàng). Vui lòng chọn ngăn khác."));

        // Đổi ngăn: nhả ngăn CŨ trước — nhưng CHỈ khi ngăn cũ đang RESERVED (ngăn do checkout
        // gán giữ chỗ). Nếu ngăn cũ đang OCCUPIED thì có hàng thật trong đó: KHÔNG được đá
        // hàng của người khác ra, phải từ chối để shipper chọn ngăn khác.
        Compartment old = order.getCompartment();
        if (old != null && !old.getCompIndex().equals(compartmentIndex)) {
            if ("OCCUPIED".equalsIgnoreCase(old.getStatus())) {
                throw new IllegalArgumentException(
                        "Ngăn " + old.getCompIndex() + " mà đơn đang trỏ tới đang CHỨA HÀNG (OCCUPIED). "
                                + "Không thể đổi sang ngăn " + compartmentIndex
                                + " vì sẽ mất dấu kiện hàng. Vui lòng liên hệ admin.");
            }
            if ("RESERVED".equalsIgnoreCase(old.getStatus())) {
                old.setStatus("EMPTY");
                compartmentRepository.save(old);
            }
        }

        target.setStatus("RESERVED");
        compartmentRepository.save(target);

        order.setCompartment(target);
        order.setTrackingCode(finalTracking);
        // Dấu hiệu DUY NHẤT cho biết shipper đã chủ động đặt trước (Q4).
        order.setShipperReservedAt(LocalDateTime.now());
        orderRepository.save(order);

        // KHÔNG đụng available_slots (R2).

        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(target.getCompartmentId())
                .eventType("RESERVE_COMPARTMENT")
                .eventPayload("Order " + order.getOrderId() + " reserved compartment "
                        + target.getCompIndex() + " (tracking=" + finalTracking + ")"
                        + (old != null && !old.getCompIndex().equals(compartmentIndex)
                                ? ", released old compartment " + old.getCompIndex() : ""))
                .build();
        deviceEventRepository.save(event);

        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(lockerId)
                .lockerName(order.getLocker().getName())
                .compartmentIndex(target.getCompIndex())
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .productName(order.getProductName())
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .createdAt(order.getCreatedAt())
                .trackingCode(finalTracking)
                .build();
    }

    /**
     * T3 — Huỷ đặt trước: ngăn về {@code EMPTY}, đơn bỏ ngăn, hoàn 1 slot.
     *
     * <p>Chỉ cộng {@code available_slots} khi ngăn THẬT SỰ về {@code EMPTY} — nếu ngăn đang
     * chứa hàng (OCCUPIED) thì trả lại slot sẽ làm lịch biểu sai.
     */
    @Transactional
    public void cancelReserve(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần huỷ đặt trước!");
        }

        Order order = orderRepository.findByIdWithCompartment(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (order.getCompartment() == null) {
            throw new IllegalArgumentException("Đơn " + orderId + " hiện không giữ ngăn nào để huỷ.");
        }
        // Q4: chỉ huỷ được cái do CHÍNH shipper đặt trước. Ngăn do checkout gán
        // (`shipper_reserved_at = NULL`) không phải "đặt trước" nên không có gì để huỷ.
        if (order.getShipperReservedAt() == null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " chưa được đặt trước nên không có gì để huỷ. "
                            + "Ngăn hiện tại là do hệ thống gán lúc khách đặt hàng.");
        }
        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Không huỷ đặt trước cho đơn đang ở trạng thái " + order.getStatus() + ".");
        }

        Compartment compartment = order.getCompartment();
        String lockerId = order.getLocker() != null ? order.getLocker().getLockerId() : null;

        // Chỉ nhả khi ngăn chưa bị dùng: EMPTY (bình thường) hoặc vẫn đang RESERVED (đúng ca này).
        boolean canRelease = "RESERVED".equalsIgnoreCase(compartment.getStatus())
                || "EMPTY".equalsIgnoreCase(compartment.getStatus());
        if (!canRelease) {
            throw new IllegalArgumentException(
                    "Ngăn " + compartment.getCompIndex() + " đang ở trạng thái " + compartment.getStatus()
                            + " nên không thể huỷ đặt trước.");
        }

        boolean becameEmpty = !"EMPTY".equalsIgnoreCase(compartment.getStatus());
        compartment.setStatus("EMPTY");
        compartmentRepository.save(compartment);

        order.setCompartment(null);
        // Xoá dấu đặt trước → đơn trở về trạng thái "ngăn do hệ thống/khách", quét nhãn sẽ ra 0.
        order.setShipperReservedAt(null);
        orderRepository.save(order);

        // R2: chỉ cộng slot khi ngăn thật sự chuyển về EMPTY ở lần huỷ này.
        if (becameEmpty && lockerId != null) {
            LocalDate today = LocalDate.now();
            slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(lockerId, today)
                    .ifPresent(schedule -> {
                        Integer total = order.getLocker() != null ? order.getLocker().getTotalCompartments() : null;
                        int currentAvail = schedule.getAvailableSlots() != null ? schedule.getAvailableSlots() : 0;
                        if (total == null || currentAvail < total) {
                            schedule.setAvailableSlots(currentAvail + 1);
                            slotScheduleRepository.save(schedule);
                        }
                    });
        }

        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(compartment.getCompartmentId())
                .eventType("CANCEL_RESERVE")
                .eventPayload("Order " + order.getOrderId() + " released compartment "
                        + compartment.getCompIndex())
                .build();
        deviceEventRepository.save(event);
    }

    /**
     * 4. Lấy danh sách bưu kiện quá hạn lưu kho để Shipper chủ động thu hồi
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOverdueOrders(String lockerId) {
        List<Order> list;
        if (lockerId != null && !lockerId.isBlank() && !"ALL".equalsIgnoreCase(lockerId)) {
            list = orderRepository.findByLocker_LockerIdAndStatus(lockerId, "OVERDUE");
        } else {
            list = orderRepository.findByStatus("OVERDUE");
        }

        return list.stream()
                .map(o -> OrderDTO.OrderResponse.builder()
                        .orderId(o.getOrderId())
                        .customerName(o.getCustomerName())
                        .customerPhone(o.getCustomerPhone())
                        .deliveryType(o.getDeliveryType())
                        .lockerId(o.getLocker() != null ? o.getLocker().getLockerId() : null)
                        .lockerName(o.getLocker() != null ? o.getLocker().getName() : null)
                        .compartmentIndex(o.getCompartment() != null ? o.getCompartment().getCompIndex() : null)
                        .expectedDate(o.getExpectedDate())
                        .depositedAt(o.getDepositedAt())
                        .expiryDeadline(o.getExpiryDeadline())
                        .status(o.getStatus())
                        .totalAmount(o.getTotalAmount())
                        .paymentMethod(o.getPaymentMethod())
                        .paymentStatus(o.getPaymentStatus())
                        .createdAt(o.getCreatedAt())
                        .build())
                .collect(Collectors.toList());
    }

    /**
     * 5. Shipper thu hồi bưu kiện quá hạn về kho bãi và giải phóng ngăn tủ
     */
    @Transactional
    public void recallOverduePackage(String orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));

        if (!"OVERDUE".equalsIgnoreCase(order.getStatus())) {
            throw new RuntimeException("Đơn hàng này không ở trạng thái quá hạn lưu kho!");
        }

        order.setStatus("COMPLETED");
        orderRepository.save(order);

        if (order.getCompartment() != null) {
            Compartment compartment = order.getCompartment();
            compartment.setStatus("EMPTY");
            compartment.setCurrentWeight(0.0);
            compartmentRepository.save(compartment);
        }

        // Hoàn trả 1 slot khả dụng cho ngày hôm nay trên lịch biểu
        if (order.getLocker() != null) {
            LocalDate today = LocalDate.now();
            slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(order.getLocker().getLockerId(), today)
                    .ifPresent(schedule -> {
                        int total = order.getLocker().getTotalCompartments();
                        int currentAvail = schedule.getAvailableSlots() != null ? schedule.getAvailableSlots() : 0;
                        if (currentAvail < total) {
                            schedule.setAvailableSlots(currentAvail + 1);
                            slotScheduleRepository.save(schedule);
                        }
                    });
        }

        // Ghi nhật ký sự kiện thu hồi
        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(order.getCompartment() != null ? order.getCompartment().getCompartmentId() : null)
                .eventType("RECALL_OVERDUE_SUCCESS")
                .eventPayload("Shipper recalled overdue order " + orderId + " back to warehouse")
                .build();
        deviceEventRepository.save(event);

        // Bắn lệnh MQTT thông báo trạng thái thu hồi hàng thành công tới Kiosk và MQTTX
        if (mqttService != null && order.getLocker() != null && order.getCompartment() != null) {
            mqttService.publishCommand(order.getLocker().getLockerId(), order.getCompartment().getCompIndex(), "OPEN_DOOR", "SHIPPER_RECALL", order.getOrderId());
        }
    }
}
