package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.Locker;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface LockerRepository extends JpaRepository<Locker, String> {
    List<Locker> findByConnectionStatus(String connectionStatus);
}
