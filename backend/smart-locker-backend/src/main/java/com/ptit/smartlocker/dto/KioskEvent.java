package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Một sự kiện tại Kiosk tủ thật, dùng cho popup theo sự kiện ở web shipper.
 *
 * <p><b>Vì sao phải có DTO này:</b> khi shipper thao tác trên màn hình TFT của tủ, web
 * không có cách nào biết chuyện gì vừa xảy ra — toàn bộ luồng diễn ra trong firmware rồi
 * bắn MQTT lên backend. Trước đây web phải "đoán" bằng thanh 4 bước tự bấm, nên luôn lệch
 * với phần cứng. Nay backend ghi lại sự kiện thật và web chỉ hiển thị lại.
 *
 * <p><b>Chỉ nằm trong bộ nhớ</b> (xem {@code KioskEventService}): đây là tín hiệu tức thời
 * cho UI, không phải nhật ký nghiệp vụ. Nhật ký thật vẫn là {@code device_events} và
 * {@code command_logs}.
 */
@Getter
@Setter
@Builder
public class KioskEvent {

    /** Số thứ tự tăng dần toàn cục — client dùng làm mốc {@code after} để không phát lại sự kiện cũ. */
    private long seq;

    /** Id tủ trong CSDL ({@code LOCKER_HN_01}), không phải id thiết bị ({@code Tu_1}). */
    private String lockerId;

    /** SHIPPER_VERIFIED, SHIPPER_REJECTED, ORDER_VALID, ORDER_INVALID, COMPARTMENT_SELECTED, DEPOSIT_SUCCESS. */
    private String type;

    private String orderId;
    private String trackingCode;

    /** Chỉ số ngăn 1-based (khớp {@code compartments.comp_index}); null khi sự kiện không gắn ngăn. */
    private Integer compartment;

    /** Đơn có phải đơn shipper đã đặt trước hay không; null khi sự kiện không liên quan đặt trước. */
    private Boolean reserved;

    /** Câu hiển thị cho shipper (tiếng Việt), backend soạn sẵn để web không phải đoán. */
    private String message;

    private LocalDateTime at;
}
