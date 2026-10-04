package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
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
        Order order = Order.builder()
                .orderId(orderId)
                .customerName(request.getCustomerName())
                .customerPhone(request.getCustomerPhone())
                .deliveryType(request.getDeliveryType())
                .expectedDate(request.getDeliveryDate())
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

            // 1. Áp dụng PESSIMISTIC LOCKING để tránh đặt trùng slot (Race Condition)
            LockerSlotSchedule schedule = slotScheduleRepository
                    .findWithLockByLockerIdAndDate(request.getLockerId(), request.getDeliveryDate())
                    .orElseGet(() -> {
                        LockerSlotSchedule newSchedule = LockerSlotSchedule.builder()
                                .locker(locker)
                                .scheduleDate(request.getDeliveryDate())
                                .totalSlots(locker.getTotalCompartments())
                                .availableSlots(locker.getTotalCompartments())
                                .version(0L)
                                .build();
                        return slotScheduleRepository.save(newSchedule);
                    });

            if (schedule.getAvailableSlots() <= 0) {
                throw new RuntimeException("Tủ " + locker.getName() + " đã hết chỗ vào ngày " 
                        + request.getDeliveryDate() + ". Vui lòng chọn ngày khác hoặc Giao tận nhà!");
            }

            // Trừ 1 slot khả dụng
            schedule.setAvailableSlots(schedule.getAvailableSlots() - 1);
            slotScheduleRepository.save(schedule);

            // 2. Tìm ngăn tủ phù hợp theo kích cỡ (S/M/L) và đang còn EMPTY
            List<Compartment> availableComps = compartmentRepository
                    .findByLocker_LockerIdAndStatus(request.getLockerId(), "EMPTY");

            if (!availableComps.isEmpty()) {
                // Ưu tiên ngăn cùng size, nếu không lấy ngăn đầu tiên còn trống
                final String targetSize = requiredSize;
                Compartment assignedComp = availableComps.stream()
                        .filter(c -> c.getSize().equalsIgnoreCase(targetSize))
                        .findFirst()
                        .orElse(availableComps.get(0));

                assignedComp.setStatus("RESERVED");
                compartmentRepository.save(assignedComp);
                order.setCompartment(assignedComp);
            }
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

        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(order.getLocker() != null ? order.getLocker().getLockerId() : null)
                .lockerName(order.getLocker() != null ? order.getLocker().getName() : null)
                .compartmentIndex(order.getCompartment() != null ? order.getCompartment().getCompIndex() : null)
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .totalAmount(order.getTotalAmount())
                .qrToken(qrToken)
                .otpCode(otpCode)
                .createdAt(order.getCreatedAt())
                .build();
    }

    public Order getOrderById(String orderId) {
        return orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));
    }

    public List<Order> getOrdersByCustomerPhone(String phone) {
        return orderRepository.findByCustomerPhone(phone);
    }
}
