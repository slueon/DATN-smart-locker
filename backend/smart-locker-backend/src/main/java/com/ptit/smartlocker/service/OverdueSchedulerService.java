package com.ptit.smartlocker.service;

import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.OrderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class OverdueSchedulerService {

    private final OrderRepository orderRepository;

    /**
     * Tác vụ quét định kỳ (Mỗi 10 phút kiểm tra 1 lần)
     * Tự động quét và khóa các đơn hàng vượt quá thời hạn 24h00 ngày hôm sau
     */
    @Scheduled(fixedRate = 600000) // 10 phút / lần
    @Transactional
    public void scanAndLockOverdueOrders() {
        LocalDateTime now = LocalDateTime.now();
        List<Order> overdueOrders = orderRepository.findOverdueOrders(now);

        if (!overdueOrders.isEmpty()) {
            log.info("Phát hiện {} đơn hàng quá hạn lưu kho tại tủ! Bắt đầu khóa mã...", overdueOrders.size());
            for (Order order : overdueOrders) {
                order.setStatus("OVERDUE");
                orderRepository.save(order);
                log.warn("Đơn hàng {} (Tủ {}) đã hết hạn lưu kho lúc {} -> Đã chuyển sang trạng thái OVERDUE",
                        order.getOrderId(),
                        order.getLocker() != null ? order.getLocker().getLockerId() : "N/A",
                        order.getExpiryDeadline());
            }
        }
    }
}
