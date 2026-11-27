package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.ShipperIdentityToken;
import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ30 — NẠP HÀNG VÀO TỦ THẬT ĐANG MẤT NHỊP TIM.
 *
 * <p>Trước GĐ30, {@code depositPackage} là bước DUY NHẤT đưa hàng vào tủ mà lại không kiểm nhịp
 * tim (trong khi {@code suggestLockers} loại tủ mất nhịp và {@code assignLocker} trả 409). Đo thật
 * 15/11/2026: tủ thật {@code LOCKER_HN_01} mất nhịp 130 phút vẫn nạp được, DB đổi
 * {@code PENDING → DEPOSITED} / {@code EMPTY → OCCUPIED}.
 *
 * <p>Bốn ca dưới đây khoá đúng luật đã chốt (hướng A của user):
 * <ol>
 *   <li>tủ THẬT, nhịp tim cũ → 409, DB không đổi;</li>
 *   <li>tủ THẬT, nhịp tim mới → 200;</li>
 *   <li>tủ ẢO, nhịp tim NULL → 200 (tủ ảo bỏ qua kiểm — điều cấm #1);</li>
 *   <li>tủ THẬT, nhịp tim NULL → 409 (không coi NULL là "vừa sống" — điều cấm #2).</li>
 * </ol>
 */
@SpringBootTest
@Transactional
class HeartbeatDepositGuardTests {

    private static final String REAL_LOCKER = "LOCKER_HN_01";
    private static final String VIRTUAL_LOCKER = "LOCKER_HN_02";
    private static final String TOKEN = "TOKEN-GD30-TEST";

    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;
    @org.springframework.beans.factory.annotation.Autowired private com.ptit.smartlocker.repository.UserRepository userRepositoryForAssign;

    /** Token đã xác thực tại tủ đang xét. */
    private void taoToken(String lockerId) {
        LocalDateTime now = LocalDateTime.now();
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper")
                .dynamicToken(TOKEN)
                .createdAt(now)
                .expiredAt(now.plusMinutes(5))
                .isVerified(true)
                .lockerId(lockerId)
                .build());
    }

    /** Đơn PENDING ở ngăn 1 của tủ, ngăn ở trạng thái EMPTY. */
    private Order taoDonPending(String orderId, Locker locker) {
        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), 1)
                .orElseThrow(() -> new AssertionError("Seed data phải có ngăn #1 của " + locker.getLockerId()));
        comp.setStatus("EMPTY");
        compartmentRepository.save(comp);

        return orderRepository.save(Order.builder()
                .orderId(orderId)
                .customerName("Khách Test GĐ30")
                .assignedShipper(userRepositoryForAssign.findByUsername("shipper").orElseThrow()) // gộp ThanhChung: chỉ shipper được phân công mới nạp/thu hồi được
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ30")
                .build());
    }

    private ShipperDTO.DepositPackageRequest yeuCauNap(String orderId, String lockerId) {
        return ShipperDTO.DepositPackageRequest.builder()
                .lockerId(lockerId)
                .dynamicToken(TOKEN)
                .orderId(orderId)
                .weightGrams(0.8)
                .isDoorClosed(true)
                .build();
    }

    /** Đặt nhịp tim + trạng thái kết nối rồi lưu. */
    private void datNhipTim(Locker locker, LocalDateTime hb) {
        locker.setLastHeartbeat(hb);
        locker.setConnectionStatus("ONLINE");
        locker.setIsVirtual(VIRTUAL_LOCKER.equals(locker.getLockerId()));
        lockerRepository.save(locker);
    }

    // ─────────────────────────────────────────────────────────────
    // (1) TỦ THẬT — NHỊP TIM CŨ → 409, DB KHÔNG ĐỔI
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ30 (1): tủ THẬT mất nhịp 1 giờ → 409, đơn vẫn PENDING, ngăn vẫn EMPTY")
    void tuThatMatNhipBiChan() {
        Locker locker = lockerRepository.findById(REAL_LOCKER).orElseThrow();
        datNhipTim(locker, LocalDateTime.now().minusMinutes(60));
        taoToken(REAL_LOCKER);
        Order order = taoDonPending("ORD-GD30-OLD", locker);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD30-OLD", REAL_LOCKER)),
                "Tủ thật mất nhịp 60 phút mà vẫn nạp được là lỗ GĐ30 — phải 409");

        String msg = ex.getMessage().toUpperCase();
        assertTrue(msg.contains("NHỊP TIM"),
                "Message phải nói rõ mất nhịp tim, hiện tại: " + ex.getMessage());
        // Message phải khác hẳn thông điệp bảo trì (điều cấm #4).
        assertFalse(msg.contains("BẢO TRÌ"),
                "Không được gộp lý do nhịp tim vào thông điệp bảo trì: " + ex.getMessage());

        assertEquals("PENDING", orderRepository.findById("ORD-GD30-OLD").orElseThrow().getStatus(),
                "Đơn KHÔNG được sang DEPOSITED khi bị chặn");
        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(REAL_LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn KHÔNG được sang OCCUPIED khi bị chặn");
    }

    @Test
    @DisplayName("GĐ30 (1b): message nêu TÊN TỦ + SỐ PHÚT mất nhịp")
    void messageNeuTenTuVaSoPhut() {
        Locker locker = lockerRepository.findById(REAL_LOCKER).orElseThrow();
        datNhipTim(locker, LocalDateTime.now().minusMinutes(95));
        taoToken(REAL_LOCKER);
        taoDonPending("ORD-GD30-MSG", locker);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD30-MSG", REAL_LOCKER)));

        assertTrue(ex.getMessage().contains(locker.getName()),
                "Message phải nêu tên tủ: " + ex.getMessage());
        // 95 phút (cho phép lệch 1 phút do thời gian trôi khi chạy test).
        assertTrue(ex.getMessage().matches("(?s).*9[4-6] phút.*"),
                "Message phải nêu số phút mất nhịp (94..96): " + ex.getMessage());
    }

    // ─────────────────────────────────────────────────────────────
    // (2) TỦ THẬT — NHỊP TIM MỚI → 200
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ30 (2): tủ THẬT có nhịp tim vừa xong → nạp được (200)")
    void tuThatConSongThiNapDuoc() {
        Locker locker = lockerRepository.findById(REAL_LOCKER).orElseThrow();
        datNhipTim(locker, LocalDateTime.now().minusMinutes(1));
        taoToken(REAL_LOCKER);
        taoDonPending("ORD-GD30-FRESH", locker);

        ShipperDTO.DepositResponse res =
                shipperService.depositPackage(yeuCauNap("ORD-GD30-FRESH", REAL_LOCKER));

        assertTrue(res.isSuccess(), "Tủ thật còn sống thì phải nạp được");
        assertEquals("DEPOSITED",
                orderRepository.findById("ORD-GD30-FRESH").orElseThrow().getStatus(),
                "Đơn phải sang DEPOSITED");
    }

    // ─────────────────────────────────────────────────────────────
    // (3) TỦ ẢO — NHỊP TIM NULL → 200 (ĐIỀU CẤM #1)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ30 (3): tủ ẢO có lastHeartbeat=NULL → VẪN nạp được (không chặn tủ ảo)")
    void tuAoKhongBiChan() {
        Locker ao = lockerRepository.findById(VIRTUAL_LOCKER).orElseThrow();
        datNhipTim(ao, null);
        taoToken(VIRTUAL_LOCKER);
        taoDonPending("ORD-GD30-VIRT", ao);

        ShipperDTO.DepositResponse res =
                shipperService.depositPackage(yeuCauNap("ORD-GD30-VIRT", VIRTUAL_LOCKER));

        assertTrue(res.isSuccess(),
                "Tủ ảo không bao giờ gửi nhịp tim — chặn là mất 9/10 tủ (điều cấm #1)");
        assertEquals("DEPOSITED",
                orderRepository.findById("ORD-GD30-VIRT").orElseThrow().getStatus());
    }

    // ─────────────────────────────────────────────────────────────
    // (4) TỦ THẬT — NHỊP TIM NULL → 409 (ĐIỀU CẤM #2)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ30 (4): tủ THẬT có lastHeartbeat=NULL → 409 (NULL không phải 'vừa sống')")
    void tuThatNhipTimNullBiChan() {
        Locker locker = lockerRepository.findById(REAL_LOCKER).orElseThrow();
        datNhipTim(locker, null);
        taoToken(REAL_LOCKER);
        taoDonPending("ORD-GD30-NULL", locker);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD30-NULL", REAL_LOCKER)),
                "Tủ thật chưa từng gửi nhịp tim thì không được coi là đang sống");

        assertTrue(ex.getMessage().toUpperCase().contains("NHỊP TIM"),
                "Message phải nói rõ chưa có nhịp tim: " + ex.getMessage());
        assertEquals("PENDING", orderRepository.findById("ORD-GD30-NULL").orElseThrow().getStatus());
    }

    // ─────────────────────────────────────────────────────────────
    // (5) KHÔNG CHẶN OAN: tủ thật mới mất nhịp 4 phút (< ngưỡng 5) vẫn nạp được
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ30 (5): tủ THẬT mất nhịp 4 phút (< ngưỡng 5) → vẫn nạp được")
    void tuThatMoiMatNhip4PhutVanNapDuoc() {
        Locker locker = lockerRepository.findById(REAL_LOCKER).orElseThrow();
        datNhipTim(locker, LocalDateTime.now().minusMinutes(4));
        taoToken(REAL_LOCKER);
        taoDonPending("ORD-GD30-4MIN", locker);

        ShipperDTO.DepositResponse res =
                shipperService.depositPackage(yeuCauNap("ORD-GD30-4MIN", REAL_LOCKER));

        assertTrue(res.isSuccess(), "4 phút < ngưỡng 5 phút nên KHÔNG được chặn");
    }
}
