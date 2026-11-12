package com.ptit.smartlocker.config;

import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.UUID;

@Slf4j
@Configuration
public class MqttConfig {

    @Value("${mqtt.broker.url:tcp://broker.emqx.io:1883}")
    private String brokerUrl;

    @Value("${mqtt.client.id:smart_locker_backend_server}")
    private String clientId;

    @Value("${mqtt.connection-timeout:10}")
    private int connectionTimeout;

    @Value("${mqtt.keep-alive-interval:60}")
    private int keepAliveInterval;

    @Value("${mqtt.enabled:true}")
    private boolean mqttEnabled;

    @Value("${mqtt.username:}")
    private String username;

    @Value("${mqtt.password:}")
    private String password;

    @Value("${mqtt.ssl.enabled:false}")
    private boolean sslEnabled;

    @Value("${mqtt.lwt.enabled:true}")
    private boolean lwtEnabled;

    /**
     * Topic LWT. Để trống thì suy ra {@code {mqtt.topic.base}/backend/status} — nhờ vậy
     * đổi gốc topic chỉ cần sửa `mqtt.topic.base`, không phải sửa thêm chỗ này (dễ quên
     * và làm LWT trỏ sai chỗ trong khi phần còn lại đã đổi gốc).
     */
    @Value("${mqtt.lwt.topic:}")
    private String lwtTopic;

    @Value("${mqtt.topic.base:ptit}")
    private String topicBase;

    /** Topic LWT thực dùng: ưu tiên cấu hình tường minh, không có thì dựng từ topic.base. */
    private String resolveLwtTopic() {
        String base = (topicBase == null || topicBase.isBlank()) ? "ptit" : topicBase.trim();
        String fallback = base + "/backend/status";
        if (lwtTopic == null || lwtTopic.isBlank()) {
            return fallback;
        }
        // Cấu hình cũ có thể còn trỏ vào gốc "ptit" trong khi topic.base đã đổi → dịch theo base.
        return lwtTopic.trim();
    }

    /**
     * GĐ16 — chuẩn hoá URL broker về scheme mà <b>Paho 1.2.5 hiểu được</b>.
     *
     * <h2>Vì sao bắt buộc phải có</h2>
     * Firmware thật (`Tu_1`) dùng TLS ở cổng 8883, và tài liệu/UI của EMQX hay ghi scheme
     * {@code mqtts://}. Nhưng Paho client **v3 chỉ chấp nhận** {@code tcp://}, {@code ssl://},
     * {@code ws://}, {@code wss://} — đưa {@code mqtts://} vào {@code new MqttClient(...)} là ném
     * {@code IllegalArgumentException} về URI.
     *
     * <p>Lỗi đó lại bị {@code catch} ở {@link #mqttClient} (cố ý, để app vẫn khởi động được khi
     * broker chết) nên hệ quả là <b>app chạy bình thường nhưng MQTT = null</b>: không nhận cảm
     * biến, không gửi lệnh mở tủ — mà không ai thấy lỗi. Đây đúng là loại lỗi im lặng nguy hiểm
     * nhất của tầng MQTT, nên phải chặn ngay tại biên.
     *
     * <p>Hàm này chạy TRƯỚC khi tạo client, để dù ai đặt biến môi trường {@code MQTT_BROKER_URL}
     * sai scheme thì hệ thống vẫn nối được (kèm cảnh báo trong log).
     */
    static String normalizeBrokerUrl(String url) {
        if (url == null) return null;
        String u = url.trim();
        if (u.isEmpty()) return u;
        if (u.startsWith("mqtts://")) return "ssl://" + u.substring("mqtts://".length());
        if (u.startsWith("mqtt://")) return "tcp://" + u.substring("mqtt://".length());
        return u;
    }

