package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;
    private final PickupCredentialRepository pickupCredentialRepository;

    public OrderService(
            OrderRepository orderRepository,
            LockerRepository lockerRepository,
            CompartmentRepository compartmentRepository,
            LockerSlotScheduleRepository slotScheduleRepository,
            PickupCredentialRepository pickupCredentialRepository) {
        this.orderRepository = orderRepository;
        this.lockerRepository = lockerRepository;
        this.compartmentRepository = compartmentRepository;
        this.slotScheduleRepository = slotScheduleRepository;
        this.pickupCredentialRepository = pickupCredentialRepository;
    }

    /**
     * Tạo đơn gửi bưu kiện vào Tủ với Cơ chế Pessimistic Locking chống Race Condition
     */
    @Transactional
    public OrderDTO.OrderResponse createOrder(OrderDTO.CheckoutRequest request) {
        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        BigDecimal totalAmount = request.getTotalAmount() != null ? request.getTotalAmount() : BigDecimal.ZERO;
        String requiredSize = request.getRequiredSize() != null && !request.getRequiredSize().isBlank()
                ? request.getRequiredSize().trim().toUpperCase() : "S";
        String productName = request.getProductName() != null && !request.getProductName().isBlank()
                ? request.getProductName().trim() : "Bưu kiện Smart Locker";

        LocalDate deliveryDate = request.getDeliveryDate() != null ? request.getDeliveryDate() : LocalDate.now().plusDays(2);
        if (deliveryDate.isBefore(LocalDate.now())) {
            throw new IllegalArgumentException("Ngày nhận hàng không thể là ngày trong quá khứ!");
        }
        String payMethod = request.getPaymentMethod() != null ? request.getPaymentMethod() : "ONLINE_VIETQR";
        String payStatus = request.getPaymentStatus() != null ? request.getPaymentStatus() :
                ("COD".equalsIgnoreCase(payMethod) ? "UNPAID" : "PAID");

        Order order = Order.builder()
                .orderId(orderId)
                .customerName(request.getCustomerName())
                .customerPhone(request.getCustomerPhone())
                .deliveryType(request.getDeliveryType())
                .expectedDate(deliveryDate)
                .paymentMethod(payMethod)
                .paymentStatus(payStatus)
                .status("PENDING")
                .totalAmount(totalAmount)
                .productName(productName)
                .build();

        // Xử lý giao tại tủ thông minh (Smart Locker)
        if ("LOCKER".equalsIgnoreCase(request.getDeliveryType())) {
            if (request.getLockerId() == null) {
                throw new IllegalArgumentException("Vui lòng chọn Tủ giao nhận!");
            }

            Locker locker = lockerRepository.findById(request.getLockerId())
                    .orElseThrow(() -> new RuntimeException("Tủ không tồn tại: " + request.getLockerId()));
            order.setLocker(locker);

            // 1. Áp dụng PESSIMISTIC LOCKING để khóa và lấy lịch biểu an toàn (Atomic Lock)
            LockerSlotSchedule schedule = getOrCreateScheduleWithLock(locker, deliveryDate);

            // Nếu đặt cho HÔM NAY: Đồng bộ availableSlots với số ngăn EMPTY thực tế
            if (deliveryDate.isEqual(LocalDate.now())) {
                List<Compartment> currentEmptyComps = compartmentRepository
                        .findByLocker_LockerIdAndStatus(request.getLockerId(), "EMPTY");
                if (currentEmptyComps.size() > schedule.getAvailableSlots()) {
                    schedule.setAvailableSlots(currentEmptyComps.size());
                    slotScheduleRepository.save(schedule);
                }
            }

            if (schedule.getAvailableSlots() <= 0) {
                throw new RuntimeException("Tủ " + locker.getName() + " đã hết chỗ vào ngày " 
                        + deliveryDate + ". Vui lòng chọn ngày khác hoặc Giao tận nhà!");
            }

            // Trừ 1 slot khả dụng trên lịch biểu theo ngày
            schedule.setAvailableSlots(schedule.getAvailableSlots() - 1);
            slotScheduleRepository.save(schedule);

            // 2. Chỉ khóa trước ngăn tủ vật lý nếu ngày giao hàng là HÔM NAY
            // Nếu đặt trước cho ngày tương lai, ngăn tủ sẽ được gán tự động khi Shipper nạp hàng vào ngày đó
            if (deliveryDate.isEqual(LocalDate.now())) {
                List<Compartment> lockedEmptyComps = compartmentRepository
                        .findWithLockByLockerIdAndStatus(request.getLockerId(), "EMPTY");

                Compartment assignedComp = selectSuitableCompartment(lockedEmptyComps, requiredSize);
                if (assignedComp == null) {
                    throw new RuntimeException("Tủ " + locker.getName() + " hiện không còn ngăn tủ trống phù hợp với kích thước kiện hàng (Size " 
                            + requiredSize + "). Vui lòng chọn tủ khác hoặc hình thức Giao tận nhà!");
                }

                assignedComp.setStatus("RESERVED");
                compartmentRepository.save(assignedComp);
                order.setCompartment(assignedComp);
            }
        }

        orderRepository.save(order);

        // 3. Tạo mã nhận hàng (Mã QR định danh duy nhất)
        String qrToken = "PKUP-" + order.getOrderId();

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode("") // Sẽ được cấp khi hàng đã nạp vào tủ (DEPOSITED)
                .qrToken(qrToken)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(2))
                .build();
        pickupCredentialRepository.save(credential);

        return mapToOrderResponse(order, qrToken, null, true);
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId, String phone) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));

        boolean isAuthorized = phone != null && !phone.isBlank() && order.getCustomerPhone().equalsIgnoreCase(phone.trim());

        // Ràng buộc chống IDOR: Nếu có cung cấp số điện thoại, bắt buộc phải khớp với đơn
        if (phone != null && !phone.isBlank() && !isAuthorized) {
            throw new RuntimeException("Bạn không có quyền truy cập thông tin đơn hàng này!");
        }

        // Chỉ tiết lộ mã mở tủ khi đã xác thực đúng số điện thoại và đơn hàng đã ở trong tủ (DEPOSITED)
        boolean revealSecrets = isAuthorized && "DEPOSITED".equalsIgnoreCase(order.getStatus());
        OrderDTO.OrderResponse response = mapToOrderResponse(order, null, null, revealSecrets);

        // Che giấu dữ liệu định danh PII nếu người truy vấn chưa xác thực khớp SĐT
        if (!isAuthorized) {
            if (response.getCustomerPhone() != null && response.getCustomerPhone().length() >= 7) {
                String rawPhone = response.getCustomerPhone();
                response.setCustomerPhone(rawPhone.substring(0, 3) + "****" + rawPhone.substring(rawPhone.length() - 3));
            }
            if (response.getCustomerName() != null && response.getCustomerName().length() > 2) {
                response.setCustomerName(response.getCustomerName().charAt(0) + "***" + response.getCustomerName().charAt(response.getCustomerName().length() - 1));
            }
        }

        return response;
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId) {
        return getOrderById(orderId, null);
    }

    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOrdersByCustomerPhone(String phone) {
        if (phone == null || phone.isBlank()) {
            return List.of();
        }
        List<Order> orders = orderRepository.findByCustomerPhone(phone.trim());
        return orders.stream()
                .map(o -> mapToOrderResponse(o, null, null, "DEPOSITED".equalsIgnoreCase(o.getStatus())))
                .toList();
    }

    public OrderDTO.OrderResponse mapToOrderResponse(Order order, String preloadedQr, String preloadedOtp) {
        return mapToOrderResponse(order, preloadedQr, preloadedOtp, true);
    }

    public OrderDTO.OrderResponse mapToOrderResponse(Order order, String preloadedQr, String preloadedOtp, boolean includeSecrets) {
        String qrToken = null;
        String otpCode = null;

        if (includeSecrets) {
            qrToken = preloadedQr;
            otpCode = preloadedOtp;
            if (qrToken == null || otpCode == null) {
                var credOpt = pickupCredentialRepository.findByOrder_OrderId(order.getOrderId());
                if (credOpt.isPresent()) {
                    qrToken = credOpt.get().getQrToken();
                    otpCode = credOpt.get().getOtpCode();
                }
            }
        }

        String productName = order.getProductName() != null ? order.getProductName() : "Bưu kiện Smart Locker";

        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(order.getLocker() != null ? order.getLocker().getLockerId() : null)
                .lockerName(order.getLocker() != null ? order.getLocker().getName() : null)
                .compartmentIndex(order.getCompartment() != null ? order.getCompartment().getCompIndex() : null)
                .expectedDate(order.getExpectedDate())
                .depositedAt(order.getDepositedAt())
                .expiryDeadline(order.getExpiryDeadline())
                .status(order.getStatus())
                .productName(productName)
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .qrToken(qrToken)
                .otpCode(otpCode)
                .createdAt(order.getCreatedAt())
                .build();
    }

    /**
     * Khởi tạo an toàn và khóa bi quan bản ghi Lịch biểu (Pessimistic Lock).
     * Sử dụng INSERT IGNORE để ngăn ngừa hoàn toàn Race Condition / DataIntegrityViolationException.
     */
    private LockerSlotSchedule getOrCreateScheduleWithLock(Locker locker, LocalDate deliveryDate) {
        slotScheduleRepository.initScheduleIfNotExists(
                locker.getLockerId(),
                deliveryDate,
                locker.getTotalCompartments()
        );

        return slotScheduleRepository
                .findWithLockByLockerIdAndDate(locker.getLockerId(), deliveryDate)
                .orElseThrow(() -> new RuntimeException("Không thể khóa lịch biểu cho tủ: " + locker.getLockerId()));
    }

    /**
     * Thuật toán lựa chọn ngăn tủ phù hợp theo kích cỡ (Size Matching Strategy):
     * - Ưu tiên 1: Chọn đúng kích thước yêu cầu (Exact Match: S -> S, M -> M, L -> L)
     * - Ưu tiên 2: Nâng cấp ngăn lớn hơn nếu hết ngăn chuẩn (Size Upgrade: S -> M -> L, M -> L)
     * - Trả về null nếu không có ngăn nào đủ sức chứa
     */
    private Compartment selectSuitableCompartment(List<Compartment> emptyComps, String requiredSize) {
        if (emptyComps == null || emptyComps.isEmpty()) {
            return null;
        }

        // 1. Khớp chính xác kích thước
        for (Compartment comp : emptyComps) {
            if (comp.getSize() != null && comp.getSize().equalsIgnoreCase(requiredSize)) {
                return comp;
            }
        }

        // 2. Nâng cấp lên ngăn lớn (Size L) nếu ngăn nhỏ (Size S) đã kín chỗ
        if ("S".equalsIgnoreCase(requiredSize) || "M".equalsIgnoreCase(requiredSize)) {
            for (Compartment comp : emptyComps) {
                if ("L".equalsIgnoreCase(comp.getSize())) return comp;
            }
        }

        return null;
    }
}
