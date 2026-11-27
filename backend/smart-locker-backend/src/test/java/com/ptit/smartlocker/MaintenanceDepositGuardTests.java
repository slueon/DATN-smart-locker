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
import com.ptit.smartlocker.service.MqttService;
import com.ptit.smartlocker.service.ShipperService;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ28 — HAI LỖI USER BÁO (kèm ảnh) VỀ BẢO TRÌ TOÀN TỦ.
 *
 * <p>Lỗi 1: khoá bảo trì toàn tủ xong thì không có nút "Mở khoá toàn tủ" — nút vẫn hiện
 * "Bảo trì toàn tủ". Lỗi 2: sau khi khoá tủ, shipper vẫn nạp được hàng vào tủ đó.
 *
 * <p><b>Nguyên nhân gốc dùng chung cho cả hai (đo thật 15/11/2026):</b>
 * {@code MqttService.handleLockerStatus} gán {@code connectionStatus} = {@code ONLINE} cho MỌI
 * heartbeat không phải {@code OFFLINE}, nên trạng thái {@code MAINTENANCE} do admin đặt bị chính
 * thiết bị xoá sau vài chục giây (đo được: 21:41:19 → 21:41:33 đã về {@code ONLINE}).
 *
 * <p>Vì vậy test dưới đây kiểm đúng hai tầng:
 * <ol>
 *   <li>heartbeat KHÔNG được ghi đè {@code MAINTENANCE} (nếu tầng này sai thì mọi chốt khác vô nghĩa);</li>
 *   <li>{@code depositPackage} phải chặn tủ {@code MAINTENANCE} và ngăn {@code OUT_OF_SERVICE}.</li>
 * </ol>
 */
@SpringBootTest
@Transactional
class MaintenanceDepositGuardTests {

    private static final String LOCKER_ID = "LOCKER_HN_01";
    private static final String TOKEN = "TOKEN-GD28-TEST";

    @Autowired private MqttService mqttService;
    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;
    @org.springframework.beans.factory.annotation.Autowired private com.ptit.smartlocker.repository.UserRepository userRepositoryForAssign;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById(LOCKER_ID).orElse(null);
        assertNotNull(locker, "Seed data phải có LOCKER_HN_01");

