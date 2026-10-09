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
}
