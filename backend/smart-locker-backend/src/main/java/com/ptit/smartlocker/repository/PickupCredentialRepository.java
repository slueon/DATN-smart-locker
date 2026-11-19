package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.PickupCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PickupCredentialRepository extends JpaRepository<PickupCredential, Long> {

    Optional<PickupCredential> findByOrder_OrderId(String orderId);

    Optional<PickupCredential> findByQrToken(String qrToken);

    // GĐ72 (#6) — hai truy vấn dưới nhận cả `PICKUP_OPENED`: `PickupService.verifyAndPickup` cho mở
    // lại bằng chính mã khi đơn đang trong phiên nhận. Trước GĐ72 chỉ lấy `DEPOSITED` nên đường
    // kiosk (không kèm orderId) báo "Mã không chính xác" trong khi đường web (kèm orderId) mở được.
    // Truy vấn OTP còn dùng để chống trùng OTP trong tủ — thêm PICKUP_OPENED cũng đúng cho việc đó.

    @Query("SELECT p FROM PickupCredential p WHERE p.order.locker.lockerId = :lockerId AND p.otpCode = :otpCode AND p.isUsed = false AND p.order.status IN ('DEPOSITED', 'PICKUP_OPENED')")
    List<PickupCredential> findValidByLockerAndOtp(
            @Param("lockerId") String lockerId,
            @Param("otpCode") String otpCode
    );

    @Query("SELECT p FROM PickupCredential p WHERE p.order.locker.lockerId = :lockerId AND p.qrToken = :qrToken AND p.isUsed = false AND p.order.status IN ('DEPOSITED', 'PICKUP_OPENED')")
    List<PickupCredential> findValidByLockerAndQr(
            @Param("lockerId") String lockerId,
            @Param("qrToken") String qrToken
    );
}
