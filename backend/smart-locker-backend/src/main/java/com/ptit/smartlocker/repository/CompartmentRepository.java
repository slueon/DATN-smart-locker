package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Compartment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface CompartmentRepository extends JpaRepository<Compartment, Integer> {
    List<Compartment> findByLocker_LockerId(String lockerId);
    Optional<Compartment> findByLocker_LockerIdAndCompIndex(String lockerId, Integer compIndex);
    List<Compartment> findByLocker_LockerIdAndSizeAndStatus(String lockerId, String size, String status);
    List<Compartment> findByLocker_LockerIdAndStatus(String lockerId, String status);
}
