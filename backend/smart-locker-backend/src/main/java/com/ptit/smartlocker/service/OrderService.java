package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class OrderService {

    private final OrderRepository orderRepository;
    private final ProductRepository productRepository;
    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;
    private final PickupCredentialRepository pickupCredentialRepository;

    private final SecureRandom random = new SecureRandom();

    /**
     * Đặt hàng E-Commerce với Cơ chế Pessimistic Locking chống Race Condition
     */
    @Transactional
    public OrderDTO.OrderResponse createOrder(OrderDTO.CheckoutRequest request) {
        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        BigDecimal totalAmount = BigDecimal.ZERO;
        String requiredSize = "S";

        List<OrderItem> items = new ArrayList<>();
        String payMethod = request.getPaymentMethod() != null ? request.getPaymentMethod() : "ONLINE_VIETQR";
        String payStatus = request.getPaymentStatus() != null ? request.getPaymentStatus() :
                ("COD".equalsIgnoreCase(payMethod) ? "UNPAID" : "PAID");

        Order order = Order.builder()
                .orderId(orderId)
                .customerName(request.getCustomerName())
                .customerPhone(request.getCustomerPhone())
                .deliveryType(request.getDeliveryType())
                .expectedDate(request.getDeliveryDate())
                .paymentMethod(payMethod)
                .paymentStatus(payStatus)
                .status("PENDING")
                .totalAmount(BigDecimal.ZERO)
                .build();

        // Tính toán tổng tiền và kích thước kiện hàng lớn nhất
        for (OrderDTO.CartItemRequest itemReq : request.getItems()) {
            Product product = productRepository.findById(itemReq.getProductId())
                    .orElseThrow(() -> new RuntimeException("Không tìm thấy sản phẩm id: " + itemReq.getProductId()));

            BigDecimal itemTotal = product.getPrice().multiply(BigDecimal.valueOf(itemReq.getQuantity()));
            totalAmount = totalAmount.add(itemTotal);

            // Cập nhật size ngăn tủ cần thiết (L > M > S)
            if ("L".equals(product.getRequiredSize())) {
                requiredSize = "L";
            } else if ("M".equals(product.getRequiredSize()) && !"L".equals(requiredSize)) {
                requiredSize = "M";
            }

            OrderItem item = OrderItem.builder()
                    .order(order)
                    .product(product)
                    .quantity(itemReq.getQuantity())
                    .unitPrice(product.getPrice())
                    .build();
            items.add(item);
        }
        order.setOrderItems(items);
        order.setTotalAmount(totalAmount);

        // Xử lý giao tại tủ thông minh (Smart Locker)
        if ("LOCKER".equalsIgnoreCase(request.getDeliveryType())) {
            if (request.getLockerId() == null || request.getDeliveryDate() == null) {
                throw new IllegalArgumentException("Vui lòng chọn Tủ giao nhận và Ngày nhận mong muốn!");
            }

            Locker locker = lockerRepository.findById(request.getLockerId())
                    .orElseThrow(() -> new RuntimeException("Tủ không tồn tại: " + request.getLockerId()));
            order.setLocker(locker);

            // 1. Áp dụng PESSIMISTIC LOCKING để khóa và lấy lịch biểu an toàn (Atomic Lock)
            LockerSlotSchedule schedule = getOrCreateScheduleWithLock(locker, request.getDeliveryDate());

            if (schedule.getAvailableSlots() <= 0) {
                throw new RuntimeException("Tủ " + locker.getName() + " đã hết chỗ vào ngày " 
                        + request.getDeliveryDate() + ". Vui lòng chọn ngày khác hoặc Giao tận nhà!");
            }

            // 2. Tìm và khóa bi quan (SELECT ... FOR UPDATE) các ngăn tủ EMPTY của trạm
            List<Compartment> lockedEmptyComps = compartmentRepository
                    .findWithLockByLockerIdAndStatus(request.getLockerId(), "EMPTY");

            // Chọn ngăn tủ thích hợp nhất (ưu tiên đúng size -> nâng cấp size)
            Compartment assignedComp = selectSuitableCompartment(lockedEmptyComps, requiredSize);

            // 3. Toàn vẹn giao dịch: Nếu không còn ngăn tủ phù hợp kích cỡ, hủy giao dịch và rollback ngay lập tức!
            if (assignedComp == null) {
                throw new RuntimeException("Tủ " + locker.getName() + " hiện không còn ngăn tủ trống phù hợp với kích thước kiện hàng (Size " 
                        + requiredSize + "). Vui lòng chọn tủ khác hoặc hình thức Giao tận nhà!");
            }

            // Trừ 1 slot khả dụng trên lịch biểu
            schedule.setAvailableSlots(schedule.getAvailableSlots() - 1);
            slotScheduleRepository.save(schedule);

            // Đánh dấu ngăn tủ đã được giữ chỗ (RESERVED)
            assignedComp.setStatus("RESERVED");
            compartmentRepository.save(assignedComp);
            order.setCompartment(assignedComp);
        }

        orderRepository.save(order);

        // 3. Tạo mã nhận hàng (Mã OTP 6 chữ số và mã QR định danh duy nhất)
        String otpCode = String.format("%06d", random.nextInt(1_000_000));
        String qrToken = "PKUP-" + UUID.randomUUID().toString();

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode(otpCode)
                .qrToken(qrToken)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(2)) // Tạm thời set 2 ngày (sẽ chốt khi shipper deposit)
                .build();
        pickupCredentialRepository.save(credential);

        return mapToOrderResponse(order, qrToken, otpCode);
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId, String phone) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));

        // Ràng buộc chống IDOR: Nếu có cung cấp số điện thoại, bắt buộc phải khớp với đơn
        if (phone != null && !phone.isBlank() && !order.getCustomerPhone().equalsIgnoreCase(phone.trim())) {
            throw new RuntimeException("Bạn không có quyền truy cập thông tin đơn hàng này!");
        }

        return mapToOrderResponse(order, null, null);
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId) {
        return getOrderById(orderId, null);
    }

    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOrdersByCustomerPhone(String phone) {
        List<Order> orders = orderRepository.findByCustomerPhone(phone);
        return orders.stream()
                .map(o -> mapToOrderResponse(o, null, null))
                .toList();
    }

    public OrderDTO.OrderResponse mapToOrderResponse(Order order, String preloadedQr, String preloadedOtp) {
        String qrToken = preloadedQr;
        String otpCode = preloadedOtp;
        if (qrToken == null || otpCode == null) {
            var credOpt = pickupCredentialRepository.findByOrder_OrderId(order.getOrderId());
            if (credOpt.isPresent()) {
                qrToken = credOpt.get().getQrToken();
                otpCode = credOpt.get().getOtpCode();
            }
        }

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

        // 2. Nâng cấp lên ngăn lớn hơn nếu ngăn hiện tại nhỏ hơn
        if ("S".equalsIgnoreCase(requiredSize)) {
            for (Compartment comp : emptyComps) {
                if ("M".equalsIgnoreCase(comp.getSize())) return comp;
            }
            for (Compartment comp : emptyComps) {
                if ("L".equalsIgnoreCase(comp.getSize())) return comp;
            }
        } else if ("M".equalsIgnoreCase(requiredSize)) {
            for (Compartment comp : emptyComps) {
                if ("L".equalsIgnoreCase(comp.getSize())) return comp;
            }
        }

        return null;
    }
}
