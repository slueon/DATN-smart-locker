package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;

@Entity
@Table(name = "compartments", uniqueConstraints = {
        @UniqueConstraint(name = "uk_locker_comp", columnNames = {"locker_id", "comp_index"})
})
@Getter
@Setter
public class Compartment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "compartment_id")
    private Integer compartmentId;

    public Compartment() {}

    /**
     * Constructor đầy đủ 9 tham số — Lombok {@code @Builder} cần bản bao trùm MỌI field, kể cả
     * {@code irDetected} thêm ở GĐ22.
     *
     * <p>Bản 8 tham số bên dưới giữ lại để code cũ gọi {@code new Compartment(...)} không gãy —
     * đúng bài học GĐ9/GĐ12/GĐ21: khi entity có nhiều constructor thì builder phải đặt trên bản đủ
     * field, nếu không Lombok chọn bản thiếu và compile báo "no suitable constructor".
     *
     * <p>GĐ22 — {@code @Builder} đặt Ở ĐÂY (không đặt trên class) vì class có nhiều constructor:
     * để trên class thì Lombok chọn bản 8 tham số và báo
     * "incompatible types: Boolean cannot be converted to …" (đã dính đúng lỗi này).
     */
    @Builder
    public Compartment(Integer compartmentId, Locker locker, Integer compIndex, String size,
                       String status, Double currentWeight, Boolean isDoorClosed, Integer relayPin,
                       Boolean irDetected) {
        this(compartmentId, locker, compIndex, size, status, currentWeight, isDoorClosed, relayPin);
        this.irDetected = irDetected;
    }

    public Compartment(Integer compartmentId, Locker locker, Integer compIndex, String size, String status, Double currentWeight, Boolean isDoorClosed, Integer relayPin) {
        this.compartmentId = compartmentId;
        this.locker = locker;
        this.compIndex = compIndex;
        this.size = size != null ? size : "M";
        this.status = status != null ? status : "EMPTY";
        this.currentWeight = currentWeight != null ? currentWeight : 0.0;
        this.isDoorClosed = isDoorClosed != null ? isDoorClosed : true;
        this.relayPin = relayPin;
    }

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Locker locker;

    public String getLockerId() {
        return locker != null ? locker.getLockerId() : null;
    }

    @Column(name = "comp_index", nullable = false)
    private Integer compIndex;

    @Column(name = "size", nullable = false, length = 10)
    @Builder.Default
    private String size = "M"; // S, M, L

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "EMPTY"; // EMPTY, OCCUPIED, RESERVED, OUT_OF_SERVICE

    @Column(name = "current_weight")
    @Builder.Default
    private Double currentWeight = 0.0;

    @Column(name = "is_door_closed", nullable = false)
    @Builder.Default
    private Boolean isDoorClosed = true;

    /**
     * GĐ22 — cảm biến HỒNG NGOẠI báo có vật cản trong ngăn ({@code ir_detected} trong payload).
     *
     * <p><b>Vì sao cần, khi đã có {@code current_weight}:</b> kiện quá nhẹ thì loadcell đọc
     * {@code weight = 0} dù hàng đã nằm trong ngăn — firmware thật đã gửi đúng ca này
     * ({@code weight:0, ir_detected:1, has_item:1}). Cân không phân biệt được "ngăn trống" với
     * "có kiện 5 gram"; hồng ngoại thì làm được.
     *
     * <p><b>{@code NULL} = CHƯA TỪNG nhận thông tin IR</b> (firmware cũ, hoặc 20 ngăn có sẵn trước
     * GĐ22). CỐ Ý cho phép NULL: đặt {@code NOT NULL} sẽ làm {@code ddl-auto} không thêm được cột
     * trên DB đang có dữ liệu → app không khởi động (đúng kịch bản đã gặp ở GĐ9).
     *
     * <p>Cột này hiện <b>chỉ để lưu/truy vết</b> — chưa dùng để quyết định {@code status}.
     */
    @Column(name = "ir_detected")
    private Boolean irDetected;

    @Column(name = "relay_pin")
    private Integer relayPin;
}
