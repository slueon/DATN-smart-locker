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
    private final LockerRepository lockerRepository;

    @Autowired(required = false)
    @Lazy
    private MqttService mqttService;

    public ShipperService(
            ShipperIdentityTokenRepository tokenRepository,
            OrderRepository orderRepository,
            CompartmentRepository compartmentRepository,
            PickupCredentialRepository credentialRepository,
            DeviceEventRepository deviceEventRepository,
            LockerSlotScheduleRepository slotScheduleRepository,
            LockerRepository lockerRepository) {
        this.tokenRepository = tokenRepository;
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
        this.credentialRepository = credentialRepository;
        this.deviceEventRepository = deviceEventRepository;
        this.slotScheduleRepository = slotScheduleRepository;
        this.lockerRepository = lockerRepository;
    }

    /** GĐ11 — ngưỡng "tủ còn sống": nhịp tim cũ hơn 5 phút thì không cho shipper chọn. */
    private static final long HEARTBEAT_FRESH_MINUTES = 5L;

    /** GĐ11 — ngưỡng tủ "đã kín": lấp đầy từ 80% trở lên thì không gợi ý nữa. */
    private static final double MAX_OCCUPANCY_RATIO = 0.8;

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

        // Cập nhật trạng thái ngăn tủ.
        //
        // KHÔNG hardcode isDoorClosed = true: đây là trạng thái của cảm biến từ MC-38 (và
        // currentWeight của HX711). Nếu client không gửi giá trị nào thì phải GIỮ NGUYÊN giá trị
        // phần cứng đã báo, không được tự khẳng định "cửa đã đóng" — nếu không dashboard sẽ hiển
        // thị sai khi cửa thật đang mở.
        compartment.setStatus("OCCUPIED");
        if (request.getWeightGrams() != null) {
            compartment.setCurrentWeight(request.getWeightGrams());
        }
        if (request.getIsDoorClosed() != null) {
            compartment.setIsDoorClosed(request.getIsDoorClosed());
        }
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
     * <p><b>GĐ11:</b> nhánh "mọi tủ" phải dùng {@code findByStatusWithCompartment} — truy vấn
     * theo tủ cụ thể sẽ bỏ sót vĩnh viễn các đơn <b>chưa được gán tủ</b> ({@code locker_id IS NULL}),
     * mà từ GĐ11 loại đơn đó là bình thường (khách đặt trước, shipper chọn tủ sau). Nhánh lọc
     * theo tủ thì đổi sang {@code findByLockerAndStatusFetchAll} để nạp sẵn cả {@code locker} —
     * bản cũ chỉ fetch {@code compartment} nên đọc {@code getLocker()} trong vòng lặp là N+1.
     *
     * @param lockerId null/rỗng/"ALL" = mọi tủ
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getPendingOrders(String lockerId) {
        List<Order> list;
        if (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId)) {
            list = orderRepository.findByStatusWithCompartment("PENDING");
        } else {
            list = orderRepository.findByLockerAndStatusFetchAll(lockerId, "PENDING");
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
                        .compartmentSize(o.getCompartment() != null ? o.getCompartment().getSize() : null)
                        .isShipperReserved(o.getShipperReservedAt() != null)
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

        Compartment old = order.getCompartment();
        Compartment target;

        if (old != null && old.getCompIndex().equals(compartmentIndex)) {
            // Shipper xác nhận đặt trước chính ngăn hiện tại mà đơn đang được chỉ định
            target = old;
        } else {
            // Đổi ngăn: nhả ngăn CŨ trước — nhưng CHỈ khi ngăn cũ đang RESERVED (ngăn do checkout
            // gán giữ chỗ). Nếu ngăn cũ đang OCCUPIED thì có hàng thật trong đó: KHÔNG được đá
            // hàng của người khác ra, phải từ chối để shipper chọn ngăn khác.
            if (old != null) {
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

            // Khoá bi quan toàn bộ ngăn EMPTY của tủ → chống 2 shipper giành cùng ngăn.
            List<Compartment> empties = compartmentRepository
                    .findWithLockByLockerIdAndStatus(lockerId, "EMPTY");
            target = empties.stream()
                    .filter(c -> compartmentIndex.equals(c.getCompIndex()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Ngăn " + compartmentIndex + " của tủ " + lockerId
                                    + " không trống (đã có người giữ hoặc đang chứa hàng). Vui lòng chọn ngăn khác."));
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
                .compartmentSize(target.getSize())
                .isShipperReserved(order.getShipperReservedAt() != null)
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
     * GĐ11 — danh sách tủ shipper CÓ THỂ chọn để giao đơn này.
     *
     * <p>Lọc cứng 4 điều kiện, theo đúng thứ tự:
     * <ol>
     *   <li>Có ít nhất một ngăn {@code EMPTY} đủ cỡ cho kiện.</li>
     *   <li>{@code connection_status} khác {@code MAINTENANCE} — tủ đang bảo trì thì không nhận hàng.</li>
     *   <li>{@code last_heartbeat} trong 5 phút gần nhất; <b>NULL thì loại luôn</b> (chưa từng gửi
     *       nhịp tim = không tin được). Không đọc {@code connection_status} để suy ra sức khoẻ:
     *       DB ghi {@code ONLINE} cho cả 10 tủ kể cả tủ im lặng nhiều ngày.</li>
     *   <li>Tỷ lệ lấp đầy {@code (total - available) / total < 0.8}.</li>
     * </ol>
     *
     * <p><b>GIỚI HẠN — phải nói rõ khi bảo vệ:</b> danh sách KHÔNG xếp theo khoảng cách tới khách
     * vì bảng {@code orders} không lưu toạ độ khách. Đây là hạng mục phát triển tiếp theo; đừng
     * trình bày là đã có.
     *
     * <p><b>Cỡ kiện:</b> {@code orders} cũng không lưu cỡ kiện (chỉ {@code CheckoutRequest} có
     * {@code requiredSize} lúc tạo đơn). Vì vậy cỡ được suy từ ngăn đơn đang trỏ tới nếu có;
     * không có ngăn thì coi là {@code S} — tức chấp nhận mọi cỡ ngăn, KHÔNG bịa cỡ kiện.
     *
     * <p><b>N+1:</b> chỉ 2 câu query — {@link CompartmentRepository#findAllWithLocker()} nạp toàn
     * bộ ngăn kèm tủ, và {@code lockerRepository.findAll()}. Không truy vấn trong vòng lặp.
     */
    @Transactional(readOnly = true)
    public List<ShipperDTO.SuggestLockerResponse> suggestLockers(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần gợi ý tủ!");
        }
        Order order = orderRepository.findByIdWithCompartment(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        String requiredSize = order.getCompartment() != null && order.getCompartment().getSize() != null
                ? order.getCompartment().getSize().trim().toUpperCase()
                : "S";
        String currentLockerId = order.getLocker() != null ? order.getLocker().getLockerId() : null;

        // 1 câu query cho toàn bộ ngăn của mọi tủ (JOIN FETCH locker) rồi gom theo lockerId.
        java.util.Map<String, List<Compartment>> compsByLocker = new java.util.HashMap<>();
        for (Compartment c : compartmentRepository.findAllWithLocker()) {
            if (c.getLocker() == null || c.getLocker().getLockerId() == null) continue;
            compsByLocker.computeIfAbsent(c.getLocker().getLockerId(), k -> new java.util.ArrayList<>()).add(c);
        }

        LocalDateTime now = LocalDateTime.now();
        List<ShipperDTO.SuggestLockerResponse> result = new java.util.ArrayList<>();

        for (Locker locker : lockerRepository.findAll()) {
            if ("MAINTENANCE".equalsIgnoreCase(locker.getConnectionStatus())) continue;

            // GĐ12 — TÁCH TỦ THẬT / TỦ ẢO.
            //
            //   • Tủ ảo (`isVirtual = true`): khai báo CSDL, không có thiết bị nên không bao giờ
            //     có nhịp tim → BỎ QUA kiểm nhịp tim. Nếu vẫn kiểm thì 9 tủ ảo luôn bị loại và
            //     shipper chỉ còn đúng 1 tủ thật để chọn, đúng hiện tượng user báo.
            //   • Tủ thật (`LOCKER_HN_01`): BẮT BUỘC nhịp tim trong HEARTBEAT_FRESH_MINUTES.
            //     Đây là điểm user yêu cầu rõ — tủ thật phải theo dõi được có đang kết nối hay không.
            if (!Boolean.TRUE.equals(locker.getIsVirtual())) {
                if (locker.getLastHeartbeat() == null) continue;
                if (locker.getLastHeartbeat().isBefore(now.minusMinutes(HEARTBEAT_FRESH_MINUTES))) continue;
            }

            List<Compartment> comps = compsByLocker.getOrDefault(locker.getLockerId(), List.of());
            if (comps.isEmpty()) continue;

            int available = 0;
            for (Compartment c : comps) {
                if ("EMPTY".equalsIgnoreCase(c.getStatus()) && sizeFits(requiredSize, c.getSize())) {
                    available++;
                }
            }
            if (available == 0) continue;

            int total = comps.size();
            double occupancy = (double) (total - available) / total;
            if (occupancy >= MAX_OCCUPANCY_RATIO) continue;

            result.add(ShipperDTO.SuggestLockerResponse.builder()
                    .lockerId(locker.getLockerId())
                    .name(locker.getName())
                    .address(locker.getAddress())
                    .latitude(locker.getLatitude())
                    .longitude(locker.getLongitude())
                    .availableCompartments(available)
                    .totalCompartments(total)
                    .connectionStatus(locker.getConnectionStatus())
                    .healthLabel(healthLabel(locker.getLastHeartbeat(), now, Boolean.TRUE.equals(locker.getIsVirtual())))
                    .isSuggestedByOrder(currentLockerId != null && currentLockerId.equals(locker.getLockerId()))
                    .build());
        }

        // Tủ đang gán trong đơn lên đầu; còn lại nhiều ngăn trống hơn đứng trước; cuối cùng theo mã.
        result.sort(java.util.Comparator
                .comparing((ShipperDTO.SuggestLockerResponse r) -> !Boolean.TRUE.equals(r.getIsSuggestedByOrder()))
                .thenComparing(ShipperDTO.SuggestLockerResponse::getAvailableCompartments,
                        java.util.Comparator.reverseOrder())
                .thenComparing(ShipperDTO.SuggestLockerResponse::getLockerId));
        return result;
    }

    /**
     * GĐ11 — shipper chốt tủ (và ngăn) cho một đơn PENDING.
     *
     * <p><b>Ràng buộc sống còn:</b> việc NHẢ ngăn cũ và GIỮ ngăn mới nằm trong CÙNG một
     * {@code @Transactional}, và thứ tự là <i>giữ ngăn mới trước, nhả ngăn cũ sau</i>. Nhờ vậy
     * khi tủ đích hết ngăn, ta ném lỗi 409 lúc ngăn cũ CHƯA bị đụng tới — đơn không bao giờ rơi
     * vào trạng thái "mất ngăn cũ mà không có ngăn mới". Nếu chỉ dựa vào rollback thì vẫn đúng,
     * nhưng phụ thuộc vào việc transaction thật sự rollback; đặt đúng thứ tự là an toàn kép.
     *
     * <p><b>Ngăn {@code OCCUPIED} tuyệt đối không bị đá:</b> đó là hàng thật của khách. Gặp ngăn
     * cũ đang OCCUPIED thì từ chối 409 và không đổi gì.
     *
     * <p>Không đụng {@code available_slots} của tủ mới — giống {@code reserveCompartment} (R2):
     * shipper chốt một ngăn vật lý đã có sẵn, không phải một suất mới trên lịch biểu.
     */
    @Transactional
    public OrderDTO.OrderResponse assignLocker(String orderId, String lockerId, Integer compartmentIndex) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần chọn tủ!");
        }
        if (lockerId == null || lockerId.isBlank()) {
            throw new IllegalArgumentException("Vui lòng chọn tủ cần giao!");
        }

        // Khoá bi quan dòng đơn: đổi tủ chạy song song với tác vụ tự nhả ngăn quá hạn.
        Order order = orderRepository.findByIdForReleaseWithLock(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Chỉ chọn tủ cho đơn đang chờ gửi. Đơn " + order.getOrderId()
                            + " hiện ở trạng thái " + order.getStatus() + ".");
        }

        Locker targetLocker = lockerRepository.findById(lockerId.trim())
                .orElseThrow(() -> new com.ptit.smartlocker.exception.BusinessException(
                        "Tủ " + lockerId + " không tồn tại."));

        if ("MAINTENANCE".equalsIgnoreCase(targetLocker.getConnectionStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Tủ " + targetLocker.getName() + " đang bảo trì, vui lòng chọn tủ khác.");
        }
        LocalDateTime now = LocalDateTime.now();
        // GĐ12 — cùng quy tắc với `suggestLockers`: tủ ảo bỏ qua kiểm nhịp tim, tủ thật thì
        // KHÔNG. Thiết bị `khuon_vien` im quá 5 phút thì shipper giao vào LOCKER_HN_01 sẽ nhận 409
        // — đúng ý user: tủ thật phải theo dõi được có đang kết nối hay không.
        if (!Boolean.TRUE.equals(targetLocker.getIsVirtual())) {
            if (targetLocker.getLastHeartbeat() == null
                    || targetLocker.getLastHeartbeat().isBefore(now.minusMinutes(HEARTBEAT_FRESH_MINUTES))) {
                throw new com.ptit.smartlocker.exception.BusinessException(
                        "Tủ " + targetLocker.getName() + " không có nhịp tim trong "
                                + HEARTBEAT_FRESH_MINUTES + " phút gần đây, không thể giao hàng vào tủ này.");
            }
        }

        Compartment old = order.getCompartment();
        if (old != null && "OCCUPIED".equalsIgnoreCase(old.getStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Ngăn " + old.getCompIndex() + " của tủ cũ đang CHỨA HÀNG (OCCUPIED) nên không thể "
                            + "đổi tủ. Vui lòng liên hệ admin.");
        }

        // BƯỚC 1 — GIỮ NGĂN MỚI TRƯỚC (khoá bi quan toàn bộ ngăn EMPTY của tủ đích).
        List<Compartment> empties = compartmentRepository
                .findWithLockByLockerIdAndStatus(targetLocker.getLockerId(), "EMPTY");

        Compartment target;
        if (compartmentIndex != null) {
            if (compartmentIndex < 1) {
                throw new IllegalArgumentException("Chỉ số ngăn không hợp lệ (phải từ 1 trở lên)!");
            }
            target = empties.stream()
                    .filter(c -> compartmentIndex.equals(c.getCompIndex()))
                    .findFirst()
                    .orElseThrow(() -> new com.ptit.smartlocker.exception.BusinessException(
                            "Ngăn " + compartmentIndex + " của tủ " + targetLocker.getLockerId()
                                    + " không trống (đã có người giữ hoặc đang chứa hàng). Vui lòng chọn ngăn khác."));
        } else {
            String requiredSize = old != null && old.getSize() != null
                    ? old.getSize().trim().toUpperCase()
                    : "S";
            target = empties.stream()
                    .filter(c -> sizeFits(requiredSize, c.getSize()))
                    .findFirst()
                    .orElseThrow(() -> new com.ptit.smartlocker.exception.BusinessException(
                            "Tủ " + targetLocker.getName() + " không còn ngăn trống phù hợp với kích thước kiện (Size "
                                    + requiredSize + "). Vui lòng chọn tủ khác."));
        }

        target.setStatus("RESERVED");
        compartmentRepository.save(target);

        // BƯỚC 2 — NHẢ NGĂN CŨ, chỉ khi ngăn cũ đang RESERVED. Tủ cũ giữ nguyên (nếu không cùng tủ).
        if (old != null && !old.getCompartmentId().equals(target.getCompartmentId())
                && "RESERVED".equalsIgnoreCase(old.getStatus())) {
            old.setStatus("EMPTY");
            compartmentRepository.save(old);
        }

        order.setLocker(targetLocker);
        order.setCompartment(target);
        // Dấu hiệu "shipper đã chốt tuyến", phân biệt với tủ do hệ thống đề xuất lúc tạo đơn.
        order.setShipperReservedAt(now);
        orderRepository.save(order);

        DeviceEvent event = DeviceEvent.builder()
                .locker(targetLocker)
                .compartmentId(target.getCompartmentId())
                .eventType("ASSIGN_LOCKER")
                .eventPayload("Order " + order.getOrderId() + " assigned to " + targetLocker.getLockerId()
                        + " compartment " + target.getCompIndex()
                        + (old != null ? " (from compartment " + old.getCompIndex() + ")" : " (no previous compartment)"))
                .build();
        deviceEventRepository.save(event);

        String tracking = order.getTrackingCode() != null && !order.getTrackingCode().isBlank()
                ? order.getTrackingCode()
                : order.getOrderId();
        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(targetLocker.getLockerId())
                .lockerName(targetLocker.getName())
                .compartmentIndex(target.getCompIndex())
                .compartmentSize(target.getSize())
                .isShipperReserved(true)
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .productName(order.getProductName())
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .createdAt(order.getCreatedAt())
                .trackingCode(tracking)
                .build();
    }

    /** Cỡ ngăn {@code compartmentSize} có chứa được kiện cỡ {@code requiredSize} hay không. */
    private boolean sizeFits(String requiredSize, String compartmentSize) {
        if (compartmentSize == null) return false;
        String need = requiredSize == null ? "S" : requiredSize.trim().toUpperCase();
        String have = compartmentSize.trim().toUpperCase();
        if (need.equals(have)) return true;
        if ("S".equals(need)) return "M".equals(have) || "L".equals(have);
        if ("M".equals(need)) return "L".equals(have);
        return false;
    }

    /**
     * Nhãn sức khoẻ — 3 mức cho TỦ THẬT, suy thuần từ {@code lastHeartbeat} (KHÔNG đọc
     * {@code connection_status}).
     *
     * <p>GĐ12: nhánh tủ ảo đặt TRƯỚC mọi phép tính tuổi nhịp tim. Tủ ảo luôn "Online" nhưng có
     * hậu tố "(tủ ảo)" để người đọc không tưởng nhầm đang có thiết bị chạy và gửi nhịp tim thật.
     */
    private String healthLabel(LocalDateTime heartbeat, LocalDateTime now, boolean isVirtual) {
        if (isVirtual) return "Online (tủ ảo)";
        if (heartbeat == null) return "MẤT KẾT NỐI";
        long minutes = java.time.Duration.between(heartbeat, now).toMinutes();
        if (minutes <= HEARTBEAT_FRESH_MINUTES) return "Online";
        if (minutes <= 60) return "Không rõ";
        return "MẤT KẾT NỐI";
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
                        .compartmentSize(o.getCompartment() != null ? o.getCompartment().getSize() : null)
                        .isShipperReserved(o.getShipperReservedAt() != null)
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
            // Shipper đã thu hồi kiện hàng: giải phóng trạng thái chiếm dụng. Cân nặng thật do
            // HX711 báo qua MqttService.handleCompartmentStatus — không tự đặt 0 ở đây.
            compartment.setStatus("EMPTY");
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
