package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Builder;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * GĐ10 — nhật ký bảo trì tủ/ngăn.
 *
 * <p><b>Vì sao cần bảng riêng thay vì dùng {@code command_logs}:</b> hai thứ khác bản chất.
 * {@code command_logs} là nhật ký **kỹ thuật** (mỗi lần phát lệnh MQTT, kể cả lệnh tự động,
 * kể cả lệnh thất bại) và phần lớn bản ghi trong đó **không có ai bấm**. Bảo trì là hành động
 * **do một admin chủ động làm**, cần lưu lý do và người làm để trả lời "ai đã khoá tủ này, vì sao"
 * — nhét vào {@code command_logs} sẽ làm bảng đó lẫn hai loại ý nghĩa.
 *
 * <p>{@code compartmentId} NULL nghĩa là bảo trì **toàn tủ**; có giá trị là bảo trì **một ngăn**.
 * Cố ý không tách thành hai bảng: cùng một nghiệp vụ "tạm ngưng phục vụ", chỉ khác phạm vi.
 */
@Entity
@Table(
        name = "locker_maintenance_logs",
        indexes = {
                @Index(name = "idx_maintenance_logs_locker", columnList = "locker_id"),
                @Index(name = "idx_maintenance_logs_created", columnList = "created_at")
        }
)
@Getter
@Setter
@Builder
public class MaintenanceLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "log_id")
    private Long logId;

    public MaintenanceLog() {}

    public MaintenanceLog(Long logId, Locker locker, Integer compartmentId, String action,
                          String reasonCode, String note, String byUsername,
                          LocalDateTime createdAt) {
        this.logId = logId;
        this.locker = locker;
        this.compartmentId = compartmentId;
        this.action = action;
        this.reasonCode = reasonCode;
        this.note = note;
        this.byUsername = byUsername;
        this.createdAt = createdAt;
    }

    /**
     * Tủ bị tác động.
     *
     * <p>LAZY + luôn được query nạp sẵn (`LEFT JOIN FETCH`) khi đọc danh sách — nếu không,
     * map sang DTO trong vòng lặp sẽ thành N+1 (bài học GĐ3/GĐ7).
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    private Locker locker;

    /** NULL = bảo trì toàn tủ; có giá trị = bảo trì ngăn đó (1-based như `compartments`). */
    @Column(name = "compartment_id")
    private Integer compartmentId;

    /** {@code LOCK} hoặc {@code UNLOCK}. */
    @Column(name = "action", nullable = false, length = 20)
    private String action;

    /** {@code GIA_CO}, {@code HONG_CAN}, {@code VE_SINH}, {@code NANG_CAP}, {@code KHAC}. */
    @Column(name = "reason_code", length = 30)
    private String reasonCode;

    @Column(name = "note", length = 255)
    private String note;

    /**
     * Username admin đã thực hiện.
     *
     * <p><b>Khác {@code command_logs}:</b> ở đây LUÔN có giá trị, vì mọi lần bảo trì đều do một
     * request HTTP có xác thực ADMIN gọi tới (`Authentication.getName()`), không phải bản tin
     * thiết bị tự phát. Vì vậy cột để NOT NULL.
     */
    @Column(name = "by_username", nullable = false, length = 50)
    private String byUsername;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
