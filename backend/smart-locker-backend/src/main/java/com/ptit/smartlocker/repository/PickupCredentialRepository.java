package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.PickupCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface PickupCredentialRepository extends JpaRepository<PickupCredential, Long> {

    Optional<PickupCredential> findByOrder_OrderId(String orderId);

    Optional<PickupCredential> findByQrToken(String qrToken);

    @Query("SELECT p FROM PickupCredential p WHERE p.order.locker.lockerId = :lockerId AND p.otpCode = :otpCode AND p.isUsed = false")
    Optional<PickupCredential> findValidByLockerAndOtp(
            @Param("lockerId") String lockerId,
            @Param("otpCode") String otpCode
    );

    @Query("SELECT p FROM PickupCredential p WHERE p.order.locker.lockerId = :lockerId AND p.qrToken = :qrToken AND p.isUsed = false")
    Optional<PickupCredential> findValidByLockerAndQr(
            @Param("lockerId") String lockerId,
            @Param("qrToken") String qrToken
    );
}
