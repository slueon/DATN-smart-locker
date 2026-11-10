package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * GĐ10 — DTO trả nhật ký bảo trì cho API ADMIN.
 *
 * <p>Không trả entity vì cùng lý do đã áp dụng ở {@code CommandLogDTO}: quan hệ
 * {@code MaintenanceLog.locker} là LAZY, serialize thẳng sẽ ném
 * {@code LazyInitializationException} hoặc kéo cả entity {@code Locker} ra ngoài.
 */
@Getter
@Setter
@Builder
public class MaintenanceLogDTO {

    private Long logId;
    private String lockerId;
    /** NULL = bảo trì toàn tủ; có giá trị = chỉ bảo trì ngăn đó (1-based). */
    private Integer compartmentId;
    /** {@code LOCK} hoặc {@code UNLOCK}. */
    private String action;
    private String reasonCode;
    private String note;
    /** Username admin đã thực hiện — luôn có (khác {@code command_logs}, xem entity). */
    private String byUsername;
    private LocalDateTime createdAt;
}
