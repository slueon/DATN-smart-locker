package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CommandLogRepository;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.LockerService;
import org.junit.jupiter.api.BeforeEach;
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
 * GĐ53 — "MỞ KHẨN CẤP" KHÔNG ĐƯỢC GIẢI PHÓNG NGĂN ĐANG CÓ ĐƠN ⇒ HAI ĐƠN MỘT NGĂN.
 *
 * <h2>Lỗi thật (bằng chứng DB)</h2>
 * <p>{@code ORD-DCCA6036} ở trạng thái {@code DEPOSITED} trỏ vào <b>ngăn 1</b> của {@code LOCKER_HN_01},
 * nhưng ngăn 1 lại {@code EMPTY/0}. {@code command_logs} của ngăn 1: 21:21 {@code SHIPPER_DEPOSIT} →
 * 21:26 {@code CUSTOMER_PICKUP}+{@code OTP} → <b>21:31 {@code ADMIN_FORCE_UNLOCK}</b> → 21:37 pickup
 * lại — sau lần mở khẩn cấp, đơn vẫn {@code DEPOSITED} mà ngăn đã bị đặt {@code EMPTY}.
 *
 * <p>Hệ quả đo được: GĐ51 cấp ngăn 1 (lúc đó {@code EMPTY}) cho {@code ORD-99A2C56E} trong khi
 * {@code ORD-DCCA6036} còn trỏ vào ⇒ <b>hai đơn một ngăn</b>.
 *
 * <p><b>Nguyên nhân gốc:</b> {@code LockerService.forceUnlockCompartment:114} gọi
 * {@code comp.setStatus("EMPTY")} <b>vô điều kiện</b>, không xét đơn đang dùng ngăn. Cùng lúc đó guard
 * ở {@code MqttService.handleCompartmentStatus} lại thấy đơn {@code DEPOSITED} trỏ vào nên giữ
 * {@code OCCUPIED} — hai nơi "cãi nhau" về cùng một ngăn.
 *
 * <h2>Luật mới</h2>
 * <p>Mở khẩn cấp <b>vẫn gửi đúng 1 lệnh</b> {@code EMERGENCY_OVERRIDE} (điều cấm #1, giữ GĐ46/GĐ50),
 * nhưng <b>chỉ</b> đặt {@code EMPTY} khi KHÔNG còn đơn {@code DEPOSITED}/{@code OVERDUE}/{@code PENDING}
 * trỏ vào ngăn; còn đơn thì giữ nguyên trạng thái ngăn và nói rõ lý do.
 *
 * <p>MQTT tắt trong môi trường test nên {@code publishCommand} chỉ ghi {@code command_logs} — đếm
 * {@code command_logs} như các test GĐ45/GĐ46 đã làm, <b>không</b> assert giá trị trả về.
 */
@SpringBootTest
@Transactional
class EmergencyUnlockGuardTests {

    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private LockerService lockerService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private CommandLogRepository commandLogRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById(LOCKER).orElseThrow();
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);
        // Dọn các đơn test còn sót; KHÔNG đụng dữ liệu thật (ORD-DCCA6036…).
        orderRepository.findByStatus("DEPOSITED").stream()
                .filter(o -> o.getOrderId().startsWith("ORD-GD53-"))
                .forEach(orderRepository::delete);
        orderRepository.findByStatus("OVERDUE").stream()
                .filter(o -> o.getOrderId().startsWith("ORD-GD53-"))
                .forEach(orderRepository::delete);
        orderRepository.findByStatus("PENDING").stream()
                .filter(o -> o.getOrderId().startsWith("ORD-GD53-"))
                .forEach(orderRepository::delete);
    }

    private Compartment ngan(int idx, String status) {
        Compartment c = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, idx).orElseThrow();
        c.setStatus(status);
        c.setCurrentWeight(0.0);
        c.setIrDetected(null);
        c.setIsDoorClosed(true);
        return compartmentRepository.save(c);
    }

    private Order taoDon(String orderId, int compIndex, String status) {
        Compartment c = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, compIndex).orElseThrow();
        return orderRepository.save(Order.builder()
                .orderId(orderId)
                .customerName("Khách Test GĐ53")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(c)
                .expectedDate(LocalDate.now())
                .depositedAt(LocalDateTime.now().minusHours(2))
                .expiryDeadline(LocalDateTime.now().plusDays(1))
                .status(status)
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ53")
                .build());
    }

    // ─────────────────────────────────────────────────────────────
    // (1) NGĂN CÓ ĐƠN ĐANG GỬI → GIỮ OCCUPIED (ca lỗi gốc)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ53 (1): ngăn có đơn DEPOSITED → mở khẩn cấp GIỮ OCCUPIED, đơn không đổi, vẫn đúng 1 lệnh")
    void nganCoDonDepositedThiGiuOccupied() {
        ngan(1, "OCCUPIED");
        Order don = taoDon("ORD-GD53-DEP", 1, "DEPOSITED");
        long logTruoc = commandLogRepository.count();

        Compartment sau = lockerService.forceUnlockCompartment(LOCKER, 1);

        assertEquals("OCCUPIED", sau.getStatus(),
                "Ngăn đang có đơn DEPOSITED trỏ vào KHÔNG được đặt EMPTY — làm vậy là biến đơn đang "
                        + "trong tủ thành 'đơn treo trên ngăn trống', và ngăn đó sẽ được cấp cho đơn "
                        + "khác ⇒ hai đơn một ngăn (đúng sự cố ORD-DCCA6036 / ORD-99A2C56E).");

        Compartment trongDb = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        assertEquals("OCCUPIED", trongDb.getStatus(), "Trạng thái phải được LƯU xuống DB, không chỉ trong RAM.");

        Order donSau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertEquals("DEPOSITED", donSau.getStatus(), "Mở khẩn cấp không được đổi trạng thái đơn.");
        assertNotNull(donSau.getCompartment(), "Đơn vẫn phải trỏ vào ngăn của nó.");

        assertEquals(logTruoc + 1, commandLogRepository.count(),
                "Vẫn phải phát ĐÚNG 1 lệnh mở (điều cấm #1 — giữ GĐ46/GĐ50): mở khẩn cấp là mở CỬA, "
                        + "không phải huỷ đơn.");
    }

    @Test
    @DisplayName("GĐ53 (1b): ngăn có đơn OVERDUE → cũng GIỮ OCCUPIED (hàng còn trong tủ chờ thu hồi)")
    void nganCoDonOverdueThiGiuOccupied() {
        ngan(2, "OCCUPIED");
        taoDon("ORD-GD53-OVD", 2, "OVERDUE");
        long logTruoc = commandLogRepository.count();

        Compartment sau = lockerService.forceUnlockCompartment(LOCKER, 2);

        assertEquals("OCCUPIED", sau.getStatus(),
                "Đơn OVERDUE là hàng CÒN trong tủ chờ shipper thu hồi — ngăn không được coi là trống.");
        assertEquals(logTruoc + 1, commandLogRepository.count());
    }

    // ─────────────────────────────────────────────────────────────
    // (2) NGĂN KHÔNG CÓ ĐƠN → EMPTY NHƯ CŨ (không chặn oan)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ53 (2): ngăn KHÔNG có đơn → mở khẩn cấp vẫn đặt EMPTY như trước")
    void nganKhongCoDonThiVanEmpty() {
        ngan(2, "OCCUPIED"); // có hàng nhưng không đơn nào trỏ vào (ca giải phóng ngăn kẹt)
        long logTruoc = commandLogRepository.count();

        Compartment sau = lockerService.forceUnlockCompartment(LOCKER, 2);

        assertEquals("EMPTY", sau.getStatus(),
                "Không còn đơn nào giữ ngăn ⇒ đây đúng là ca cần giải phóng, phải giữ hành vi cũ.");
        assertEquals(logTruoc + 1, commandLogRepository.count(), "Vẫn đúng 1 lệnh mở.");
    }

    // ─────────────────────────────────────────────────────────────
    // (3) KHÔNG GHI CÂN/CỬA (điều cấm #2)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ53 (3): mở khẩn cấp KHÔNG ghi cân/cửa — đó là số của cảm biến")
    void khongGhiCanVaCua() {
        Compartment c = ngan(1, "OCCUPIED");
        c.setCurrentWeight(850.0);
        c.setIsDoorClosed(true);
        compartmentRepository.save(c);

        Compartment sau = lockerService.forceUnlockCompartment(LOCKER, 1);

        assertEquals(850.0, sau.getCurrentWeight(), 0.01,
                "Mở khoá không được ghi cân: cân là số của HX711, không phải của lệnh mở khoá.");
        assertEquals(Boolean.TRUE, sau.getIsDoorClosed(),
                "Mở khoá không được tự ghi 'cửa đã mở': chỉ cảm biến MC-38 mới biết cửa thật mở hay chưa.");
    }
}
