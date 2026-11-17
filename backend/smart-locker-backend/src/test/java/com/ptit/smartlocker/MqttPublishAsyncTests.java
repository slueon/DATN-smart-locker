package com.ptit.smartlocker;

import com.ptit.smartlocker.service.MqttService;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * GĐ45 — PUBLISH MQTT KHÔNG ĐƯỢC CHẶN LUỒNG NGHIỆP VỤ.
 *
 * <p><b>Vấn đề đo được:</b> `publishRawMessage` gọi `mqttClient.publish(...)` **đồng bộ** tới
 * `ssl://broker.emqx.io:8883`. Mỗi lần publish mất **1,5–3,2 giây** (bắt tay TLS + round-trip
 * broker công cộng), và lời gọi đó nằm **bên trong `@Transactional`** của `depositPackage` /
 * `recallOverduePackage` / … ⇒ mọi endpoint nghiệp vụ chậm theo:
 * `POST /api/shipper/deposit` = 2090–2334 ms, trong khi `GET /kiosk-events` chỉ 3–23 ms.
 *
 * <p><b>Cách sửa (hướng A user chốt):</b> đẩy **đúng** lời gọi `mqttClient.publish` sang một
 * executor **1 luồng**. 1 luồng là bắt buộc để giữ thứ tự `verified/order` trước `locker/open`.
 *
 * <p><b>Ba test dưới đây khoá:</b> (1) không chặn, (2) không mất và đúng thứ tự, (3) đường đồng bộ
 * khi mất kết nối giữ nguyên hành vi cũ.
 */
@SpringBootTest
class MqttPublishAsyncTests {

    /**
     * Client giả: `isConnected() = true`, `publish` ghi lại topic + payload.
     *
     * <p>Dùng `@Primary` để thay `MqttClient` thật trong context test. Test properties đã có
     * `mqtt.enabled=false` nên `MqttClient` thật là `null`; mock này là thứ duy nhất được inject.
     */
    @TestConfiguration
    static class MockMqttClientConfig {
        @Bean
        @Primary
        MqttClient mockMqttClient() throws Exception {
            MqttClient client = mock(MqttClient.class);
            when(client.isConnected()).thenReturn(true);
            return client;
        }
    }

    @Autowired private MqttService mqttService;
    @Autowired private MqttClient mqttClient;   // chính là mock ở trên

    /**
     * Mock là bean dùng chung giữa các test ⇒ phải xoá lịch sử invocation trước mỗi test, và xoá
     * `recentlyPublished` của service (nếu không, test #2 để lại 20 bản tin nên test #3 thấy
     * invocation cũ và `verify(never())` báo sai — đây đúng là lỗi tôi gặp ở lần chạy đầu).
     */
    @org.junit.jupiter.api.BeforeEach
    void setUp() throws Exception {
        // Xoá lịch sử + stub của test trước, rồi đặt lại mặc định "đang kết nối".
        reset(mqttClient);
        when(mqttClient.isConnected()).thenReturn(true);
    }

    @Test
    @DisplayName("GĐ45 (1): publishRawMessage KHÔNG được chặn — client giả sleep 300ms, phải trả về < 50ms")
    void khongChanLuongNghiepVu() throws Exception {
        // client giả "chậm" 300 ms cho mỗi lần publish (mô phỏng broker TLS công cộng)
        doAnswer(inv -> {
            Thread.sleep(300);
            return null;
        }).when(mqttClient).publish(anyString(), any(MqttMessage.class));

        long t0 = System.nanoTime();
        mqttService.publishRawMessage("ptit/test/gd45", "{\"n\":1}", 1);
        long ms = (System.nanoTime() - t0) / 1_000_000;

        assertTrue(ms < 50,
                "publishRawMessage phải trả về NGAY (<50ms) chứ không chờ broker. "
                        + "Đo được: " + ms + " ms — nếu ~300ms thì publish vẫn đang ĐỒNG BỘ "
                        + "(đúng như trước GĐ45, gây 2,1s cho deposit).");
    }

    @Test
    @DisplayName("GĐ45 (2): 20 bản tin — client giả nhận ĐỦ 20, ĐÚNG THỨ TỰ #1..#20")
    void khongMatVaDungThuTu() throws Exception {
        List<String> nhan = java.util.Collections.synchronizedList(new ArrayList<>());
        doAnswer(inv -> {
            MqttMessage m = inv.getArgument(1);
            nhan.add(new String(m.getPayload(), java.nio.charset.StandardCharsets.UTF_8));
            return null;
        }).when(mqttClient).publish(anyString(), any(MqttMessage.class));

        for (int i = 1; i <= 20; i++) {
            mqttService.publishRawMessage("ptit/test/gd45", "{\"n\":" + i + "}", 1);
        }

        // chờ tối đa 5 giây
        long het = System.currentTimeMillis() + 5000;
        while (nhan.size() < 20 && System.currentTimeMillis() < het) {
            Thread.sleep(50);
        }

        assertEquals(20, nhan.size(),
                "Không được MẤT bản tin nào (executor 1 luồng + hàng đợi). Nhận được: " + nhan);
        for (int i = 0; i < 20; i++) {
            assertTrue(nhan.get(i).contains("\"n\":" + (i + 1)),
                    "Bản tin phải tới ĐÚNG THỨ TỰ (1 luồng). Vị trí " + i + " là: " + nhan.get(i)
                            + " — cả danh sách: " + nhan);
        }
    }

    @Test
    @DisplayName("GĐ45 (3): client MẤT kết nối → KHÔNG publish lần nào, KHÔNG ném lỗi (hành vi cũ)")
    void matKetNoiThiKhongPublishVaKhongNemLoi() throws Exception {
        when(mqttClient.isConnected()).thenReturn(false);

        assertDoesNotThrow(() -> mqttService.publishRawMessage("ptit/test/gd45", "{\"n\":99}", 1),
                "Mất kết nối là chuyện bình thường (tủ/broker rơi) — không được ném lỗi ra luồng nghiệp vụ");

        Thread.sleep(300); // đủ để nếu có task nào bị đẩy nhầm thì nó đã chạy
        verify(mqttClient, never()).publish(anyString(), any(MqttMessage.class));
    }
}