        LocalDateTime now = LocalDateTime.now();
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper")
                .dynamicToken(TOKEN)
                .createdAt(now)
                .expiredAt(now.plusMinutes(5))
                .isVerified(true)
                .lockerId(LOCKER_ID)
                .build());
    }

    /** Gửi heartbeat vào đúng cửa vào công khai mà firmware thật dùng. */
    private void heartbeat(String topic, String payload) {
        mqttService.messageArrived(topic, new MqttMessage(payload.getBytes(StandardCharsets.UTF_8)));
    }

    /** Đơn PENDING đã gán đúng tủ + đúng ngăn (chưa đặt trước) để đi sâu vào depositPackage. */
    private Order taoDonPending(String orderId, int compIndex) {
        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(LOCKER_ID, compIndex)
                .orElseThrow(() -> new AssertionError("Seed data phải có ngăn #" + compIndex));
        comp.setStatus("EMPTY");
        compartmentRepository.save(comp);

        return orderRepository.save(Order.builder()
                .orderId(orderId)
                .customerName("Khách Test GĐ28")
                .assignedShipper(userRepositoryForAssign.findByUsername("shipper").orElseThrow()) // gộp ThanhChung: chỉ shipper được phân công mới nạp/thu hồi được
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test GĐ28")
                .build());
    }

    private ShipperDTO.DepositPackageRequest yeuCauNap(String orderId) {
        return ShipperDTO.DepositPackageRequest.builder()
                .lockerId(LOCKER_ID)
                .dynamicToken(TOKEN)
                .orderId(orderId)
                .weightGrams(0.8)
                .isDoorClosed(true)
                .build();
    }

    private void datLockerMaint() {
        locker.setConnectionStatus("MAINTENANCE");
        lockerRepository.save(locker);
    }

    // ─────────────────────────────────────────────────────────────
    // TẦNG 1 — HEARTBEAT KHÔNG ĐƯỢC XOÁ TRẠNG THÁI BẢO TRÌ
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("LỖI 1 (gốc): heartbeat ONLINE KHÔNG được ghi đè MAINTENANCE")
    void heartbeatKhongGhiDeMaintenance() {
        datLockerMaint();

        // Đúng payload firmware thật đang gửi tại hiện trường.
        heartbeat("ptit/status", "{\"locker_id\":\"Tu_1\",\"status\":\"ONLINE\"}");

        Locker sau = lockerRepository.findById(LOCKER_ID).orElseThrow();
        assertEquals("MAINTENANCE", sau.getConnectionStatus(),
                "Heartbeat không được xoá quyết định bảo trì của admin — nếu xoá thì nút "
                        + "'Mở khoá toàn tủ' biến mất và shipper lại nạp được hàng (đúng 2 lỗi user báo)");
        assertNotNull(sau.getLastHeartbeat(), "Nhịp tim vẫn phải được ghi để dashboard biết thiết bị còn sống");
    }

    @Test
    @DisplayName("Heartbeat plaintext 'ONLINE' (firmware cũ) cũng không được ghi đè MAINTENANCE")
    void heartbeatPlaintextKhongGhiDeMaintenance() {
        datLockerMaint();

        heartbeat("ptit/Tu_1/status", "ONLINE");

        assertEquals("MAINTENANCE", lockerRepository.findById(LOCKER_ID).orElseThrow().getConnectionStatus(),
                "Firmware cũ gửi plaintext 'ONLINE' liên tục — cũng không được xoá bảo trì");
    }

    @Test
    @DisplayName("Tủ KHÔNG bảo trì: heartbeat vẫn đổi ONLINE/OFFLINE bình thường (không regression)")
    void heartbeatBinhThuongVanHoatDong() {
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);

        heartbeat("ptit/status", "{\"locker_id\":\"Tu_1\",\"status\":\"OFFLINE\"}");
        assertEquals("OFFLINE", lockerRepository.findById(LOCKER_ID).orElseThrow().getConnectionStatus(),
                "Tủ thường vẫn phải nhận OFFLINE từ heartbeat");

        heartbeat("ptit/status", "{\"locker_id\":\"Tu_1\",\"status\":\"ONLINE\"}");
        assertEquals("ONLINE", lockerRepository.findById(LOCKER_ID).orElseThrow().getConnectionStatus(),
                "Tủ thường vẫn phải nhận ONLINE từ heartbeat");
    }

    @Test
    @DisplayName("Mở khoá bảo trì xong thì heartbeat lại điều khiển trạng thái được")
    void sauKhiMoKhoaHeartbeatLaiHoatDong() {
        datLockerMaint();
        locker.setConnectionStatus("ONLINE"); // = setLockerMaintenance(lock=false)
        lockerRepository.save(locker);

        heartbeat("ptit/status", "{\"locker_id\":\"Tu_1\",\"status\":\"OFFLINE\"}");

        assertEquals("OFFLINE", lockerRepository.findById(LOCKER_ID).orElseThrow().getConnectionStatus(),
                "Sau khi mở khoá, trạng thái phải do nhịp tim quyết định lại như trước GĐ28");
    }

    // ─────────────────────────────────────────────────────────────
    // TẦNG 2 — CHẶN NẠP HÀNG (LỖI 2)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("LỖI 2: tủ MAINTENANCE → deposit 409, đơn vẫn PENDING, ngăn vẫn EMPTY")
    void depositVaoTuBaoTriBiChan() {
        Order order = taoDonPending("ORD-GD28-MAINT", 1);
        Compartment truoc = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(LOCKER_ID, 1).orElseThrow();
        String statusNganTruoc = truoc.getStatus();
        datLockerMaint();

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD28-MAINT"), "shipper"),
                "Nạp được hàng vào tủ đang bảo trì nghĩa là hàng có thể mất — phải ném 409");

        assertTrue(ex.getMessage().toUpperCase().contains("BẢO TRÌ"),
                "Message phải nói rõ tủ đang bảo trì, hiện tại: " + ex.getMessage());

        assertEquals("PENDING", orderRepository.findById("ORD-GD28-MAINT").orElseThrow().getStatus(),
                "Đơn KHÔNG được đổi sang DEPOSITED khi bị chặn");
        assertEquals(statusNganTruoc,
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER_ID, 1).orElseThrow().getStatus(),
                "Ngăn KHÔNG được đổi sang OCCUPIED khi bị chặn");
    }

    @Test
    @DisplayName("LỖI 2: ngăn đã gán OUT_OF_SERVICE → deposit 409 (trước GĐ28 lọt)")
    void depositVaoNganBaoTriBiChan() {
        Order order = taoDonPending("ORD-GD28-COMP", 2);
        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(LOCKER_ID, 2).orElseThrow();
        comp.setStatus("OUT_OF_SERVICE");
        compartmentRepository.save(comp);
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD28-COMP"), "shipper"),
                "Ngăn đang bảo trì không được đặt hàng vào");

        assertTrue(ex.getMessage().toUpperCase().contains("BẢO TRÌ"),
                "Message phải nêu ngăn đang bảo trì, hiện tại: " + ex.getMessage());
        assertEquals("PENDING", orderRepository.findById("ORD-GD28-COMP").orElseThrow().getStatus(),
                "Đơn phải giữ PENDING");
        assertEquals("OUT_OF_SERVICE",
                compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER_ID, 2).orElseThrow().getStatus(),
                "Ngăn bảo trì KHÔNG được bị ghi đè thành OCCUPIED");
    }

    @Test
    @DisplayName("PHÉP THỬ 2: mở khoá bảo trì rồi thì nạp lại được (200)")
    void moKhoaRoiThiNapDuoc() {
        taoDonPending("ORD-GD28-OK", 1);
        datLockerMaint();
        assertThrows(BusinessException.class,
                () -> shipperService.depositPackage(yeuCauNap("ORD-GD28-OK"), "shipper"),
                "Đang bảo trì thì phải chặn trước đã");

        // Mở khoá = đúng việc setLockerMaintenance(lock=false) làm.
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);

        ShipperDTO.DepositResponse res = shipperService.depositPackage(yeuCauNap("ORD-GD28-OK"), "shipper");
        assertTrue(res.isSuccess(), "Mở khoá xong phải nạp được");
        assertEquals("DEPOSITED",
                orderRepository.findById("ORD-GD28-OK").orElseThrow().getStatus(),
                "Đơn phải chuyển DEPOSITED sau khi nạp thành công");
    }
}
