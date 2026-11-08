package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import com.ptit.smartlocker.service.MqttService;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verify;

/**
 * Test tầng MQTT — phần phức tạp nhất của backend (MqttService ~1037 dòng)
 * và trước đây KHÔNG có test nào.
 *
 * <p>Hai lỗi bảo mật thật đã từng lọt vào bản chạy được vì thiếu đúng những test
 * dưới đây:
 * <ul>
 *   <li>{@code QR_send} mở được tủ dù chưa có shipper xác thực</li>
 *   <li>{@code select_compartment} mở cửa và lấy ngăn do client chọn</li>
 * </ul>
 *
 * <p>Gọi vào {@code messageArrived} (cửa vào công khai duy nhất), đúng đường mà
 * bản tin MQTT thật đi qua. MQTT đã tắt trong {@code src/test/resources/application.properties}
 * nên không có lệnh nào phát xuống tủ phần cứng thật.
 */
@SpringBootTest
@Transactional
class MqttTopicRoutingTests {

    @Autowired private MqttService mqttService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private CommandLogRepository commandLogRepository;
    @Autowired private DeviceEventRepository deviceEventRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;

    /**
     * Spy trên {@link MqttService} để bắt được các lần gọi {@code publishRawMessage}.
     *
     * <p>Vì sao bắt buộc phải spy: trong test `mqtt.enabled=false` nên `mqttClient` là null,
     * {@code publishRawMessage} không làm gì cả — nếu không spy thì KHÔNG thể quan sát
     * payload {@code verified/order} mà chỉ kiểm được gián tiếp qua `command_logs`.
     */
    @MockitoSpyBean private MqttService mqttServiceSpy;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        assertNotNull(locker, "Seed data phải có LOCKER_HN_01 (chạy seed.sql hoặc LockerDataSeeder)");
    }

    /** Gửi một bản tin MQTT giả vào đúng đường xử lý thật. */
    private void publish(String topic, String payload) {
        mqttService.messageArrived(topic, new MqttMessage(payload.getBytes(StandardCharsets.UTF_8)));
    }

    private Order taoDonPending(String orderId, Integer compartmentIndex) {
        Compartment comp = null;
        if (compartmentIndex != null) {
            comp = compartmentRepository
                    .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compartmentIndex)
                    .orElse(null);
        }
        Order order = Order.builder()
                .orderId(orderId)
                .customerName("Khách Test")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test")
                .build();
        return orderRepository.save(order);
    }

    private long demCommandLog() {
        return commandLogRepository.count();
    }

    private long demDeviceEvent() {
        return deviceEventRepository.count();
    }

    /**
     * Dựng một đơn ĐỦ ĐIỀU KIỆN NẠP — chính là tổ hợp mà test cũ bỏ sót.
     *
     * <p>Đủ 4 điều kiện để {@code handleOrderScan} đi tới nhánh mở tủ:
     * {@code status=PENDING}, {@code compartment != null}, {@code shipper_reserved_at != null},
     * {@code orders.locker_id} = tủ nhận bản tin. Thiếu {@code shipperReservedAt} thì hàm
     * {@code return} sớm ở {@code ready.isEmpty()} và khối {@code hasActiveShipperVerification}
     * KHÔNG BAO GIỜ chạy — đó đúng là lý do test cũ vô nghĩa.
     */
    private Order taoDonDaDatTruoc(String orderId, String trackingCode, int compartmentIndex) {
        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compartmentIndex)
                .orElseThrow();
        comp.setStatus("RESERVED");
        compartmentRepository.save(comp);

        Order order = Order.builder()
                .orderId(orderId)
                .customerName("Khách Test")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp)
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện test")
                .trackingCode(trackingCode)
                .shipperReservedAt(LocalDateTime.now().minusMinutes(1))
                .build();
        return orderRepository.save(order);
    }

    /** Tạo phiên shipper đã xác thực (60 giây) tại một tủ cụ thể. */
    private ShipperIdentityToken taoPhienShipper(String dynamicToken, String lockerId) {
        LocalDateTime now = LocalDateTime.now();
        ShipperIdentityToken token = ShipperIdentityToken.builder()
                .shipperId("shipper")
                .dynamicToken(dynamicToken)
                .createdAt(now)
                .expiredAt(now.plusMinutes(5))
                .isVerified(true)
                .lockerId(lockerId)
                .build();
        return tokenRepository.save(token);
    }

    /** Các payload đã được phát tới các topic kết thúc bằng {@code /verified/order}. */
    private List<String> cacPayloadVerifiedOrder() {
        ArgumentCaptor<String> topicCap = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> payloadCap = ArgumentCaptor.forClass(String.class);
        verify(mqttServiceSpy, atLeastOnce())
                .publishRawMessage(topicCap.capture(), payloadCap.capture(), anyInt());
        List<String> topics = topicCap.getAllValues();
        List<String> payloads = payloadCap.getAllValues();
        return java.util.stream.IntStream.range(0, Math.min(topics.size(), payloads.size()))
                .filter(i -> topics.get(i).endsWith("/verified/order"))
                .mapToObj(payloads::get)
                .collect(Collectors.toList());
    }

    // ─────────────────────────────────────────────────────────────
    // 1. PHÂN LOẠI TOPIC — sai một chữ là tủ không giao tiếp
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Topic lạ được ghi nhận là UNCLASSIFIED để truy vết, không im lặng bỏ qua")
    void topicLaDuocGhiNhanDeTruyVet() {
        // Hành vi có chủ đích: bản tin không khớp hợp đồng nào vẫn được ghi 1 dòng
        // HW_MQTT_UNCLASSIFIED. Không im lặng nuốt mất, vì khi tủ "không giao tiếp được"
        // thì đây chính là dấu vết duy nhất để biết firmware đang gửi topic gì.
        publish("ptit/khong_biet_day_la_gi/abc", "{}");

        boolean coUnclassified = deviceEventRepository.findAll().stream()
                .anyMatch(e -> "HW_MQTT_UNCLASSIFIED".equals(e.getEventType()));
        assertTrue(coUnclassified,
                "Topic không thuộc hợp đồng phải được ghi HW_MQTT_UNCLASSIFIED để debug");
    }

    @Test
    @DisplayName("Downlink do chính backend phát bị bỏ qua (chống echo, không tự xử lý lại)")
    void downlinkCuaChinhMinhBiBoQua() {
        long truoc = demDeviceEvent();
        // ptit/khuon_vien/verified/shipper là DOWNLINK (topic riêng từng tủ) → backend nghe lại phải bỏ qua
        publish("ptit/khuon_vien/verified/shipper", "1");
        assertEquals(truoc, demDeviceEvent(),
                "Nghe lại downlink của chính mình không được sinh event");
    }

    @Test
    @DisplayName("Heartbeat dạng JSON có locker_id: nhận đúng, cập nhật connection_status")
    void heartbeatJsonCoLockerId() {
        publish("ptit/status", "{\"locker_id\":\"khuon_vien\",\"status\":\"ONLINE\"}");
        Locker sau = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        assertEquals("ONLINE", sau.getConnectionStatus(),
                "Heartbeat JSON phải được map đúng tủ qua locker_id");
    }

    // ─────────────────────────────────────────────────────────────
    // 2. QR_SEND — LỖI BẢO MẬT THẬT ĐÃ TỪNG XẢY RA
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("QR_send khi CHƯA có shipper xác thực: KHÔNG được mở tủ")
    void qrSendKhongCoXacThucThiKhongMoTu() {
        taoDonPending("ORD-TEST-NOAUTH", 1);
        long cmdTruoc = demCommandLog();

        publish("ptit/QR_send", "ORD-TEST-NOAUTH");

        assertEquals(cmdTruoc, demCommandLog(),
                "Chưa quét QR shipper mà đã mở tủ là lỗ hổng bảo mật (đã từng xảy ra thật)");
    }

    @Test
    @DisplayName("QR_send với đơn không tồn tại: không mở tủ, không lỗi")
    void qrSendDonKhongTonTai() {
        long cmdTruoc = demCommandLog();
        publish("ptit/QR_send", "ORD-KHONG-CO-THAT");
        assertEquals(cmdTruoc, demCommandLog(), "Đơn không tồn tại không được phát lệnh mở");
    }

    // ─────────────────────────────────────────────────────────────
    // 3. SELECT_COMPARTMENT — LỖI BẢO MẬT THẬT ĐÃ TỪNG XẢY RA
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("select_compartment KHÔNG được phát lệnh mở tủ (tủ tự mở bằng phần cứng)")
    void selectCompartmentKhongPhatLenhMo() {
        Order don = taoDonPending("ORD-TEST-SELECT", null);
        long cmdTruoc = demCommandLog();

        // Kể cả khi có shipper đã xác thực, backend vẫn KHÔNG được ra lệnh mở:
        // theo MQTT_GUIDE.md dòng 103, firmware tự mở ngăn tại thao tác chọn.
        publish("ptit/locker/select_compartment",
                "{\"locker_id\":\"khuon_vien\",\"compartment\":0,\"qr\":\"ORD-TEST-SELECT\"}");

        assertEquals(cmdTruoc, demCommandLog(),
                "Backend không được phát lệnh mở cho select_compartment — đây là lỗi đã vá");
        Order sau = orderRepository.findById(don.getOrderId()).orElseThrow();
        assertNotNull(sau.getCompartment(), "Ngăn Kiosk chọn phải được ghi nhận vào đơn");
        assertEquals(1, sau.getCompartment().getCompIndex(),
                "compartment gửi lên là 0-based, DB lưu 1-based → phải là ngăn 1");
    }

    // ─────────────────────────────────────────────────────────────
    // 4. VERIFIED/ORDER — LÕI TÍNH NĂNG ĐẶT TRƯỚC (T3)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Quét mã đơn CHƯA đặt trước: không có chỗ nào để phát verified/order=1")
    void donChuaDatTruocKhongMoTu() {
        // Đơn có ngăn (do checkout gán) nhưng shipper_reserved_at = NULL
        taoDonPending("ORD-TEST-CHUADAT", 1);
        long cmdTruoc = demCommandLog();

        publish("ptit/qr/order", "{\"locker_id\":\"khuon_vien\",\"qr\":\"ORD-TEST-CHUADAT\"}");

        assertEquals(cmdTruoc, demCommandLog(),
                "Đơn chưa đặt trước (shipper_reserved_at NULL) không được tự mở tủ");
    }

    @Test
    @DisplayName("Quét mã đơn đã DEPOSITED: không mở lại")
    void donDaDepositedKhongMoLai() {
        Order don = taoDonPending("ORD-TEST-DA-GUI", 1);
        don.setStatus("DEPOSITED");
        orderRepository.save(don);
        long cmdTruoc = demCommandLog();

        publish("ptit/qr/order", "{\"locker_id\":\"khuon_vien\",\"qr\":\"ORD-TEST-DA-GUI\"}");

        assertEquals(cmdTruoc, demCommandLog(), "Đơn đã DEPOSITED không được mở tủ lần nữa");
    }

    // ─────────────────────────────────────────────────────────────
    // 4b. XÁC THỰC SHIPPER — nhánh THẬT SỰ chạy khi đơn đã đặt trước
    //
    // Bộ test cũ chỉ có `qrSendKhongCoXacThucThiKhongMoTu` với đơn KHÔNG có
    // `shipper_reserved_at`, nên `handleOrderScan` return sớm và khối
    // `hasActiveShipperVerification` chưa bao giờ được thực thi — xoá cả khối đó
    // mà test vẫn PASS. Ba test dưới đây khoá đúng nhánh đó, cả hai chiều.
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Đơn ĐÃ đặt trước nhưng CHƯA có phiên shipper: không mở tủ, phát verified/order=0")
    void donDaDatTruocKhongCoPhienShipperThiKhongMo() {
        taoDonDaDatTruoc("ORD-TEST-AUTH-NO", "TRACK-AUTH-NO", 1);
        // KHÔNG tạo ShipperIdentityToken nào → findActiveVerifiedTokensForLocker trả rỗng.
        long cmdTruoc = demCommandLog();
        clearInvocations(mqttServiceSpy);

        publish("ptit/qr/order", "{\"locker_id\":\"khuon_vien\",\"qr\":\"TRACK-AUTH-NO\"}");

        // (1) Không được phát lệnh mở: đây là assertion bắt được việc xoá khối xác thực,
        //     vì nếu khối bị xoá thì publishCommand chạy và command_logs +1.
        assertEquals(cmdTruoc, demCommandLog(),
                "Đơn đã đặt trước nhưng chưa có phiên shipper thì KHÔNG được mở tủ");

        // (2) Đơn phải giữ nguyên PENDING.
        Order sau = orderRepository.findById("ORD-TEST-AUTH-NO").orElseThrow();
        assertEquals("PENDING", sau.getStatus(), "Đơn không được đổi trạng thái");

        // (3) Phải phát THẬT verified/order = 0 (R3) — im lặng thì TFT treo chờ.
        List<String> payloads = cacPayloadVerifiedOrder();
        assertTrue(payloads.contains("0"),
                "Thiếu phiên shipper phải phát verified/order=0, thực tế: " + payloads);
        assertFalse(payloads.contains("1"),
                "Không được phát verified/order=1 khi chưa có phiên shipper, thực tế: " + payloads);
    }

    @Test
    @DisplayName("Đơn ĐÃ đặt trước + CÓ phiên shipper đúng tủ: mở đúng ngăn, phát verified/order=1")
    void donDaDatTruocCoPhienShipperThiMoDungNgan() {
        taoDonDaDatTruoc("ORD-TEST-AUTH-OK", "TRACK-AUTH-OK", 1);
        taoPhienShipper("SHIP-TEST-AUTH-OK", locker.getLockerId());
        long cmdTruoc = demCommandLog();
        clearInvocations(mqttServiceSpy);

        publish("ptit/qr/order", "{\"locker_id\":\"khuon_vien\",\"qr\":\"TRACK-AUTH-OK\"}");

        // Đối chứng dương: nếu ai đó chặn mọi trường hợp thì test A vẫn pass nhưng test này FAIL.
        assertEquals(cmdTruoc + 1, demCommandLog(),
                "Có phiên shipper hợp lệ thì phải phát đúng 1 lệnh mở");
        CommandLog cmd = commandLogRepository.findAll().stream()
                .filter(c -> c.getLocker() != null
                        && locker.getLockerId().equals(c.getLocker().getLockerId()))
                .reduce((a, b) -> b)
                .orElseThrow(() -> new AssertionError("Không thấy command_log của LOCKER_HN_01"));
        assertEquals("OPEN_DOOR", cmd.getCommandType(), "Lệnh phải là OPEN_DOOR");
        assertEquals(1, cmd.getCompartmentId(), "Phải mở đúng ngăn 1 của đơn");

        List<String> payloads = cacPayloadVerifiedOrder();
        assertTrue(payloads.contains("1"),
                "Có phiên shipper hợp lệ phải phát verified/order=1, thực tế: " + payloads);
    }

    @Test
    @DisplayName("Phiên shipper xác thực tại TỦ KHÁC: không mở (khoá lỗi cross-locker)")
    void phienShipperDangKyTaiTuKhacThiKhongMo() {
        taoDonDaDatTruoc("ORD-TEST-AUTH-KHAC-TU", "TRACK-AUTH-KHAC-TU", 1);
        // Phiên hợp lệ nhưng đăng ký tại LOCKER_HN_03, không phải tủ của đơn.
        taoPhienShipper("SHIP-TEST-AUTH-KHAC-TU", "LOCKER_HN_03");
        long cmdTruoc = demCommandLog();
        clearInvocations(mqttServiceSpy);

        publish("ptit/qr/order", "{\"locker_id\":\"khuon_vien\",\"qr\":\"TRACK-AUTH-KHAC-TU\"}");

        assertEquals(cmdTruoc, demCommandLog(),
                "Phiên xác thực ở tủ khác KHÔNG được mở tủ này");
        List<String> payloads = cacPayloadVerifiedOrder();
        assertFalse(payloads.contains("1"),
                "Không được phát verified/order=1 khi phiên thuộc tủ khác, thực tế: " + payloads);
    }

    // ─────────────────────────────────────────────────────────────
    // 5. HEARTBEAT DẠNG CHUỖI THUẦN (firmware hiện tại đang gửi kiểu này)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Heartbeat plaintext 'ONLINE' vẫn cập nhật nhịp tim (không được bỏ qua)")
    void heartbeatPlaintextVanCapNhatNhipTim() {
        // Firmware hiện tại publish ptit/khuon_vien/status với payload "ONLINE" (không JSON, không locker_id).
        // Nếu bỏ qua thì dashboard admin báo tủ offline sai.
        Locker truoc = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        truoc.setConnectionStatus("OFFLINE");
        truoc.setLastHeartbeat(null);
        lockerRepository.save(truoc);

        publish("ptit/khuon_vien/status", "ONLINE");

        Locker sau = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        assertEquals("ONLINE", sau.getConnectionStatus(),
                "Payload plaintext ONLINE phải được chấp nhận");
        assertNotNull(sau.getLastHeartbeat(),
                "Nhịp tim phải được cập nhật dù payload thiếu locker_id");
    }

    // ─────────────────────────────────────────────────────────────
    // 6. TRẠNG THÁI NGĂN — chỉ số 1-based
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("compartment/N/status: N trong topic là 1-based, khớp comp_index trong DB")
    void trangThaiNgan1Based() {
        publish("ptit/compartment/2/status",
                "{\"locker_id\":\"khuon_vien\",\"has_item\":1,\"door_closed\":0,\"weight\":120.5}");

        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), 2)
                .orElseThrow();
        assertEquals(120.5, comp.getCurrentWeight(), 0.01,
                "Cân nặng phải ghi vào ngăn 2 (N trong topic là 1-based)");
        assertFalse(comp.getIsDoorClosed(), "door_closed=0 phải ghi là cửa mở");
    }

    @Test
    @DisplayName("compartment/N/status không có locker_id: rơi về tủ mặc định nhưng vẫn ghi được")
    void trangThaiNganThieuLockerId() {
        // Firmware cũ chưa gửi locker_id — backend phải chấp nhận qua mqtt.locker.id.default
        publish("ptit/chung2004/compartment/1/status",
                "{\"has_item\":1,\"door_closed\":1,\"weight\":88.0}");

        Compartment comp = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), 1)
                .orElseThrow();
        assertEquals(88.0, comp.getCurrentWeight(), 0.01,
                "Payload thiếu locker_id phải được nhận qua cấu hình prefix chung2004");
    }
}
