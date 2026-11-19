package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.ShipperIdentityToken;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ41 — THU HỒI ĐƠN QUÁ HẠN PHẢI XÁC THỰC QR SHIPPER.
 *
 * <p>Trước GĐ41 {@code recallOverduePackage} <b>không kiểm danh tính một dòng nào</b>: ai đăng nhập
 * được (kể cả ADMIN) gọi {@code POST /api/shipper/recall-overdue?orderId=…} là thu hồi được. Đo thật
 * lúc ban hành thẻ: ADMIN gọi ra **404** (qua được tầng quyền, chỉ trượt vì đơn không tồn tại),
 * shipper gọi **không kèm token** cũng ra 404 — tức thu hồi được mà không cần xác thực.
 *
 * <p>Bốn ca dưới đây khoá đúng luật: thiếu token / token chưa quét / token của shipper KHÁC (403) /
 * token hợp lệ thì chạy. Cộng một ca đối chứng để không chặn oan.
 */
@SpringBootTest
@Transactional
class ShipperRecallAuthTests {

    private static final String LOCKER = "LOCKER_HN_01";
    private static final String TOKEN_OK = "SHIP-GD41-OK";
    private static final String TOKEN_UNVERIFIED = "SHIP-GD41-UNVERIFIED";
    private static final String TOKEN_OTHER = "SHIP-GD41-OTHER";

    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;

    private Order order;

    @BeforeEach
    void setUp() {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        Compartment comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1)
                .orElseThrow(() -> new AssertionError("Seed phải có ngăn #1"));
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);

        order = orderRepository.save(Order.builder()
                .orderId("ORD-GD41-OVERDUE")
                .customerName("Khách Test GĐ41")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("OVERDUE")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ41")
                .build());

        LocalDateTime now = LocalDateTime.now();
        // token hợp lệ, thuộc shipper, ĐÃ quét
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper").dynamicToken(TOKEN_OK)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
        // token đúng shipper nhưng CHƯA quét
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper").dynamicToken(TOKEN_UNVERIFIED)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(false).build());
        // token của SHIPPER KHÁC, đã quét
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper-khac").dynamicToken(TOKEN_OTHER)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
    }

    @Test
    @DisplayName("GĐ41 (5): THIẾU dynamicToken → 400 đúng câu của depositPackage, đơn KHÔNG đổi")
    void thieuTokenBiChan() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", null, "shipper"));

        assertTrue(ex.getMessage().contains("Vui lòng quét mã QR xác thực danh tính Shipper"),
                "Phải dùng đúng câu của depositPackage để hai tab đồng bộ: " + ex.getMessage());
        assertEquals("OVERDUE", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus(),
                "Đơn KHÔNG được đổi trạng thái khi bị chặn");
    }

    @Test
    @DisplayName("GĐ41: token rỗng (blank) cũng bị chặn như thiếu")
    void tokenRongBiChan() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", "   ", "shipper"));
        assertTrue(ex.getMessage().contains("Vui lòng quét mã QR xác thực danh tính Shipper"));
    }

    @Test
    @DisplayName("GĐ41: token không tồn tại → 400 \"Mã QR định danh Shipper không hợp lệ\"")
    void tokenKhongTonTaiBiChan() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", "SHIP-KHONG-CO", "shipper"));
        assertTrue(ex.getMessage().contains("không hợp lệ"), "Message: " + ex.getMessage());
        assertEquals("OVERDUE", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ41 (6): token CHƯA quét (isVerified=false) → 400 \"chưa được quét xác thực\"")
    void tokenChuaQuetBiChan() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", TOKEN_UNVERIFIED, "shipper"));
        assertTrue(ex.getMessage().contains("chưa được quét xác thực"),
                "Message: " + ex.getMessage());
        assertEquals("OVERDUE", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus(),
                "Đơn phải còn OVERDUE");
    }

    @Test
    @DisplayName("GĐ41 (7): token của SHIPPER KHÁC → 403 AccessDenied, đơn KHÔNG đổi")
    void tokenShipperKhacBi403() {
        AccessDeniedException ex = assertThrows(AccessDeniedException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", TOKEN_OTHER, "shipper"),
                "Token hợp lệ nhưng không phải của người đang đăng nhập → phải là 403, không phải 200");
        assertTrue(ex.getMessage().contains("không thuộc tài khoản đang đăng nhập"),
                "Message: " + ex.getMessage());
        assertEquals("OVERDUE", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus(),
                "Đơn phải còn OVERDUE — không được thu hồi hộ người khác");
    }

    @Test
    @DisplayName("GĐ41: không có Principal (null) → 403, không cho chạy")
    void khongCoPrincipalBi403() {
        assertThrows(AccessDeniedException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-OVERDUE", TOKEN_OK, null));
        assertEquals("OVERDUE", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus());
    }

    @Test
    @DisplayName("GĐ41 (9): token HỢP LỆ + đúng shipper → thu hồi thành công, đơn COMPLETED, ngăn EMPTY")
    void tokenHopLeThiThuHoiDuoc() {
        shipperService.recallOverduePackage("ORD-GD41-OVERDUE", TOKEN_OK, "shipper");

        assertEquals("RECALLED", orderRepository.findById("ORD-GD41-OVERDUE").orElseThrow().getStatus(),
                "GĐ73 — đơn thu hồi phải sang RECALLED (trước: COMPLETED)");
        assertEquals("EMPTY",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow().getStatus(),
                "Ngăn phải được giải phóng");
    }

    @Test
    @DisplayName("GĐ41: token hợp lệ nhưng đơn KHÔNG quá hạn → vẫn 409 như cũ (không regression)")
    void donKhongQuaHanThi409() {
        Order khac = orderRepository.save(Order.builder()
                .orderId("ORD-GD41-DEPOSITED")
                .customerName("Khách Test GĐ41")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(lockerRepository.findById(LOCKER).orElseThrow())
                .expectedDate(LocalDate.now())
                .status("DEPOSITED")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ41")
                .build());

        assertThrows(com.ptit.smartlocker.exception.BusinessException.class,
                () -> shipperService.recallOverduePackage("ORD-GD41-DEPOSITED", TOKEN_OK, "shipper"),
                "Đơn không OVERDUE phải là 409 BusinessException như trước GĐ41");
        assertEquals("DEPOSITED", orderRepository.findById("ORD-GD41-DEPOSITED").orElseThrow().getStatus());
    }
}
