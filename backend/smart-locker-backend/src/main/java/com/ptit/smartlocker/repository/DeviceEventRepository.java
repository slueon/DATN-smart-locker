package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.DeviceEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DeviceEventRepository extends JpaRepository<DeviceEvent, Long> {
    List<DeviceEvent> findByLocker_LockerIdOrderByCreatedAtDesc(String lockerId);
}
