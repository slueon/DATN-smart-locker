package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.CommandLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CommandLogRepository extends JpaRepository<CommandLog, String> {
    List<CommandLog> findByLocker_LockerIdOrderBySentAtDesc(String lockerId);
}
