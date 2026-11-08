package com.ptit.smartlocker.service;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Tự nhả ngăn khi shipper đặt trước nhưng không đến tủ.
 *
 * <p>Vấn đề: shipper bấm "đặt trước ngăn" trên web, hệ thống giữ ngăn ở trạng thái
 * {@code RESERVED}. Nếu shipper không đến nạp hàng thì ngăn bị giữ vô thời hạn và khách khác
 * không dùng được, dù trên lý thuyết ngăn vẫn trống.
 *
 * <p>Cách xử lý: quét định kỳ các đơn {@code PENDING} có {@code shipper_reserved_at} cũ hơn
 * ngưỡng {@code app.reservation.timeout-minutes}, rồi nhả ngăn về {@code EMPTY} và xoá dấu đặt trước.
 *
 * <p>Khác với {@code cancelReserve} của shipper ở chỗ: tác vụ này **không** cộng lại
 * {@code available_slots}, vì khi shipper đặt trước ta đã KHÔNG trừ slot (slot đã bị trừ lúc khách
 * đặt hàng — xem {@code OrderService.createOrder}). Cộng ở đây là cộng hai lần.
 */
@Service
@Slf4j
public class ReservationTimeoutService {

    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;

    /**
     * Số phút giữ chỗ tối đa cho một lần shipper đặt trước. Mặc định 120 phút.
     * Đặt 0 hoặc số âm để TẮT hoàn toàn tác vụ này.
     */
    @Value("${app.reservation.timeout-minutes:120}")
    private long timeoutMinutes;

    public ReservationTimeoutService(OrderRepository orderRepository,
                                     CompartmentRepository compartmentRepository) {
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
    }

    /**
     * Quét mỗi 5 phút một lần. Chu kỳ ngắn hơn ngưỡng timeout để ngăn được nhả sớm nhất có thể,
     * nhưng không quá dày để tránh truy vấn vô ích.
     */
    @Scheduled(fixedRate = 300000) // 5 phút
    @Transactional
    public void releaseExpiredReservations() {
        if (timeoutMinutes <= 0) {
            return; // tác vụ bị tắt bằng cấu hình
        }

        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(timeoutMinutes);
        List<Order> expired = orderRepository.findExpiredShipperReservations(cutoff);
        if (expired.isEmpty()) {
            return;
        }

        log.info("Phát hiện {} đơn đặt trước ngăn quá {} phút mà shipper chưa đến — bắt đầu nhả ngăn.",
                expired.size(), timeoutMinutes);

        for (Order order : expired) {
            try {
                releaseOne(order);
            } catch (Exception e) {
                // Một đơn lỗi không được làm hỏng cả lượt quét.
                log.error("Không nhả được ngăn cho đơn {}: {}", order.getOrderId(), e.getMessage());
            }
        }
    }

    private void releaseOne(Order order) {
        Compartment comp = order.getCompartment();

        if (comp == null) {
            // Đơn đã mất ngăn từ trước (ví dụ bị autoRelease của LockerService dọn) — chỉ xoá dấu.
            order.setShipperReservedAt(null);
            orderRepository.save(order);
            log.info("Đơn {} hết hạn đặt trước nhưng không còn giữ ngăn — đã xoá dấu đặt trước.", order.getOrderId());
            return;
        }

        String status = comp.getStatus() == null ? "" : comp.getStatus().toUpperCase();
        if ("OCCUPIED".equals(status)) {
            // Đã có hàng thật trong ngăn → không được đụng vào. Ghi cảnh báo để người vận hành biết
            // dữ liệu đặt trước đang lệch với thực tế.
            log.warn("Đơn {} quá hạn đặt trước nhưng ngăn {} đang OCCUPIED — KHÔNG nhả. Kiểm tra thủ công.",
                    order.getOrderId(), comp.getCompIndex());
            return;
        }

        if (!"RESERVED".equals(status) && !"EMPTY".equals(status)) {
            log.warn("Đơn {} quá hạn đặt trước nhưng ngăn {} ở trạng thái lạ '{}' — bỏ qua.",
                    order.getOrderId(), comp.getCompIndex(), status);
            return;
        }

        comp.setStatus("EMPTY");
        comp.setCurrentWeight(0.0);
        comp.setIsDoorClosed(true);
        compartmentRepository.save(comp);

        order.setCompartment(null);
        order.setShipperReservedAt(null);
        orderRepository.save(order);

        // KHÔNG cộng available_slots: slot đã bị trừ lúc khách đặt hàng, không trừ lúc shipper đặt trước.
        log.info("Đã tự nhả ngăn #{} của tủ {} khỏi đơn {} do quá hạn đặt trước {} phút (ngày {}).",
                comp.getCompIndex(),
                order.getLocker() != null ? order.getLocker().getLockerId() : "N/A",
                order.getOrderId(), timeoutMinutes, LocalDate.now());
    }
}
