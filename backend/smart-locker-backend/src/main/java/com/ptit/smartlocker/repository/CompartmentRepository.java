package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Compartment;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CompartmentRepository extends JpaRepository<Compartment, Integer> {
    List<Compartment> findByLocker_LockerId(String lockerId);
    Optional<Compartment> findByLocker_LockerIdAndCompIndex(String lockerId, Integer compIndex);
    List<Compartment> findByLocker_LockerIdAndSizeAndStatus(String lockerId, String size, String status);
    List<Compartment> findByLocker_LockerIdAndStatus(String lockerId, String status);

    /**
     * Khóa dòng bi quan (Pessimistic Write Lock - SELECT ... FOR UPDATE)
     * Ngăn chặn nhiều giao dịch cùng tranh chấp một ngăn tủ EMPTY
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM Compartment c WHERE c.locker.lockerId = :lockerId AND c.status = :status ORDER BY c.compIndex ASC")
    List<Compartment> findWithLockByLockerIdAndStatus(
            @Param("lockerId") String lockerId,
            @Param("status") String status
    );

    /**
     * GĐ11 — nạp TOÀN BỘ ngăn của MỌI tủ trong <b>một</b> câu query, kèm {@code locker}.
     *
     * <p><b>Vì sao cần:</b> {@code GET /api/shipper/suggest-lockers} phải biết từng tủ còn bao
     * nhiêu ngăn {@code EMPTY} phù hợp cỡ kiện. Cách sai là gọi
     * {@code findByLocker_LockerIdAndStatus} trong vòng lặp 10 tủ → 10 câu SELECT (N+1). Cách sai
     * thứ hai là {@code findAll()} rồi gọi {@code c.getLockerId()}: quan hệ {@code locker} là LAZY
     * nên mỗi ngăn lại phát một SELECT nữa. {@code JOIN FETCH} gộp cả hai vào đúng 1 câu.
     */
    @Query("SELECT c FROM Compartment c JOIN FETCH c.locker ORDER BY c.locker.lockerId ASC, c.compIndex ASC")
    List<Compartment> findAllWithLocker();
}
