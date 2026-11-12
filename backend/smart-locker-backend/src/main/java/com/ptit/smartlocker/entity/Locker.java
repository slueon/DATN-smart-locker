package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "lockers")
@Getter
@Setter
public class Locker {

    @Id
    @Column(name = "locker_id", length = 50)
    private String lockerId;

    public Locker() {}

    public Locker(String lockerId, String name, String address, Double latitude, Double longitude, String connectionStatus, Integer totalCompartments, LocalDateTime lastHeartbeat, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this(lockerId, name, address, latitude, longitude, connectionStatus, totalCompartments,
                lastHeartbeat, createdAt, updatedAt, false);
    }

    /**
     * Constructor đầy đủ 11 tham số. {@code @Builder} đặt Ở ĐÂY (không đặt trên class) vì class
     * có NHIỀU constructor và Lombok chọn constructor đầu tiên không tham số-hoá được — lần
     * compile đầu nó chọn bản 10 tham số (thiếu {@code isVirtual}) và báo
     * "Boolean cannot be converted to LocalDateTime". Đặt builder trên đúng constructor đủ field
     * là cách tường minh, không phụ thuộc thứ tự khai báo.
     */
    @Builder
    public Locker(String lockerId, String name, String address, Double latitude, Double longitude,
                  String connectionStatus, Integer totalCompartments, LocalDateTime lastHeartbeat,
                  LocalDateTime createdAt, LocalDateTime updatedAt, Boolean isVirtual) {
        this.lockerId = lockerId;
        this.name = name;
        this.address = address;
        this.latitude = latitude;
        this.longitude = longitude;
        this.connectionStatus = connectionStatus != null ? connectionStatus : "ONLINE";
        this.totalCompartments = totalCompartments != null ? totalCompartments : 3;
        this.lastHeartbeat = lastHeartbeat;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.isVirtual = isVirtual != null ? isVirtual : false;
    }

    @Column(name = "name", nullable = false, length = 100)
    private String name;

    @Column(name = "address", nullable = false)
    private String address;

    @Column(name = "latitude", nullable = false)
    private Double latitude;

    @Column(name = "longitude", nullable = false)
    private Double longitude;

    @Column(name = "connection_status", length = 20)
    @Builder.Default
    private String connectionStatus = "ONLINE"; // ONLINE, OFFLINE, MAINTENANCE

    @Column(name = "total_compartments", nullable = false)
    @Builder.Default
    private Integer totalCompartments = 3;

    @Column(name = "last_heartbeat")
    private LocalDateTime lastHeartbeat;

    /**
     * GĐ12 — {@code true} = tủ KHAI BÁO trong CSDL, không có thiết bị thật gửi nhịp tim.
     *
     * <p><b>Vì sao phải có cờ này thay vì suy từ {@code lastHeartbeat}:</b> phần cứng thật chỉ có
     * 1 tủ ({@code Tu_1} → {@code LOCKER_HN_01}); 9 tủ còn lại là dữ liệu mẫu nên không bao
     * giờ có nhịp tim, và suy thuần từ nhịp tim thì chúng luôn hiện "Mất kết nối" — sai sự thật
     * theo hướng ngược lại (chúng không hỏng, chúng không tồn tại về mặt thiết bị).
     *
     * <p><b>Tuyệt đối KHÔNG bịa {@code lastHeartbeat} cho tủ ảo</b> để làm chúng "xanh": làm vậy
     * là giả mạo dữ liệu thiết bị. Cột nhịp tim phải phản ánh sự thật; trạng thái "có kết nối"
     * của tủ ảo đến từ chính cờ này và luôn được hiển thị kèm nhãn "(tủ ảo)".
     *
     * <p><b>Tủ thật KHÔNG được bỏ qua kiểm nhịp tim</b> — {@code LOCKER_HN_01} vẫn bị loại khỏi
     * gợi ý / bị 409 khi thiết bị im quá 5 phút. Đó chính là mục đích của việc theo dõi.
     */
    @Column(name = "is_virtual", nullable = false)
    @Builder.Default
    private Boolean isVirtual = false;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}
