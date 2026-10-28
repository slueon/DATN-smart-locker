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

    @Value("${mqtt.lwt.topic:ptit/backend/status}")
    private String lwtTopic;

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
        if (lwtEnabled && lwtTopic != null && !lwtTopic.isBlank()) {
            String lwtPayload = "{\"service\":\"smart-locker-backend\",\"status\":\"OFFLINE\",\"timestamp\":" + System.currentTimeMillis() + "}";
            options.setWill(lwtTopic, lwtPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8), 1, true); // QoS 1, Retained = true
            log.info("Đã đăng ký Last Will and Testament (LWT) tại topic: {}", lwtTopic);
        }

        return options;
    }

    @Bean
    public MqttClient mqttClient(MqttConnectOptions options) {
        if (!mqttEnabled) {
            log.info("MQTT đang tắt trong file cấu hình.");
            return null;
        }
        try {
            String effectiveClientId = clientId + "_" + UUID.randomUUID().toString().substring(0, 6);
            MqttClient client = new MqttClient(brokerUrl, effectiveClientId, new MemoryPersistence());
            log.info("Đang khởi tạo kết nối MQTT Broker: {} (ClientId: {})...", brokerUrl, effectiveClientId);
            client.connect(options);
            log.info("Kết nối MQTT Broker thành công tại: {}", brokerUrl);
            return client;
        } catch (Exception e) {
            log.warn("Chưa thể kết nối tức thời tới MQTT Broker {}: {}. Hệ thống vẫn vận hành bình thường.", brokerUrl, e.getMessage());
            return null;
        }
    }
}
