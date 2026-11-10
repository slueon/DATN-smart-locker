package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.CommandLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CommandLogRepository extends JpaRepository<CommandLog, String> {
    List<CommandLog> findByLocker_LockerIdOrderBySentAtDesc(String lockerId);

    /**
     * GĐ7 — lịch sử mở tủ, tuỳ chọn lọc theo tủ, mới nhất trước.
     *
     * <p><b>Vì sao dùng {@code LEFT JOIN FETCH o.locker}:</b> {@code CommandLog.locker} là
     * {@code @ManyToOne(LAZY)}. DTO cần {@code locker.getLockerId()}, nên nếu không fetch sẵn,
     * Hibernate phát thêm 1 câu SELECT cho MỖI dòng khi map — đúng lỗi N+1 đã sửa ở GĐ3. Với
     * {@code limit=50} thì đó là 50 câu SELECT thừa mỗi lần admin mở tab.
     *
     * <p>{@code lockerId} để null nghĩa là lấy mọi tủ (admin xem toàn hệ thống).
     * Phân trang bằng {@link Pageable} để giới hạn số dòng ngay ở DB thay vì kéo cả bảng lên
     * bộ nhớ rồi cắt — {@code command_logs} sẽ tăng mãi theo thời gian chạy.
     */
    @Query("SELECT c FROM CommandLog c LEFT JOIN FETCH c.locker l "
            + "WHERE (:lockerId IS NULL OR l.lockerId = :lockerId) "
            + "ORDER BY c.sentAt DESC")
    List<CommandLog> findRecentWithLocker(@Param("lockerId") String lockerId, Pageable pageable);
}
