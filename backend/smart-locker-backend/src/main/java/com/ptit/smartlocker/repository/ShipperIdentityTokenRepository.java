package com.ptit.smartlocker.repository;

import com.ptit.smartlocker.entity.ShipperIdentityToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface ShipperIdentityTokenRepository extends JpaRepository<ShipperIdentityToken, Long> {

    Optional<ShipperIdentityToken> findByDynamicToken(String dynamicToken);

    Optional<ShipperIdentityToken> findTopByShipperIdOrderByCreatedAtDesc(String shipperId);
}
