package com.ptit.smartlocker.service;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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
 * <h2>Chống tranh chấp với luồng nạp hàng</h2>
 * Tác vụ này chạy song song với {@code ShipperService.depositPackage}. Hai bên cùng đọc một
 * {@code Order} rồi cùng ghi đè được — làm vậy ngăn vừa được nạp hàng ({@code OCCUPIED}) có thể bị
 * biến lại thành {@code EMPTY} và đơn đã {@code DEPOSITED} bị xoá dấu ngăn. Entity không có
 * {@code @Version} nên Hibernate không tự phát hiện xung đột.
 *
 * <p>Vì vậy:
 * <ol>
 *   <li><b>Quét</b> chỉ đọc id, một transaction ngắn rồi đóng (không giữ entity nào).</li>
 *   <li><b>Nhả</b> từng đơn trong transaction RIÊNG, mở đầu bằng
 *       {@code findByIdForReleaseWithLock} ({@code SELECT ... FOR UPDATE}) và <b>kiểm lại toàn bộ
 *       điều kiện trên dữ liệu vừa khoá</b> — không tin danh sách đã quét trước đó.</li>
 * </ol>
 * Nhờ vậy nếu shipper vừa nạp hàng xong, khoá sẽ đợi giao dịch đó commit, lần đọc lại thấy
 * {@code status != PENDING} hoặc ngăn {@code OCCUPIED} → bước nhả bị bỏ qua.
 *
 * <h2>Không bịa trạng thái cảm biến</h2>
 * Tác vụ này chỉ đổi {@code status} của ngăn, <b>không</b> đặt {@code isDoorClosed} hay
 * {@code currentWeight}. Hai trường đó là nguồn sự thật của phần cứng (MC-38, HX711) và chỉ được
 * ghi bởi {@code MqttService.handleCompartmentStatus}. Ghi đè ở đây sẽ làm dashboard báo "cửa đã
 * đóng" trong khi cửa đang mở.
 */
@Service
@Slf4j
public class ReservationTimeoutService {

    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;
    private final TransactionTemplate transactionTemplate;

    /**
     * Số phút giữ chỗ tối đa cho một lần shipper đặt trước. Mặc định 120 phút.
     * Đặt 0 hoặc số âm để TẮT hoàn toàn tác vụ này.
     */
    @Value("${app.reservation.timeout-minutes:120}")
    private long timeoutMinutes;

