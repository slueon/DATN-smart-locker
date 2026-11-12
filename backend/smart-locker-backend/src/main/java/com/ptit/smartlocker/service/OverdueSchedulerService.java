package com.ptit.smartlocker.service;

import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.OrderRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@Slf4j
public class OverdueSchedulerService {

    private final OrderRepository orderRepository;

    public OverdueSchedulerService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    /**
     * Tác vụ quét định kỳ (Mỗi 10 phút kiểm tra 1 lần)
     * Tự động quét và khóa các đơn hàng vượt quá thời hạn 24h00 ngày hôm sau
     *
     * <p><b>GĐ13 — đổi {@code void} → {@code int}.</b> Trước đây không có cách nào biết lượt quét
     * vừa rồi đổi được bao nhiêu đơn, nên nút "Quét đơn quá hạn" trên web phải quét một mảng
     * {@code localStorage} và báo con số bịa. Nay method trả về <b>số đơn thật sự chuyển sang
     * {@code OVERDUE}</b> để {@code POST /api/admin/scan-overdue} trả đúng con số đó cho client.
     *
     * <p>Spring {@code @Scheduled} gọi được method có giá trị trả về (bỏ qua kết quả), nên lịch
     * chạy ngầm giữ nguyên hành vi.
     *
     * @return số đơn đã chuyển sang OVERDUE trong lượt này (0 nếu không có đơn nào quá hạn)
     */
    @Scheduled(fixedRate = 600000) // 10 phút / lần
    @Transactional
    public int scanAndLockOverdueOrders() {
        LocalDateTime now = LocalDateTime.now();
        // N+1: bản nạp sẵn `locker` — vòng lặp dưới đọc order.getLocker().getLockerId() cho
        // từng đơn, nếu để LAZY thì mỗi đơn phát thêm 1 SELECT.
        List<Order> overdueOrders = orderRepository.findOverdueOrdersFetchLocker(now);

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
        return overdueOrders.size();
    }
}
