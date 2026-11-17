package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CommandLogRepository;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.DeviceEventRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.MqttService;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * GĐ50 — BACKEND TỰ NGHE LẠI BẢN TIN RETAINED CỦA CHÍNH MÌNH.
 *
 * <h2>Lỗi thật đang sửa</h2>
 * <p>{@code publishLockerRetainedState} phát trạng thái ngăn lấy từ DB lên
 * {@code {base}/compartment/N/status} — **chính topic uplink** mà {@code handleCompartmentStatus}
 * xử lý. Backend subscribe {@code {base}/#} nên nghe lại bản tin của mình như thể tủ gửi:
 * ghi đè {@code compartments} và {@code setLastHeartbeat(now)} + {@code ONLINE}.
 *
 * <p><b>Đo thật (17/11):</b> {@code device_events} 4088/4089 lúc 15:23:59 = đúng lúc restart
 * backend; tủ {@code Tu_1} đang TẮT mà web báo "trực tuyến". Cặp 4085/4086 lúc 14:00:28 (lúc một
 * lệnh mở được đo) đặt ngăn 1 thành {@code OCCUPIED/0}. Và {@code scripts/evidence/mk-overdue.sql}
 * ghi tay {@code current_weight=850} cho ngăn 2 ⇒ 850 g là số bịa, mỗi lần restart lại được
 * "xác nhận" lại từ vòng lặp này.
 *
 * <p><b>Vì sao {@code isOwnEcho} không chặn được:</b> nó chỉ so {@code topic|payload} trong
 * {@code ECHO_WINDOW_MS = 5000} ms và map {@code recentlyPublished} **rỗng sau restart**. Bản tin
 * retained do broker phát lại khi subscribe không có khoá nào trong map ⇒ lọt qua. Cùng lý do với
 * ca 14:00:28: bản tin được phát lúc T, broker giữ lại và đẩy về muộn hơn cửa sổ 5 giây.
 *
 * <h2>4 test khoá lại</h2>
 * <ul>
 *   <li>(a) retained {@code compartment/2/status} ⇒ weight VÀ last_heartbeat KHÔNG đổi.</li>
 *   <li>(b) cùng bản tin **không** retained ⇒ ghi weight + nhịp tim như cũ (đường thật không hỏng).</li>
 *   <li>(c) {@code publishCommand} KHÔNG phát gì lên {@code …/compartment/N/status}.</li>
 *   <li>(d) ngăn của đơn {@code OVERDUE} nhận {@code has_item:0} ⇒ giữ {@code OCCUPIED}, weight = 0.</li>
 * </ul>
 *
 * <p>MQTT tắt trong {@code src/test/resources/application.properties} nên {@code MqttClient} thật là
 * {@code null}; mock {@code @Primary} dưới đây là thứ duy nhất được inject — nhờ vậy
 * {@code publishRawMessage} thật sự chạy và ta bắt được topic.
 */
@SpringBootTest
@Transactional
class MqttRetainedEchoTests {

    @TestConfiguration
    static class MockMqttClientConfig {
        @Bean
        @Primary
        MqttClient mockMqttClientGd50() throws Exception {
            MqttClient client = mock(MqttClient.class);
            when(client.isConnected()).thenReturn(true);
            return client;
        }
    }

    @Autowired private MqttService mqttService;
    @Autowired private MqttClient mqttClient;   // mock ở trên
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private CommandLogRepository commandLogRepository;
    @Autowired private DeviceEventRepository deviceEventRepository;

    @MockitoSpyBean private MqttService mqttServiceSpy;

    private Locker locker;

    @BeforeEach
    void setUp() throws Exception {
        reset(mqttClient);
        when(mqttClient.isConnected()).thenReturn(true);
        clearInvocations(mqttServiceSpy);
        locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        assertNotNull(locker, "Seed data phải có LOCKER_HN_01");
    }

    /**
     * Gửi bản tin vào đúng cửa vào thật. {@code retained=true} mô phỏng bản tin broker phát lại
     * khi backend subscribe (đúng ca restart).
     */
    private void publish(String topic, String payload, boolean retained) {
        MqttMessage msg = new MqttMessage(payload.getBytes(StandardCharsets.UTF_8));
        msg.setRetained(retained);
        mqttService.messageArrived(topic, msg);
    }

    private Compartment ngan(int compIndex) {
        return compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex)
                .orElseThrow();
    }

    /** Đưa ngăn 2 về trạng thái "có hàng 850 g" giống fixture thật. */
    private void datNgan2CoHang850() {
        Compartment comp = ngan(2);
        comp.setStatus("OCCUPIED");
        comp.setCurrentWeight(850.0);
        comp.setIsDoorClosed(true);
        compartmentRepository.save(comp);
    }

    // ─────────────────────────────────────────────────────────────
    // (a) RETAINED KHÔNG ĐƯỢC GHI DB, KHÔNG ĐƯỢC LÀM TƯƠI NHỊP TIM
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ50 (a): retained compartment/2/status weight 850 → current_weight VÀ last_heartbeat KHÔNG đổi")
    void retainedKhongGhiCanVaKhongLamTuoiNhipTim() {
        datNgan2CoHang850();
        // Mốc nhịp tim CŨ, khác hẳn "bây giờ" — nếu bị ghi đè thì assert dưới sẽ bắt được.
        LocalDateTime mocCu = LocalDateTime.now().minusHours(3).withNano(0);
        locker.setLastHeartbeat(mocCu);
        locker.setConnectionStatus("OFFLINE");
        lockerRepository.save(locker);

        long eventTruoc = deviceEventRepository.count();

        // Đúng payload mà backend tự phát trong `publishLockerRetainedState`.
        publish("ptit/compartment/2/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":1,\"door_closed\":1,\"weight\":120.5}", true);

        Compartment sau = ngan(2);
        assertEquals(850.0, sau.getCurrentWeight(), 0.01,
                "Bản tin RETAINED không được ghi current_weight: đây là bản tin backend tự phát lại "
                        + "từ DB, không phải cảm biến đọc. Ghi vào là tự xác nhận số cũ vĩnh viễn.");

        Locker lockerSau = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        assertEquals(mocCu, lockerSau.getLastHeartbeat(),
                "Bản tin RETAINED không được làm tươi last_heartbeat: tủ đang TẮT mà retained cũ làm "
                        + "web báo 'trực tuyến' sau mỗi lần restart (đúng lỗi device_events 4088/4089 lúc 15:23:59).");
        assertEquals("OFFLINE", lockerSau.getConnectionStatus(),
                "Bản tin RETAINED không được đổi connection_status sang ONLINE.");

        // Vẫn phải có vết để truy vết — chỉ là không đổi dữ liệu nghiệp vụ.
        assertTrue(deviceEventRepository.count() > eventTruoc,
                "Bản tin retained vẫn phải được ghi device_events để truy vết.");
    }

    // ─────────────────────────────────────────────────────────────
    // (e) PAYLOAD RỖNG = LỆNH XOÁ RETAINED, KHÔNG ĐƯỢC LÀM TƯƠI NHỊP TIM
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ50 (e): payload RỖNG trên compartment/N/status (lệnh xoá retained) → không đụng DB, không làm tươi nhịp tim")
    void payloadRongXoaRetainedKhongLamTuoiNhipTim() {
        datNgan2CoHang850();
        LocalDateTime mocCu = LocalDateTime.now().minusHours(3).withNano(0);
        locker.setLastHeartbeat(mocCu);
        locker.setConnectionStatus("OFFLINE");
        lockerRepository.save(locker);

        // Đúng thứ `clearLegacyRetainedCompartmentState()` phát ra: payload rỗng, retain=true.
        // KHÔNG retained (broker trả lại dạng "xoá") — ca này còn nguy hiểm hơn retained.
        publish("ptit/compartment/2/status", "", false);

        assertEquals(850.0, ngan(2).getCurrentWeight(), 0.01,
                "Payload rỗng là lệnh XOÁ retained, không mang dữ liệu cảm biến — không được ghi weight 0.");
        assertEquals("OCCUPIED", ngan(2).getStatus(),
                "Payload rỗng không được đổi trạng thái ngăn.");

        Locker lockerSau = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        assertEquals(mocCu, lockerSau.getLastHeartbeat(),
                "Payload rỗng KHÔNG được làm tươi nhịp tim — nếu không, chính lệnh dọn retained của GĐ50 "
                        + "lại tạo nhịp tim giả mỗi lần restart (đo thật 15:57:28).");
        assertEquals("OFFLINE", lockerSau.getConnectionStatus(),
                "Payload rỗng không được đổi connection_status.");
    }

    // ─────────────────────────────────────────────────────────────
    // (b) KHÔNG RETAINED = DỮ LIỆU SỐNG, PHẢI XỬ LÝ NHƯ CŨ
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ50 (b): cùng bản tin KHÔNG retained → ghi weight + nhịp tim như cũ")
    void khongRetainedVanGhiNhuCu() {
        datNgan2CoHang850();
        LocalDateTime mocCu = LocalDateTime.now().minusHours(3).withNano(0);
        locker.setLastHeartbeat(mocCu);
        locker.setConnectionStatus("OFFLINE");
        lockerRepository.save(locker);

        publish("ptit/compartment/2/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":1,\"door_closed\":1,\"weight\":120.5}", false);

        assertEquals(120.5, ngan(2).getCurrentWeight(), 0.01,
                "Bản tin KHÔNG retained là dữ liệu sống của tủ — phải ghi weight như trước GĐ50 "
                        + "(điều cấm #2: không được bỏ qua bản tin thật).");

        Locker lockerSau = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        assertNotEquals(mocCu, lockerSau.getLastHeartbeat(),
                "Bản tin sống phải cập nhật nhịp tim — đường thật không được hỏng.");
        assertTrue(lockerSau.getLastHeartbeat().isAfter(mocCu));
    }

    // ─────────────────────────────────────────────────────────────
    // (c) KHÔNG CÒN PUBLISH LÊN TOPIC UPLINK
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ50 (c): publishCommand KHÔNG phát bản tin nào lên …/compartment/N/status")
    void publishCommandKhongPhatLenTopicUplink() {
        long logTruoc = commandLogRepository.count();

        boolean ok = mqttService.publishCommand(locker.getLockerId(), 2, "OPEN_DOOR", "ADMIN_TEST", null);

        // Môi trường test: client là mock isConnected=true ⇒ publish "thành công" ở tầng service.
        assertTrue(commandLogRepository.count() > logTruoc,
                "Lệnh mở vẫn phải được ghi command_logs (không đổi hành vi GĐ9).");

        // Bắt MỌI topic đã phát (kể cả bản 4 tham số dùng cho retained).
        ArgumentCaptor<String> topicCap = ArgumentCaptor.forClass(String.class);
        verify(mqttServiceSpy, atLeastOnce())
                .publishRawMessage(topicCap.capture(), anyString(), anyInt(), any(Boolean.class));
        List<String> topicCoRetain = topicCap.getAllValues();

        ArgumentCaptor<String> topicCap3 = ArgumentCaptor.forClass(String.class);
        try {
            verify(mqttServiceSpy, atLeastOnce())
                    .publishRawMessage(topicCap3.capture(), anyString(), anyInt());
        } catch (AssertionError ignored) {
            // Không có lời gọi 3 tham số cũng không sao — chỉ cần kiểm 4 tham số ở trên.
        }
        List<String> tatCa = new java.util.ArrayList<>(topicCoRetain);
        tatCa.addAll(topicCap3.getAllValues());

        List<String> viPham = tatCa.stream()
                .filter(t -> t != null && t.matches(".*/compartment/\\d+/status$"))
                .collect(Collectors.toList());

        assertTrue(viPham.isEmpty(),
                "publishCommand KHÔNG được phát lên topic uplink …/compartment/N/status — đó là "
                        + "nguyên nhân gốc của vòng lặp tự nghe. Vi phạm: " + viPham
                        + " (tất cả topic: " + tatCa + ")");

        // Nhưng vẫn PHẢI có lệnh mở thật (điều cấm #3: `locker/open` giữ nguyên).
        assertTrue(tatCa.stream().anyMatch(t -> t != null && t.endsWith("/locker/open")),
                "Lệnh mở thật vẫn phải được phát tới tủ. Topic đã phát: " + tatCa);
        assertTrue(ok, "publishCommand phải trả true khi client đang kết nối.");
    }

    // ─────────────────────────────────────────────────────────────
    // (d) NGĂN CỦA ĐƠN OVERDUE PHẢI ĐƯỢC GIỮ
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ50 (d): ngăn của đơn OVERDUE nhận has_item:0 → giữ OCCUPIED, weight = 0")
    void nganCuaDonQuaHanKhongBiDatEmpty() {
        Compartment comp2 = ngan(2);
        comp2.setStatus("OCCUPIED");
        comp2.setCurrentWeight(850.0);
        comp2.setIsDoorClosed(true);
        compartmentRepository.save(comp2);

        Order donQuaHan = Order.builder()
                .orderId("ORD-GD50-OVERDUE")
                .customerName("Khách Test GĐ50")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(comp2)
                .expectedDate(LocalDate.now().minusDays(3))
                .status("OVERDUE")
                .totalAmount(BigDecimal.valueOf(50000))
                .productName("Kiện quá hạn test")
                .build();
        orderRepository.save(donQuaHan);

        publish("ptit/compartment/2/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":0,\"door_closed\":1,\"weight\":0}", false);

        Compartment sau = ngan(2);
        assertEquals("OCCUPIED", sau.getStatus(),
                "Ngăn đang giữ đơn OVERDUE KHÔNG được đặt EMPTY theo has_item:0 — nếu đặt, ngăn bị cấp "
                        + "cho đơn khác trong khi ORD-OVERDUE01 vẫn trỏ vào (lỗi 'hai đơn một ngăn').");
        assertEquals(0.0, sau.getCurrentWeight(), 0.01,
                "weight vẫn phải ghi số thật từ cảm biến (0 g) — chỉ trạng thái là được bảo vệ.");

        Order donSau = orderRepository.findById("ORD-GD50-OVERDUE").orElseThrow();
        assertEquals("OVERDUE", donSau.getStatus(),
                "Đơn quá hạn không được đổi trạng thái bởi bản tin cảm biến.");
    }
}
