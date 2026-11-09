package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.ShipperIdentityToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ShipperIdentityTokenRepository extends JpaRepository<ShipperIdentityToken, Long> {

    Optional<ShipperIdentityToken> findByDynamicToken(String dynamicToken);

    Optional<ShipperIdentityToken> findByDynamicTokenAndIsVerifiedTrue(String dynamicToken);

    Optional<ShipperIdentityToken> findTopByShipperIdOrderByCreatedAtDesc(String shipperId);

    /**
     * Các phiên shipper ĐÃ xác thực và CÒN hiệu lực (không lọc tủ).
     * @deprecated dùng {@link #findActiveVerifiedTokensForLocker} — lọc theo tủ là bắt buộc,
     * nếu không shipper xác thực ở tủ A sẽ mở được cửa tủ B.
     */
    @Deprecated
    @Query("select t from ShipperIdentityToken t where t.isVerified = true and t.expiredAt > :now")
    List<ShipperIdentityToken> findActiveVerifiedTokens(@Param("now") LocalDateTime now);

    /**
     * Phiên shipper ĐÃ xác thực TẠI ĐÚNG TỦ và còn hiệu lực.
     * Đây là truy vấn phải dùng khi quyết định có cho mở cửa tủ hay không.
     */
    @Query("select t from ShipperIdentityToken t "
            + "where t.isVerified = true and t.expiredAt > :now and t.lockerId = :lockerId")
    List<ShipperIdentityToken> findActiveVerifiedTokensForLocker(@Param("lockerId") String lockerId,
                                                                 @Param("now") LocalDateTime now);
}