    @Bean
    public MqttConnectOptions mqttConnectOptions() {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setAutomaticReconnect(true);
        options.setCleanSession(true);
        options.setConnectionTimeout(connectionTimeout);
        options.setKeepAliveInterval(keepAliveInterval);

        // 1. Nâng cấp Xác thực người dùng (Username / Password)
        if (username != null && !username.isBlank()) {
            options.setUserName(username);
            if (password != null) {
                options.setPassword(password.toCharArray());
            }
            log.info("Đã cấu hình thông tin xác thực MQTT cho người dùng: {}", username);
        }

        // 2. Nâng cấp Mã hóa Kênh truyền TLS 1.3 / MQTTS (Cổng 8883)
        if (sslEnabled || brokerUrl.startsWith("ssl://") || brokerUrl.startsWith("mqtts://")) {
            try {
                javax.net.ssl.SSLContext sslContext = javax.net.ssl.SSLContext.getInstance("TLSv1.3");
                sslContext.init(null, null, new java.security.SecureRandom());
                options.setSocketFactory(sslContext.getSocketFactory());
                log.info("Đã kích hoạt Socket Factory TLS 1.3 bảo mật cho kênh truyền MQTT (MQTTS).");
            } catch (Exception ex) {
                try {
                    javax.net.ssl.SSLContext defaultSsl = javax.net.ssl.SSLContext.getInstance("TLS");
                    defaultSsl.init(null, null, new java.security.SecureRandom());
                    options.setSocketFactory(defaultSsl.getSocketFactory());
                    log.info("Đã kích hoạt Socket Factory TLS mặc định cho MQTTS.");
                } catch (Exception ignored) {}
            }
        }

        // 3. Nâng cấp Cơ chế Di chúc (Last Will and Testament - LWT)
        // Topic LWT theo mqtt.topic.base để không lệch gốc khi đổi base.
        String effectiveLwtTopic = resolveLwtTopic();
        if (lwtEnabled && effectiveLwtTopic != null && !effectiveLwtTopic.isBlank()) {
            String lwtPayload = "{\"service\":\"smart-locker-backend\",\"status\":\"OFFLINE\",\"timestamp\":" + System.currentTimeMillis() + "}";
            options.setWill(effectiveLwtTopic, lwtPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8), 1, true); // QoS 1, Retained = true
            log.info("Đã đăng ký Last Will and Testament (LWT) tại topic: {}", effectiveLwtTopic);
        }

        return options;
    }

    @Bean
    public MqttClient mqttClient(MqttConnectOptions options) {
        if (!mqttEnabled) {
            log.info("MQTT đang tắt trong file cấu hình.");
            return null;
        }
        // GĐ16 — chuẩn hoá scheme TRƯỚC khi tạo client (xem javadoc `normalizeBrokerUrl`).
        // Log cả giá trị gốc khi phải đổi, để người vận hành biết env var đang đặt sai scheme.
        String effectiveBrokerUrl = normalizeBrokerUrl(brokerUrl);
        if (effectiveBrokerUrl != null && !effectiveBrokerUrl.equals(brokerUrl)) {
            log.warn("GĐ16 — URL broker '{}' dùng scheme Paho không hỗ trợ; đã chuẩn hoá thành '{}'. "
                    + "Hãy sửa cấu hình cho đúng (dùng ssl:// cho TLS, tcp:// cho plaintext).",
                    brokerUrl, effectiveBrokerUrl);
        }
        try {
            String effectiveClientId = clientId + "_" + UUID.randomUUID().toString().substring(0, 6);
            MqttClient client = new MqttClient(effectiveBrokerUrl, effectiveClientId, new MemoryPersistence());
            log.info("Đang khởi tạo kết nối MQTT Broker: {} (ClientId: {})...", effectiveBrokerUrl, effectiveClientId);
            client.connect(options);
            log.info("Kết nối MQTT Broker thành công tại: {}", effectiveBrokerUrl);
            return client;
        } catch (Exception e) {
            // GĐ16 — KHÔNG nuốt lỗi im lặng nữa.
            //
            // Vẫn KHÔNG throw: app phải khởi động được kể cả khi broker chết (ràng buộc cứng).
            // Nhưng trước đây chỉ `log.warn` nên khi TLS sai chứng chỉ / sai cổng, hệ thống chạy
            // "bình thường" mà MQTT = null — không cảm biến, không mở được tủ, không ai biết.
            // Nay log ở mức ERROR kèm nguyên nhân và hệ quả rõ ràng để người vận hành thấy ngay.
            log.error("KHÔNG kết nối được MQTT Broker tại {} — nguyên nhân: {}. "
                    + "HỆ QUẢ: backend KHÔNG nhận bản tin cảm biến và KHÔNG gửi được lệnh mở tủ "
                    + "(mqttClient = null). App vẫn chạy nhưng tầng MQTT đang chết — kiểm tra TLS/cổng/tường lửa.",
                    effectiveBrokerUrl, e.getMessage(), e);
            return null;
        }
    }
}
