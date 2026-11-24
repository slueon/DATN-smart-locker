package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import com.ptit.smartlocker.service.PickupService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ54 — L1: đếm lần thử OTP sai phải được LƯU dù request ném lỗi. L2: gán tủ không được tự giữ ngăn.
 * KHÔNG @Transactional ở lớp: L1 chỉ lộ khi transaction của
 * service thật sự commit/rollback.
 */
@SpringBootTest
class Gd54FixTests {

    private static final String LOCKER = "LOCKER_HN_08";
    private static final String ORD_L1 = "ORD-GD54-L1";
    private static final String ORD_L2 = "ORD-GD54-L2";

    @Autowired private PickupService pickupService;
    @Autowired private ShipperService shipperService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private PickupCredentialRepository credentialRepository;

    @AfterEach
    void don() {
        credentialRepository.findByOrder_OrderId(ORD_L1).ifPresent(credentialRepository::delete);
        for (String id : List.of(ORD_L1, ORD_L2)) {
            orderRepository.findById(id).ifPresent(o -> {
                o.setCompartment(null);
                orderRepository.save(o);
                orderRepository.delete(o);
            });
        }
        for (Compartment c : compartmentRepository.findByLocker_LockerId(LOCKER)) {
            c.setStatus("EMPTY");
            c.setCurrentWeight(0.0);
            compartmentRepository.save(c);
        }
    }

    private PickupDTO.VerifyCredentialRequest otp(String code) {
        return PickupDTO.VerifyCredentialRequest.builder()
                .lockerId(LOCKER).authMethod("OTP").code(code).orderId(ORD_L1).build();
    }

    @Test
    @DisplayName("GĐ54-L1: sai OTP 5 lần → còn 4,3,2,1 rồi khoá mã; DB failed_attempts 1..5; mã đúng vẫn bị chặn")
    void demLanThuDuocLuu() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        Compartment c = compartmentRepository.findByLocker_LockerId(LOCKER).get(0);
        c.setStatus("OCCUPIED");
        compartmentRepository.save(c);
        Order o = orderRepository.save(Order.builder().orderId(ORD_L1).customerName("K")
                .customerPhone("0912000154").deliveryType("LOCKER").expectedDate(LocalDate.now())
                .status("DEPOSITED").totalAmount(BigDecimal.TEN).productName("p")
                .locker(locker).compartment(c).build());
        credentialRepository.save(PickupCredential.builder().order(o).qrToken("QR-GD54")
                .otpCode("123456").expiredAt(LocalDateTime.now().plusHours(1)).build());

        int[] conLai = {4, 3, 2, 1};
        for (int i = 0; i < 5; i++) {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> pickupService.verifyAndPickup(otp("000000")));
            if (i < 4) {
                assertTrue(ex.getMessage().contains("còn " + conLai[i] + " lần"),
                        "lần " + (i + 1) + ": " + ex.getMessage());
            } else {
                assertTrue(ex.getMessage().contains("tạm khóa"), ex.getMessage());
            }
            assertEquals(i + 1,
                    credentialRepository.findByOrder_OrderId(ORD_L1).orElseThrow().getFailedAttempts(),
                    "failed_attempts phải được LƯU sau lần sai " + (i + 1));
        }
        // Mã đúng sau khi khoá mã vẫn bị chặn.
        BusinessException ex = assertThrows(BusinessException.class,
                () -> pickupService.verifyAndPickup(otp("123456")));
        assertTrue(ex.getMessage().contains("tạm khóa"), ex.getMessage());
    }

    @Test
    @DisplayName("Gán lại tủ sẽ nhả ngăn cũ và không tự giữ ngăn mới")
    void ganLaiTuKhongDatTruocNgan() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        List<Compartment> all = compartmentRepository.findByLocker_LockerId(LOCKER);
        for (Compartment c : all) {
            c.setStatus("OCCUPIED");
            compartmentRepository.save(c);
        }
        Compartment giu = all.get(0);
        giu.setStatus("RESERVED");
        compartmentRepository.save(giu);
        orderRepository.save(Order.builder().orderId(ORD_L2).customerName("K")
                .customerPhone("0912000155").deliveryType("LOCKER").expectedDate(LocalDate.now())
                .status("PENDING").totalAmount(BigDecimal.TEN).productName("p")
                .locker(locker).compartment(giu).build());

        shipperService.assignLocker(ORD_L2, LOCKER);

        Order sau = orderRepository.findById(ORD_L2).orElseThrow();
        assertNull(sau.getCompartment());
        assertNull(sau.getShipperReservedAt());
        assertNull(sau.getReserveExpiresAt());
        assertEquals(LOCKER, sau.getLocker().getLockerId());
        assertEquals("EMPTY",
                compartmentRepository.findById(giu.getCompartmentId()).orElseThrow().getStatus());
    }
}
