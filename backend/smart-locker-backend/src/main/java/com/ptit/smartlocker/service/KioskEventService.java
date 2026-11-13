package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.KioskEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Bộ đệm sự kiện Kiosk của tủ thật — cầu nối giữa luồng MQTT và web shipper.
 *
 * <h2>Vì sao KHÔNG ghi xuống CSDL</h2>
 * <p>Đây là tín hiệu TỨC THỜI cho giao diện ("vừa quét QR shipper", "vừa chọn ngăn"), sống
 * vài giây rồi vô nghĩa. Ghi mỗi sự kiện thành một dòng DB sẽ làm bảng phình vô hạn theo
 * số lần test phần cứng, trong khi {@code device_events}/{@code command_logs} đã là nhật ký
 * thật dùng cho truy vết và thống kê.
 *
 * <h2>Vì sao ring buffer + {@code seq}</h2>
 * <p>Web poll mỗi 1,5 giây và hỏi "có gì mới sau mốc {@code seq} này không". Nếu chỉ trả
 * "danh sách 10 sự kiện gần nhất", client không phân biệt được sự kiện mới với sự kiện cũ
 * → popup phát lại liên tục. {@code seq} tăng đơn điệu nên so sánh {@code > after} là đủ,
 * không cần timestamp (đồng hồ client/máy chủ lệch nhau là chuyện thường).
 *
 * <p>Giới hạn {@value #MAX_EVENTS} sự kiện: quá mốc đó thì sự kiện cũ nhất bị đẩy ra. Một
 * shipper thao tác chậm nhất cũng chỉ tạo vài sự kiện mỗi lượt nạp, nên 200 là thừa rộng;
 * mục đích của giới hạn là để bộ nhớ không tăng mãi trong lúc chạy dài ngày.
 *
 * <p><b>An toàn đa luồng:</b> {@link #record} chạy trên thread callback của Paho, còn
 * {@link #since} chạy trên thread HTTP request. Mọi thao tác trên {@code events} đều nằm
 * trong {@code synchronized (events)}; {@code seq} là {@link AtomicLong} để đọc mốc mà
 * không cần khoá.
 */
@Slf4j
@Service
public class KioskEventService {

    /** Số sự kiện tối đa giữ trong bộ nhớ. */
    private static final int MAX_EVENTS = 200;

    public static final String SHIPPER_VERIFIED = "SHIPPER_VERIFIED";
    public static final String SHIPPER_REJECTED = "SHIPPER_REJECTED";
    public static final String ORDER_VALID = "ORDER_VALID";
    public static final String ORDER_INVALID = "ORDER_INVALID";
    public static final String COMPARTMENT_SELECTED = "COMPARTMENT_SELECTED";
    public static final String DEPOSIT_SUCCESS = "DEPOSIT_SUCCESS";

    private final AtomicLong seq = new AtomicLong(0L);
    private final Deque<KioskEvent> events = new ArrayDeque<>(MAX_EVENTS);

    /**
     * Ghi một sự kiện. {@code seq} do service cấp, không nhận từ ngoài.
     *
     * @return sự kiện đã ghi (kèm {@code seq} và {@code at} thật)
     */
    public KioskEvent record(String lockerId,
                             String type,
                             String orderId,
                             String trackingCode,
                             Integer compartment,
                             Boolean reserved,
                             String message) {
        KioskEvent event = KioskEvent.builder()
                .seq(seq.incrementAndGet())
                .lockerId(lockerId)
                .type(type)
                .orderId(orderId)
                .trackingCode(trackingCode)
                .compartment(compartment)
                .reserved(reserved)
                .message(message)
                .at(LocalDateTime.now())
                .build();

        synchronized (events) {
            events.addLast(event);
            while (events.size() > MAX_EVENTS) {
                events.removeFirst();
            }
        }
        log.debug("KioskEvent #{} {} tại tủ {}: {}", event.getSeq(), type, lockerId, message);
        return event;
    }

    /**
     * Các sự kiện có {@code seq > after} của ĐÚNG tủ {@code lockerId}, cũ nhất trước.
     *
     * <p>Lọc theo tủ là bắt buộc: nhiều tủ cùng báo lên một backend, shipper đứng ở tủ A
     * không được thấy popup "đã mở ngăn" của tủ B.
     *
     * <p>{@code after == null} → trả danh sách RỖNG (client đang hỏi mốc khởi đầu).
     */
    public List<KioskEvent> since(String lockerId, Long after) {
        if (after == null) {
            return List.of();
        }
        List<KioskEvent> result = new ArrayList<>();
        synchronized (events) {
            for (KioskEvent event : events) {
                if (event.getSeq() <= after) {
                    continue;
                }
                if (lockerId == null || lockerId.isBlank()
                        || lockerId.equalsIgnoreCase(event.getLockerId())) {
                    result.add(event);
                }
            }
        }
        return result;
    }

    /** Số thứ tự lớn nhất đã cấp; 0 nghĩa là chưa có sự kiện nào từ lúc khởi động. */
    public long latestSeq() {
        return seq.get();
    }
}