    public ReservationTimeoutService(OrderRepository orderRepository,
                                     CompartmentRepository compartmentRepository,
                                     PlatformTransactionManager transactionManager) {
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    /**
     * Quét mỗi 5 phút một lần. Chu kỳ ngắn hơn ngưỡng timeout để ngăn được nhả sớm nhất có thể,
     * nhưng không quá dày để tránh truy vấn vô ích.
     *
     * <p><b>Không</b> đánh dấu {@code @Transactional} ở đây: bọc cả lượt quét vào một transaction
     * sẽ giữ entity cũ trong persistence context suốt thời gian dài và tạo ra đúng lỗi tranh chấp
     * mà lớp này muốn tránh.
     */
    @Scheduled(fixedRate = 300000) // 5 phút
    public void releaseExpiredReservations() {
        if (timeoutMinutes <= 0) {
            return; // tác vụ bị tắt bằng cấu hình
        }

        LocalDateTime cutoff = LocalDateTime.now().minusMinutes(timeoutMinutes);

        // Bước 1: chỉ lấy danh sách id trong một transaction ngắn, rồi thoát ra ngay.
        List<String> candidates = transactionTemplate.execute(status ->
                orderRepository.findExpiredShipperReservations(cutoff).stream()
                        .map(Order::getOrderId)
                        .toList());

        if (candidates == null || candidates.isEmpty()) {
            return;
        }

        log.info("Phát hiện {} đơn đặt trước ngăn quá {} phút mà shipper chưa đến — bắt đầu nhả ngăn.",
                candidates.size(), timeoutMinutes);

        for (String orderId : candidates) {
            try {
                // Bước 2: mỗi đơn một transaction riêng, có khoá bi quan và KIỂM LẠI điều kiện.
                Boolean released = transactionTemplate.execute(status -> releaseOne(orderId));
                if (Boolean.TRUE.equals(released)) {
                    log.info("Đã tự nhả ngăn của đơn {} do quá hạn đặt trước {} phút (ngày {}).",
                            orderId, timeoutMinutes, LocalDate.now());
                }
            } catch (Exception e) {
                // Một đơn lỗi không được làm hỏng cả lượt quét.
                log.error("Không nhả được ngăn cho đơn {}: {}", orderId, e.getMessage());
            }
        }
    }

    /**
     * Nhả ngăn trong transaction hiện tại. Trả {@code true} nếu thật sự đã nhả.
     *
     * <p>Mọi điều kiện được kiểm lại trên entity VỪA ĐƯỢC KHOÁ — không dùng dữ liệu đã quét trước đó.
     */
    private boolean releaseOne(String orderId) {
        Order order = orderRepository.findByIdForReleaseWithLock(orderId).orElse(null);
        if (order == null) {
            return false;
        }

        // Điều kiện có thể đã đổi trong lúc chờ khoá: shipper nạp hàng xong, hoặc shipper tự huỷ.
        if (!"PENDING".equalsIgnoreCase(order.getStatus()) || order.getShipperReservedAt() == null) {
            log.debug("Bỏ qua đơn {}: trạng thái hoặc dấu đặt trước đã đổi trong lúc chờ khoá (status={}).",
                    orderId, order.getStatus());
            return false;
        }
        if (!order.getShipperReservedAt().isBefore(LocalDateTime.now().minusMinutes(timeoutMinutes))) {
            log.debug("Bỏ qua đơn {}: đã được gia hạn đặt trước trong lúc chờ khoá.", orderId);
            return false;
        }

        Compartment comp = order.getCompartment();

        if (comp == null) {
            // Đơn đã mất ngăn từ trước (ví dụ bị autoRelease của LockerService dọn) — chỉ xoá dấu.
            order.setShipperReservedAt(null);
            orderRepository.save(order);
            log.info("Đơn {} hết hạn đặt trước nhưng không còn giữ ngăn — đã xoá dấu đặt trước.", orderId);
            return true;
        }

        String status = comp.getStatus() == null ? "" : comp.getStatus().toUpperCase();
        if ("OCCUPIED".equals(status)) {
            // Đã có hàng thật trong ngăn → không được đụng vào. Ghi cảnh báo để người vận hành biết
            // dữ liệu đặt trước đang lệch với thực tế.
            log.warn("Đơn {} quá hạn đặt trước nhưng ngăn {} đang OCCUPIED — KHÔNG nhả. Kiểm tra thủ công.",
                    orderId, comp.getCompIndex());
            return false;
        }

        if (!"RESERVED".equals(status) && !"EMPTY".equals(status)) {
            log.warn("Đơn {} quá hạn đặt trước nhưng ngăn {} ở trạng thái lạ '{}' — bỏ qua.",
                    orderId, comp.getCompIndex(), status);
            return false;
        }

        // CHỈ đổi status. KHÔNG ghi isDoorClosed / currentWeight: đó là trạng thái cảm biến
        // (MC-38 và HX711), chỉ MqttService.handleCompartmentStatus được cập nhật.
        comp.setStatus("EMPTY");
        compartmentRepository.save(comp);

        order.setCompartment(null);
        order.setShipperReservedAt(null);
        orderRepository.save(order);

        // KHÔNG cộng available_slots: slot đã bị trừ lúc khách đặt hàng, không trừ lúc shipper đặt trước.
        log.info("Đã tự nhả ngăn #{} của tủ {} khỏi đơn {} (status ngăn giữ nguyên cảm biến: cửa {}, nặng {}).",
                comp.getCompIndex(),
                order.getLocker() != null ? order.getLocker().getLockerId() : "N/A",
                orderId, comp.getIsDoorClosed(), comp.getCurrentWeight());
        return true;
    }
}
