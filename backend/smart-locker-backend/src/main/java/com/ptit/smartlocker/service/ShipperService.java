package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ShipperService {

    private final ShipperIdentityTokenRepository tokenRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;
    private final PickupCredentialRepository credentialRepository;
    private final DeviceEventRepository deviceEventRepository;

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

        if (token.getIsVerified()) {
            throw new RuntimeException("Mã QR Shipper này đã được sử dụng!");
        }

        token.setIsVerified(true);
        tokenRepository.save(token);
        return true;
    }

    /**
     * 3. Shipper quét mã vận đơn đơn hàng và bỏ hàng vào ngăn tủ
     * Kiểm tra cảm biến kép: Cảm biến trọng lượng HX711 + Cảm biến đóng cửa MC-38
     */
    @Transactional
    public ShipperDTO.DepositResponse depositPackage(ShipperDTO.DepositPackageRequest request) {
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
            compartmentRepository.save(compartment);
        }

        // Ghi nhật ký sự kiện thu hồi
        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(order.getCompartment() != null ? order.getCompartment().getCompartmentId() : null)
                .eventType("RECALL_OVERDUE_SUCCESS")
                .eventPayload("Shipper recalled overdue order " + orderId + " back to warehouse")
                .build();
        deviceEventRepository.save(event);
    }
}
