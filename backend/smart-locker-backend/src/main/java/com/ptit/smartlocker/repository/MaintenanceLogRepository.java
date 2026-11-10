package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.MaintenanceLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * GĐ10 — truy vấn nhật ký bảo trì.
 */
@Repository
public interface MaintenanceLogRepository extends JpaRepository<MaintenanceLog, Long> {

    /**
     * Nhật ký gần nhất, tuỳ chọn lọc theo tủ, mới nhất trước.
     *
     * <p><b>{@code LEFT JOIN FETCH l.locker}:</b> {@code MaintenanceLog.locker} là
     * {@code @ManyToOne(LAZY)}. DTO cần {@code locker.getLockerId()} nên không fetch sẵn là
     * Hibernate phát thêm 1 SELECT cho mỗi dòng — đúng lỗi N+1 đã sửa nhiều lần (GĐ3, GĐ7).
     *
     * <p>{@code lockerId} null = mọi tủ. {@link Pageable} để cắt ngay ở DB thay vì kéo cả bảng
     * (bảng này chỉ tăng, không bao giờ xoá).
     */
    @Query("SELECT m FROM MaintenanceLog m LEFT JOIN FETCH m.locker l "
            + "WHERE (:lockerId IS NULL OR l.lockerId = :lockerId) "
            + "ORDER BY m.createdAt DESC")
    List<MaintenanceLog> findRecentWithLocker(@Param("lockerId") String lockerId, Pageable pageable);
}
