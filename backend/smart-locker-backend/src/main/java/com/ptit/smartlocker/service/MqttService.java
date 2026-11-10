package com.ptit.smartlocker.service;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.paho.client.mqttv3.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * T2 — Tầng MQTT theo nguyên tắc topic đã chốt:
 *
 * <ul>
 *   <li><b>Uplink (thiết bị → backend): topic CHUNG, không chứa id.</b> Thiết bị nào gửi thì
 *       nói trong payload ({@code locker_id}). Nhiều tủ cùng gửi lên một topic.</li>
 *   <li><b>Downlink (backend → thiết bị): topic RIÊNG từng tủ, có {@code {dev}}.</b>
 *       Chỉ đúng tủ đó nhận được lệnh.</li>
 * </ul>
 *
 * <p><b>Vì sao nhận nhiều alias topic:</b> firmware thật đang chạy giữ tên phẳng kiểu cũ
 * ({@code QR_Shipper}, {@code QR_send}, {@code rec/phone}…) nhưng payload đã chuyển sang JSON,
 * trong khi guide lại vẽ topic có id. Backend nhận CẢ BA kiểu (phẳng cũ / mới có id / mới phẳng)
 * và parse CẢ JSON lẫn chuỗi thuần — đây là lớp tương thích, không phải làm ẩu.
 *
 * <p><b>Id thiết bị ≠ id tủ:</b> payload mang {@code khuon_vien}, CSDL dùng {@code LOCKER_HN_01}.
 * Ánh xạ bằng cấu hình ({@code mqtt.locker.id.map}), KHÔNG đổi schema. Mọi thứ ghi xuống
 * {@code device_events}/{@code command_logs} luôn là id tủ trong CSDL.
 */
@Slf4j
@Service
public class MqttService implements MqttCallbackExtended {

    /** Cửa sổ chống echo: bản tin ta vừa phát mà nghe lại trong khoảng này thì bỏ qua. */
    private static final long ECHO_WINDOW_MS = 5000L;

    private final MqttClient mqttClient;
    private final LockerRepository lockerRepository;
    private final CompartmentRepository compartmentRepository;
    private final OrderRepository orderRepository;
    private final CommandLogRepository commandLogRepository;
    private final DeviceEventRepository deviceEventRepository;
    private final ShipperService shipperService;
    private final PickupService pickupService;
    private final ObjectMapper objectMapper;

    @Value("${mqtt.retain.enabled:true}")
    private boolean retainEnabled;

    @Value("${mqtt.ssl.enabled:false}")
    private boolean sslEnabled;

    @Value("${mqtt.username:}")
    private String username;

    /** Gốc topic. Mặc định {@code ptit}; mọi topic trong lớp này đều dựng từ đây. */
    @Value("${mqtt.topic.base:ptit}")
    private String topicBase;

    /** Danh sách {@code dev:DBID} phân tách bằng dấu phẩy, ví dụ {@code khuon_vien:LOCKER_HN_01}. */
    @Value("${mqtt.locker.id.map:khuon_vien:LOCKER_HN_01}")
    private String lockerIdMapRaw;

    /** Tủ dùng khi payload lẫn topic đều không cho biết thiết bị nào. */
    @Value("${mqtt.locker.id.default:LOCKER_HN_01}")
    private String defaultLockerIdConfig;

    /** Phát song song topic phẳng kiểu cũ bên cạnh kiểu mới (cho firmware cũ trong demo). */
    @Value("${mqtt.downlink.legacy:true}")
    private boolean downlinkLegacy;

    /**
     * Id tủ dùng cho firmware cũ publish topic phẳng {@code chung2004/compartment/...} mà
     * payload KHÔNG có trường {@code locker_id}.
     *
     * <p>Firmware hiện tại gửi trạng thái ngăn mỗi ~5 giây theo topic
     * {@code {base}/chung2004/compartment/N/status}. Nếu để trống, mỗi bản tin rơi vào nhánh
     * {@code resolveLocker} không xác định được tủ → rơi về tủ mặc định VÀ ghi thêm một dòng
     * {@code HW_MQTT_UNMAPPED} (~17k dòng/ngày), đồng thời trạng thái ngăn thật KHÔNG vào CSDL.
     * Đặt giá trị này để hiểu "{@code chung2004}" là id thiết bị của tủ tương ứng.
     * Đặt rỗng để tắt tính năng và quay lại hành vi cũ.
     */
    @Value("${mqtt.locker.prefix.chung2004:LOCKER_HN_01}")
    private String chung2004LockerId;

    /** topic|payload → thời điểm phát, dùng để nhận ra bản tin của chính mình. */
    private final Map<String, Long> recentlyPublished = new ConcurrentHashMap<>();

    @Autowired
    public MqttService(
            @Autowired(required = false) MqttClient mqttClient,
            LockerRepository lockerRepository,
            CompartmentRepository compartmentRepository,
            OrderRepository orderRepository,
            CommandLogRepository commandLogRepository,
            DeviceEventRepository deviceEventRepository,
            ShipperService shipperService,
            PickupService pickupService,
            @Autowired(required = false) ObjectMapper objectMapper) {
        this.mqttClient = mqttClient;
        this.lockerRepository = lockerRepository;
        this.compartmentRepository = compartmentRepository;
        this.orderRepository = orderRepository;
        this.commandLogRepository = commandLogRepository;
        this.deviceEventRepository = deviceEventRepository;
        this.shipperService = shipperService;
        this.pickupService = pickupService;
        this.objectMapper = objectMapper != null ? objectMapper : new ObjectMapper();
    }

    @PostConstruct
    public void init() {
        if (mqttClient == null) {
            log.info("MqttClient chưa được cấu hình hoặc không khả dụng lúc khởi động.");
            return;
        }
        try {
            mqttClient.setCallback(this);
            if (mqttClient.isConnected()) {
                subscribeChannels();
            }
        } catch (Exception e) {
            log.error("Lỗi khi thiết lập MqttCallback: {}", e.getMessage(), e);
        }
    }

    // ─────────────────────────── topic & ánh xạ id ───────────────────────────

    /** Dựng topic từ gốc: {@code topic("qr","shipper")} → {@code ptit/qr/shipper}. */
    /**
     * GĐ10 — bản public của {@link #topic(String...)} cho các service khác (bảo trì ở
     * {@code LockerService}) cần dựng đúng topic theo {@code mqtt.topic.base} mà không phải
     * biết base là gì. Không mở rộng thêm hành vi, chỉ lộ đường dựng topic.
     */
    public String buildTopic(String... parts) {
        return topic(parts);
    }

    /**
     * GĐ10 — bản public của {@link #deviceIdOf(String)} để service khác đổi id tủ trong CSDL
     * ({@code LOCKER_HN_01}) sang id thiết bị dùng trong topic ({@code khuon_vien}).
     */
    public String resolveDeviceId(String dbLockerId) {
        return deviceIdOf(dbLockerId);
    }

    private String topic(String... parts) {
        StringBuilder sb = new StringBuilder(topicBase == null || topicBase.isBlank() ? "ptit" : topicBase.trim());
        for (String part : parts) {
            if (part != null && !part.isEmpty()) {
                sb.append('/').append(part);
            }
        }
        return sb.toString();
    }

    private String basePrefix() {
        return (topicBase == null || topicBase.isBlank() ? "ptit" : topicBase.trim()) + "/";
    }

    /** Bỏ phần gốc topic; trả null nếu bản tin không thuộc gốc của mình. */
    private String relativePath(String topic) {
        String prefix = basePrefix();
        if (topic == null || !topic.startsWith(prefix)) {
            return null;
        }
        return topic.substring(prefix.length());
    }

    /** Parse {@code mqtt.locker.id.map} một lần mỗi lần đọc (rẻ, số mục rất nhỏ). */
    private Map<String, String> deviceToDbMap() {
        Map<String, String> map = new LinkedHashMap<>();
        if (lockerIdMapRaw == null || lockerIdMapRaw.isBlank()) {
            return map;
        }
        for (String entry : lockerIdMapRaw.split(",")) {
            String item = entry.trim();
            if (item.isEmpty()) {
                continue;
            }
            int colon = item.indexOf(':');
            if (colon <= 0 || colon == item.length() - 1) {
                log.warn("Bỏ qua mục mqtt.locker.id.map không hợp lệ: {}", item);
                continue;
            }
            map.put(item.substring(0, colon).trim(), item.substring(colon + 1).trim());
        }
        return map;
    }

    /** Id tủ trong CSDL → id thiết bị dùng trong topic downlink. */
    private String deviceIdOf(String dbLockerId) {
        for (Map.Entry<String, String> e : deviceToDbMap().entrySet()) {
            if (e.getValue().equalsIgnoreCase(dbLockerId)) {
                return e.getKey();
            }
        }
        // Không có ánh xạ: dùng chính id tủ. Tủ đó không có thật nên không ai nhận —
        // đúng thực tế; muốn thiết bị thứ 2 chạy được chỉ cần thêm 1 dòng map.
        return dbLockerId;
    }

    private Set<String> knownDeviceIds() {
        return deviceToDbMap().keySet();
    }

    /**
     * Tìm tủ trong CSDL từ id thiết bị (hoặc từ id tủ nếu payload đã gửi id tủ).
     * Không tìm được → tủ mặc định + WARN + vết {@code HW_MQTT_UNMAPPED}.
     */
    private Locker resolveLocker(String deviceOrDbId, String sourcePath, String payload) {
        if (deviceOrDbId != null && !deviceOrDbId.isBlank()) {
            String key = deviceOrDbId.trim();
            String mapped = deviceToDbMap().get(key);
            if (mapped != null) {
                Optional<Locker> byMap = lockerRepository.findById(mapped);
                if (byMap.isPresent()) {
                    return byMap.get();
                }
                log.warn("mqtt.locker.id.map trỏ tới tủ không tồn tại trong CSDL: {} -> {}", key, mapped);
            }
            // Payload gửi thẳng id tủ (một số firmware làm vậy).
            Optional<Locker> direct = lockerRepository.findById(key);
            if (direct.isPresent()) {
                return direct.get();
            }
            log.warn("Không ánh xạ được locker_id='{}' từ topic [{}] — dùng tủ mặc định '{}' (payload: {})",
                    key, sourcePath, defaultLockerIdConfig, payload);
        } else {
            log.warn("Bản tin từ topic [{}] thiếu locker_id — dùng tủ mặc định '{}' (payload: {})",
                    sourcePath, defaultLockerIdConfig, payload);
        }

        Locker fallback = lockerRepository.findById(defaultLockerIdConfig)
                .or(() -> lockerRepository.findAll().stream().findFirst())
                .orElse(null);

        if (fallback != null) {
            saveEvent(fallback, "HW_MQTT_UNMAPPED",
                    "topic=" + sourcePath + " | payload=" + payload);
        }
        return fallback;
    }

    /** Id tủ mặc định dùng cho các luồng không chỉ rõ thiết bị. */
    private String defaultLockerId() {
        return lockerRepository.findById(defaultLockerIdConfig)
                .map(Locker::getLockerId)
                .orElseGet(() -> lockerRepository.findAll().stream()
                        .map(Locker::getLockerId)
                        .findFirst()
                        .orElse(defaultLockerIdConfig));
    }

    // ─────────────────────────── kết nối / đăng ký ───────────────────────────

    private void subscribeChannels() {
        try {
            String filter = topic("#");
            mqttClient.subscribe(filter, 1);
            log.info("✅ Đã subscribe toàn bộ không gian topic phần cứng nhúng: {}", filter);
            publishBackendOnlineStatus();
        } catch (MqttException e) {
            log.error("Không thể subscribe topic {}: {}", topic("#"), e.getMessage());
        }
    }

    @Override
    public void connectComplete(boolean reconnect, String serverURI) {
        log.info("Kết nối MQTT hoàn tất (reconnect={}) tới {}", reconnect, serverURI);
        subscribeChannels();
        publishBackendOnlineStatus();
    }

    @Override
    public void connectionLost(Throwable cause) {
        log.warn("Mất kết nối MQTT Broker: {}", cause != null ? cause.getMessage() : "Không rõ nguyên nhân");
    }

    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
        // Giao vận bản tin hoàn tất
    }

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        String payloadStr = new String(message.getPayload(), StandardCharsets.UTF_8);

        try {
            if (isOwnEcho(topic, payloadStr)) {
                return;
            }
            if (isDownlinkTopic(topic)) {
                // Downlink của chính mình: backend subscribe gốc topic nên sẽ nghe lại.
                log.debug("Bỏ qua downlink do chính backend phát: {}", topic);
                return;
            }
            if (relativePath(topic) == null) {
                return;
            }
            handleEmbeddedHardwareMessage(topic, payloadStr);
        } catch (Exception e) {
            log.error("Lỗi khi xử lý bản tin MQTT từ topic {}: {}", topic, e.getMessage(), e);
        }
    }

    /** Bản tin vừa do chính backend phát (cùng topic + cùng payload trong cửa sổ ngắn). */
    private boolean isOwnEcho(String topic, String payload) {
        Long at = recentlyPublished.get(echoKey(topic, payload));
        if (at == null) {
            return false;
        }
        if (System.currentTimeMillis() - at > ECHO_WINDOW_MS) {
            recentlyPublished.remove(echoKey(topic, payload));
            return false;
        }
        return true;
    }

    private String echoKey(String topic, String payload) {
        return topic + "|" + payload;
    }

    /**
     * Topic có phải downlink của chính mình không: {@code {base}/{dev}/verified|locker|maintenance/...}
     * với {@code {dev}} là thiết bị đã biết, hoặc {@code {base}/backend/status}.
     *
     * <p>Chỉ coi là downlink khi phần sau device id thuộc nhóm lệnh của backend — vì firmware
     * thật cũng publish {@code {base}/{dev}/status} (heartbeat) và bản tin đó PHẢI xử lý.
     */
    private boolean isDownlinkTopic(String topic) {
        if (topic == null) {
            return false;
        }
        if (topic.equalsIgnoreCase(topic("backend", "status"))) {
            return true;
        }
        String rel = relativePath(topic);
        if (rel == null) {
            return false;
        }
        String[] seg = rel.split("/");
        if (seg.length < 3) {
            return false;
        }
        if (!knownDeviceIds().contains(seg[0])) {
            return false;
        }
        String second = seg[1].toLowerCase(Locale.ROOT);
        return second.equals("verified") || second.equals("locker") || second.equals("maintenance");
    }

    // ─────────────────────────── payload: JSON hoặc thuần ───────────────────────────

    /** Payload đã parse: ưu tiên JSON, không phải JSON thì dùng chuỗi thuần. */
    private record Payload(String raw, JsonNode json, boolean isJson) {

        String text() {
            return raw == null ? "" : raw.trim();
        }

        String str(String field) {
            if (!isJson || json == null) {
                return null;
            }
            JsonNode node = json.get(field);
            if (node == null || node.isNull()) {
                return null;
            }
            String value = node.asString();
            return value == null || value.isBlank() ? null : value.trim();
        }

        boolean has(String field) {
            return isJson && json != null && json.has(field);
        }

        Integer intOrNull(String field) {
            JsonNode node = isJson && json != null ? json.get(field) : null;
            if (node == null || node.isNull()) {
                return null;
            }
            if (node.isNumber()) {
                return node.asInt();
            }
            try {
                return Integer.parseInt(node.asString().trim());
            } catch (Exception ignored) {
                return null;
            }
        }

        Double doubleOrNull(String field) {
            JsonNode node = isJson && json != null ? json.get(field) : null;
            if (node == null || node.isNull()) {
                return null;
            }
            if (node.isNumber()) {
                return node.asDouble();
            }
            try {
                return Double.parseDouble(node.asString().trim());
            } catch (Exception ignored) {
                return null;
            }
        }

        /** Nhận cả {@code true/false} lẫn {@code 1/0}. */
        Boolean boolOrNull(String field) {
            JsonNode node = isJson && json != null ? json.get(field) : null;
            if (node == null || node.isNull()) {
                return null;
            }
            if (node.isBoolean()) {
                return node.asBoolean();
            }
            if (node.isNumber()) {
                return node.asInt() != 0;
            }
            String v = node.asString();
            if (v == null) {
                return null;
            }
            String t = v.trim().toLowerCase(Locale.ROOT);
            if (t.equals("true") || t.equals("1")) return true;
            if (t.equals("false") || t.equals("0")) return false;
            return null;
        }
    }

    private Payload parsePayload(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
                JsonNode node = objectMapper.readTree(trimmed);
                if (node != null && node.isObject()) {
                    return new Payload(raw, node, true);
                }
            } catch (Exception e) {
                log.debug("Payload không parse được thành JSON, dùng chuỗi thuần: {}", e.getMessage());
            }
        }
        return new Payload(raw, null, false);
    }

    /**
     * Id thiết bị cho bản tin này: payload trước, rồi tới segment id trong topic, cuối cùng là null.
     */
    private String deviceIdFromTopicOrPayload(String relPath, Payload payload) {
        String fromPayload = payload.str("locker_id");
        if (fromPayload != null) {
            return fromPayload;
        }
        if (relPath != null) {
            String[] seg = relPath.split("/");
            // Firmware cũ: topic phẳng `chung2004/compartment/N/...` không có locker_id trong payload.
            // Nhận diện tiền tố cố định này là thiết bị của một tủ đã cấu hình, thay vì để
            // resolveLocker rơi về tủ mặc định + ghi một dòng HW_MQTT_UNMAPPED mỗi bản tin.
            if (seg.length >= 2
                    && chung2004LockerId != null
                    && !chung2004LockerId.isBlank()
                    && "chung2004".equalsIgnoreCase(seg[0])) {
                return chung2004LockerId.trim();
            }
            // Topic kiểu {dev}/... : segment đầu là id thiết bị nếu không phải từ khoá nghiệp vụ.
            if (seg.length >= 2 && !isBusinessKeyword(seg[0])) {
                return seg[0];
            }
        }
        return null;
    }

    private boolean isBusinessKeyword(String segment) {
        String s = segment.toLowerCase(Locale.ROOT);
        return s.equals("qr") || s.equals("receive") || s.equals("rec") || s.equals("locker")
                || s.equals("status") || s.equals("compartment") || s.equals("session")
                || s.equals("verified") || s.equals("maintenance") || s.equals("backend")
                || s.equals("qr_shipper") || s.equals("qr_shiper") || s.equals("qr_send")
                || s.equals("qr_rec") || s.equals("cancel");
    }

    // ─────────────────────────── phát xuống thiết bị ───────────────────────────

    /**
     * Phát lệnh mở khoá Solenoid xuống ĐÚNG tủ của đơn.
     * Kiểu mới: {@code {base}/{dev}/locker/open} payload {@code <idx 0-based>,<deposit|pickup>}.
     * Kiểu cũ (chỉ khi {@code mqtt.downlink.legacy=true}): {@code {base}/locker/open}.
     */
    public boolean publishCommand(String lockerId, int compIndex, String action, String triggeredBy, String orderId) {
        String commandId = "CMD-" + System.currentTimeMillis() + "-" + (int) (Math.random() * 900 + 100);

        try {
            Locker locker = lockerRepository.findById(lockerId).orElse(null);
            if (locker != null) {
                CommandLog cmdLog = CommandLog.builder()
                        .commandId(commandId)
                        .locker(locker)
                        .compartmentId(compIndex)
                        .commandType(action != null ? action : "OPEN_DOOR")
                        .sentAt(LocalDateTime.now())
                        .status("SENT")
                        // GĐ9 — TRƯỚC ĐÂY hai giá trị này chỉ dùng trong bộ nhớ để chọn mode
                        // `deposit|pickup` rồi bị vứt đi, nên nhật ký không biết ai đã mở tủ.
                        // Nay ghi thẳng xuống để tab "Lịch sử mở tủ" trả lời được câu đó.
                        // KHÔNG đổi chữ ký hàm: 8 chỗ gọi đã truyền đủ 2 tham số.
                        .triggeredBy(triggeredBy)
                        .orderId(orderId)
                        .build();
                commandLogRepository.save(cmdLog);
            }

            if (mqttClient == null || !mqttClient.isConnected()) {
                log.warn("MqttClient chưa kết nối tới Broker, lệnh {} chỉ lưu log CSDL", commandId);
                return false;
            }

            // CSDL 1-based → firmware 0-based.
            int espIdx = compIndex > 0 ? compIndex - 1 : compIndex;
            String upperTrigger = triggeredBy != null ? triggeredBy.toUpperCase(Locale.ROOT) : "";
            String espMode = upperTrigger.contains("DEPOSIT") ? "deposit" : "pickup";
            String rawCommand = espIdx + "," + espMode;

            String dev = deviceIdOf(lockerId);
            String downlink = topic(dev, "locker", "open");
            publishRawMessage(downlink, rawCommand, 1);
            log.info("📡 Phát lệnh mở khoá tới [{}]: {} (Tủ: {}, Ngăn: #{})", downlink, rawCommand, lockerId, compIndex);

            if (downlinkLegacy) {
                publishRawMessage(topic("locker", "open"), rawCommand, 1);
            }

            publishLockerRetainedState(lockerId);
            return true;
        } catch (Exception e) {
            log.error("Lỗi khi phát lệnh MQTT mở khóa tới tủ {}: {}", lockerId, e.getMessage(), e);
            return false;
        }
    }

    /** Phát {@code 1|0} xuống đúng thiết bị; kèm bản phẳng cũ nếu bật legacy. */
    private void publishVerified(String lockerId, String channel, String value) {
        String dev = deviceIdOf(lockerId);
        publishRawMessage(topic(dev, "verified", channel), value, 1);
        if (downlinkLegacy) {
            publishRawMessage(topic("verified", channel), value, 1);
        }
    }

    /**
     * Đồng bộ trạng thái Giữ Chậm (Retained) cho từng ngăn.
     * Topic theo hợp đồng uplink chung ({@code {base}/compartment/N/status}) vì đó là nơi
     * thiết bị và dashboard cùng đọc; payload mang {@code locker_id}.
     */
    public boolean publishLockerRetainedState(String lockerId) {
        if (mqttClient == null || !mqttClient.isConnected()) {
            return false;
        }
        try {
            String dev = deviceIdOf(lockerId);
            List<Compartment> compartments = compartmentRepository.findByLocker_LockerId(lockerId);
            for (Compartment c : compartments) {
                String topic = topic("compartment", String.valueOf(c.getCompIndex()), "status");
                Map<String, Object> statusMap = new LinkedHashMap<>();
                statusMap.put("locker_id", dev);
                statusMap.put("has_item", "OCCUPIED".equalsIgnoreCase(c.getStatus()) ? 1 : 0);
                statusMap.put("door_closed", Boolean.TRUE.equals(c.getIsDoorClosed()) ? 1 : 0);
                statusMap.put("weight", c.getCurrentWeight() != null ? c.getCurrentWeight() : 0.0);

                publishRawMessage(topic, objectMapper.writeValueAsString(statusMap), 1, retainEnabled);
            }
            log.info("Đã đồng bộ trạng thái Retained cho các ngăn của tủ {} (thiết bị: {})", lockerId, dev);
            return true;
        } catch (Exception e) {
            log.error("Lỗi khi phát retained status cho tủ {}: {}", lockerId, e.getMessage());
            return false;
        }
    }

    /** Bản tin Backend Online (retained) tại {@code {base}/backend/status}. */
    public void publishBackendOnlineStatus() {
        if (mqttClient == null || !mqttClient.isConnected()) {
            return;
        }
        try {
            String statusTopic = topic("backend", "status");
            Map<String, Object> statusPayload = new LinkedHashMap<>();
            statusPayload.put("service", "smart-locker-backend");
            statusPayload.put("status", "ONLINE");
            statusPayload.put("timestamp", System.currentTimeMillis());

            publishRawMessage(statusTopic, objectMapper.writeValueAsString(statusPayload), 1, true);
            log.info("Đã phát bản tin Backend Online (Retained=true) tới: {}", statusTopic);
        } catch (Exception e) {
            log.warn("Không thể phát trạng thái Backend Online: {}", e.getMessage());
        }
    }

    public Map<String, Object> getSecurityStatus() {
        Map<String, Object> sec = new LinkedHashMap<>();
        sec.put("tlsEnabled", sslEnabled);
        sec.put("tlsProtocol", sslEnabled ? "TLSv1.3" : "TCP_PLAIN (Port 1883)");
        sec.put("authConfigured", username != null && !username.isBlank());
        sec.put("authenticatedUser", (username != null && !username.isBlank()) ? username : "ANONYMOUS_TEST_CLUSTER");
        sec.put("lwtEnabled", true);
        sec.put("lwtTopic", topic("backend", "status"));
        sec.put("retainEnabled", retainEnabled);
        sec.put("topicBase", topicBase);
        sec.put("lockerIdMap", deviceToDbMap());
        sec.put("downlinkLegacy", downlinkLegacy);
        sec.put("brokerConnected", mqttClient != null && mqttClient.isConnected());
        return sec;
    }

    public Map<String, Object> getRecentLogs() {
        Map<String, Object> result = new HashMap<>();
        result.put("commands", commandLogRepository.findAll());
        result.put("events", deviceEventRepository.findAll());
        result.put("security", getSecurityStatus());
        return result;
    }

    /**
     * GĐ7 — lịch sử mở tủ, mới nhất trước, map sang DTO để không lộ entity.
     *
     * <p>Query dùng {@code LEFT JOIN FETCH c.locker} nên đọc {@code getLocker().getLockerId()}
     * không phát thêm SELECT (tránh N+1 — với 50 dòng thì đó là 50 query thừa mỗi lần mở tab).
     *
     * <p><b>Không lấy {@code commandLogRepository.findAll()} như {@link #getRecentLogs}:</b>
     * hàm đó kéo CẢ bảng và trả entity (kèm quan hệ LAZY) — đúng thứ đã gây
     * {@code LazyInitializationException} ở tầng MQTT trước đây. Ở đây cắt ngay ở DB bằng
     * {@code Pageable}, và trả DTO chỉ có trường UI cần.
     *
     * <p>{@code limit} bị chặn trong khoảng 1..200: bảng này tăng vô hạn theo thời gian chạy,
     * nên không cho client tự chọn số dòng tuỳ ý.
     */
    public List<com.ptit.smartlocker.dto.CommandLogDTO> getCommandHistory(String lockerId, Integer limit) {
        int safeLimit = 50;
        if (limit != null) {
            safeLimit = Math.max(1, Math.min(limit, 200));
        }
        String filter = (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId.trim()))
                ? null
                : lockerId.trim();

        List<CommandLog> logs = commandLogRepository
                .findRecentWithLocker(filter, org.springframework.data.domain.PageRequest.of(0, safeLimit));

        // GĐ9 — tra tên khách cho các lệnh có gắn đơn, bằng ĐÚNG MỘT query.
        //
        // Vì sao gom id rồi `findAllById` thay vì tra từng dòng: 20 dòng × 1 query = 20 query
        // cho một lần mở tab — đúng lỗi N+1 đã sửa nhiều lần trong dự án này. Gom lại còn 1.
        //
        // Chỉ lấy đơn của những `orderId` khác null và KHÔNG trùng (Set) để câu IN không phình.
        Set<String> orderIds = logs.stream()
                .map(CommandLog::getOrderId)
                .filter(id -> id != null && !id.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new));

        Map<String, Order> orderById = new HashMap<>();
        if (!orderIds.isEmpty()) {
            orderRepository.findAllById(orderIds).forEach(o -> orderById.put(o.getOrderId(), o));
        }

        return logs.stream()
                .map(c -> {
                    Order related = c.getOrderId() != null ? orderById.get(c.getOrderId()) : null;
                    return com.ptit.smartlocker.dto.CommandLogDTO.builder()
                            .commandId(c.getCommandId())
                            .lockerId(c.getLocker() != null ? c.getLocker().getLockerId() : null)
                            .compartmentId(c.getCompartmentId())
                            .commandType(c.getCommandType())
                            .status(c.getStatus())
                            .sentAt(c.getSentAt())
                            .ackReceivedAt(c.getAckReceivedAt())
                            .triggeredBy(c.getTriggeredBy())
                            .orderId(c.getOrderId())
                            // Đơn đã bị xoá → vẫn giữ `orderId`, chỉ thiếu tên/SĐT. Không bịa.
                            .customerName(related != null ? related.getCustomerName() : null)
                            .customerPhone(related != null ? related.getCustomerPhone() : null)
                            .build();
                })
                .toList();
    }

    public void publishRawMessage(String topic, String payload, int qos) {
        publishRawMessage(topic, payload, qos, false);
    }

    public void publishRawMessage(String topic, String payload, int qos, boolean retain) {
        try {
            if (mqttClient != null && mqttClient.isConnected()) {
                MqttMessage msg = new MqttMessage(payload.getBytes(StandardCharsets.UTF_8));
                msg.setQos(qos);
                msg.setRetained(retain);
                mqttClient.publish(topic, msg);
                // Ghi lại để nhận ra bản tin của chính mình khi broker đẩy ngược về.
                recentlyPublished.put(echoKey(topic, payload), System.currentTimeMillis());
                log.info("📡 [MQTT Hardware Bridge] Phát bản tin thành công tới [{}]: {}", topic, payload);
            }
        } catch (Exception e) {
            log.error("Lỗi khi phát bản tin raw MQTT tới [{}]: {}", topic, e.getMessage());
        }
    }

    // ─────────────────────────── xử lý bản tin vào ───────────────────────────

    private void saveEvent(Locker locker, String eventType, String payload) {
        if (locker == null) {
            log.warn("Không lưu được sự kiện {} vì chưa có tủ nào trong CSDL", eventType);
            return;
        }
        deviceEventRepository.save(DeviceEvent.builder()
                .locker(locker)
                .eventType(eventType)
                .eventPayload(payload)
                .build());
    }

    /** Có phiên shipper đã xác thực và còn hiệu lực TẠI ĐÚNG TỦ này hay không. */
    private boolean hasActiveShipperVerification(String lockerId) {
        try {
            return shipperService.hasAnyVerifiedShipperToken(lockerId, LocalDateTime.now());
        } catch (Exception e) {
            log.warn("Không kiểm được phiên shipper xác thực: {}", e.getMessage());
            return false;
        }
    }

    /**
     * Router chính. Nhận cả 3 kiểu tên topic (phẳng cũ / có id / phẳng mới) và cả 2 dạng payload.
     */
    private void handleEmbeddedHardwareMessage(String topic, String payloadStr) {
        String rel = relativePath(topic);
        if (rel == null) {
            return;
        }
        Payload payload = parsePayload(payloadStr);
        String[] seg = rel.split("/");
        String lower = rel.toLowerCase(Locale.ROOT);

        log.info("📥 [Embedded Hardware MQTT] Nhận từ topic [{}]: {}", topic, payloadStr);

        // 1. Heartbeat trạng thái tủ: {base}/status  (và {base}/{dev}/status)
        if (isStatusPath(seg)) {
            handleLockerStatus(topic, rel, payload, payloadStr);
            return;
        }

        // 2. Quét QR định danh shipper: QR_Shipper | qr/shipper | QR_Shiper (typo firmware)
        if (lower.endsWith("qr_shipper") || lower.endsWith("qr_shiper") || lower.endsWith("qr/shipper")) {
            handleShipperQr(topic, rel, payload, payloadStr);
            return;
        }

        // 3. Quét mã đơn để nạp hàng: QR_send | qr/order
        if (lower.endsWith("qr_send") || lower.endsWith("qr/order")) {
            handleOrderScan(topic, rel, payload, payloadStr);
            return;
        }

        // 4. Quét QR nhận hàng của khách: QR_rec | qr/receive
        if (lower.endsWith("qr_rec") || lower.endsWith("qr/receive")) {
            handleCustomerQr(topic, rel, payload, payloadStr);
            return;
        }

        // 5. Khách nhập số điện thoại: rec/phone | receive/phone | {dev}/receive/phone
        if (lower.endsWith("rec/phone") || lower.endsWith("receive/phone")) {
            handleCustomerPhone(topic, rel, payload, payloadStr);
            return;
        }

        // 6. Khách nhập OTP: rec/otp | receive/otp
        if (lower.endsWith("rec/otp") || lower.endsWith("receive/otp")) {
            handleCustomerOtp(topic, rel, payload, payloadStr);
            return;
        }

        // 7. Chọn ngăn (0-based ở payload): locker/select_compartment
        if (lower.endsWith("select_compartment")) {
            handleSelectCompartment(topic, rel, payload, payloadStr);
            return;
        }

        // 8. Cảm biến ngăn: .../compartment/N/status  — nhận theo CẤU TRÚC, không theo tên thiết bị
        if (seg.length >= 3 && "compartment".equalsIgnoreCase(seg[seg.length - 3])
                && "status".equalsIgnoreCase(seg[seg.length - 1])) {
            handleCompartmentStatus(topic, rel, payload, payloadStr);
            return;
        }

        // 9. Sự kiện ngăn: .../compartment/N/event
        if (seg.length >= 3 && "compartment".equalsIgnoreCase(seg[seg.length - 3])
                && "event".equalsIgnoreCase(seg[seg.length - 1])) {
            handleCompartmentEvent(topic, rel, payload, payloadStr);
            return;
        }

        // 10. Sự kiện UI/Kiosk: session/cancel, cancel, cancel_scan, scan_qr_req, scan_order_qr_req
        if (lower.contains("cancel") || lower.contains("scan_qr_req") || lower.contains("scan_order_qr_req")) {
            Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
            saveEvent(locker, "HW_MQTT_UI_EVENT", payloadStr);
            log.info("ℹ️ Nhận sự kiện tương tác màn hình Kiosk [{}]: {}", topic, payloadStr);
            return;
        }

        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        saveEvent(locker, "HW_MQTT_UNCLASSIFIED", payloadStr);
        log.debug("Bản tin nhúng chưa phân loại: {} -> {}", topic, payloadStr);
    }

    private boolean isStatusPath(String[] seg) {
        if (seg.length == 1 && "status".equalsIgnoreCase(seg[0])) {
            return true; // {base}/status — topic chung
        }
        return seg.length == 2 && "status".equalsIgnoreCase(seg[1]);
    }

    /** Heartbeat. JSON map theo {@code locker_id}; plaintext dùng tủ mặc định + WARN (KHÔNG bỏ qua). */
    private void handleLockerStatus(String topic, String rel, Payload payload, String payloadStr) {
        String deviceId = deviceIdFromTopicOrPayload(rel, payload);
        Locker locker = resolveLocker(deviceId, rel, payloadStr);
        if (locker == null) {
            return;
        }

        String state = payload.str("status");
        if (state == null) {
            // Không có JSON: dùng chính chuỗi thuần (firmware thật đang gửi "ONLINE").
            state = payload.text();
        }
        state = state == null ? "" : state.trim().toUpperCase(Locale.ROOT);
        String connectionStatus = "OFFLINE".equals(state) ? "OFFLINE" : "ONLINE";

        if (!payload.isJson()) {
            log.warn("Heartbeat dạng plaintext '{}' trên topic [{}] không mang locker_id — "
                    + "gán tủ mặc định '{}' (vẫn giữ nhịp tim để dashboard không báo offline sai)",
                    payload.text(), rel, locker.getLockerId());
        }

        locker.setLastHeartbeat(LocalDateTime.now());
        locker.setConnectionStatus(connectionStatus);
        lockerRepository.save(locker);
        saveEvent(locker, "HW_MQTT_STATUS", payloadStr);
    }

    private void handleShipperQr(String topic, String rel, Payload payload, String payloadStr) {
        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_QR_SHIPPER", payloadStr);

        String token = payload.str("qr");
        if (token == null) {
            token = payload.text(); // firmware cũ gửi token thuần
        }

        boolean verified;
        try {
            verified = shipperService.verifyDynamicToken(locker.getLockerId(), token);
        } catch (Exception ex) {
            // Không còn heuristic "dài >= 4 ký tự là hợp lệ": mọi lỗi đều là KHÔNG hợp lệ.
            verified = false;
            log.warn("Kiểm tra Shipper Token thất bại (không hợp lệ): {}", ex.getMessage());
        }
        publishVerified(locker.getLockerId(), "shipper", verified ? "1" : "0");
    }

    /**
     * Shipper quét mã vận đơn tại tủ (T3).
     *
     * <p><b>Tra cứu:</b> {@code tracking_code} trước, trượt thì {@code order_id} (tương thích
     * đơn cũ chưa có mã vận đơn).
     *
     * <p><b>R1 — {@code verified/order = 1} khi VÀ CHỈ KHI</b> tồn tại đơn đồng thời:
     * {@code status='PENDING'} + {@code compartment_id IS NOT NULL} + {@code orders.locker_id}
     * = tủ nhận bản tin. <b>KHÔNG</b> phụ thuộc {@code compartments.status='RESERVED'} — đơn đặt
     * cho ngày mai có {@code compartment_id=NULL} nên nếu bắt buộc RESERVED sẽ không bao giờ
     * đi qua được nhánh này.
     *
     * <p><b>R3:</b> {@code 0} phải PHÁT THẬT trên {@code {base}/{dev}/verified/order}, không được
     * im lặng — im lặng thì TFT treo chờ mãi.
     */
    private void handleOrderScan(String topic, String rel, Payload payload, String payloadStr) {
        Locker fromTopic = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        String lockerIdOfMessage = fromTopic != null ? fromTopic.getLockerId() : defaultLockerId();

        String qr = payload.str("qr");
        if (qr == null) {
            qr = payload.str("order_id");
        }
        if (qr == null) {
            qr = payload.text();
        }
        if (qr == null || qr.isBlank()) {
            log.warn("Bản tin quét mã đơn rỗng trên topic [{}]", rel);
            publishVerified(lockerIdOfMessage, "order", "0");
            return;
        }
        String scanned = qr.trim();

        // Tra mã vận đơn trước, trượt thì tra order_id.
        Optional<Order> optOrder = orderRepository.findByTrackingCode(scanned);
        if (optOrder.isEmpty()) {
            optOrder = orderRepository.findByIdWithCompartment(scanned);
        }

        Locker locker = fromTopic;
        if (optOrder.isPresent() && optOrder.get().getLocker() != null) {
            String orderLockerId = optOrder.get().getLocker().getLockerId();
            locker = lockerRepository.findById(orderLockerId).orElse(fromTopic);
        }
        if (locker != null) {
            saveEvent(locker, "HW_MQTT_QR_ORDER", payloadStr);
        }

        // R1 + Q4: đơn phải PENDING, CÓ ngăn, và ĐÃ ĐƯỢC SHIPPER ĐẶT TRƯỚC
        // (`shipper_reserved_at IS NOT NULL`). Đơn chỉ có ngăn do checkout gán
        // (`shipper_reserved_at = NULL`) phải trả 0 — nếu không, mọi đơn đều quét ra 1
        // và tính năng đặt trước mất hết ý nghĩa.
        Optional<Order> ready = optOrder.filter(o ->
                o.getLocker() != null
                        && lockerIdOfMessage.equalsIgnoreCase(o.getLocker().getLockerId())
                        && o.getCompartment() != null
                        && o.getShipperReservedAt() != null
                        && "PENDING".equalsIgnoreCase(o.getStatus()));

        if (ready.isEmpty()) {
            String reason;
            if (optOrder.isEmpty()) {
                reason = "không tìm thấy đơn với mã '" + scanned + "' (đã tra tracking_code và order_id)";
            } else {
                Order o = optOrder.get();
                if (!"PENDING".equalsIgnoreCase(o.getStatus())) {
                    reason = "đơn " + o.getOrderId() + " đang ở trạng thái " + o.getStatus();
                } else if (o.getCompartment() == null) {
                    reason = "đơn " + o.getOrderId() + " chưa được gán ngăn nào";
                } else if (o.getShipperReservedAt() == null) {
                    reason = "đơn " + o.getOrderId() + " CHƯA ĐƯỢC ĐẶT TRƯỚC"
                            + " (ngăn " + o.getCompartment().getCompIndex()
                            + " do hệ thống gán lúc checkout) — shipper cần đặt trước trên web"
                            + " hoặc chọn ngăn trên màn hình tủ";
                } else {
                    reason = "đơn " + o.getOrderId() + " thuộc tủ "
                            + (o.getLocker() != null ? o.getLocker().getLockerId() : "?")
                            + ", không phải tủ đang quét (" + lockerIdOfMessage + ")";
                }
            }
            log.warn("Quét mã đơn '{}' tại tủ {} → TỪ CHỐI: {}", scanned, lockerIdOfMessage, reason);
            // R3: phát 0 THẬT, không im lặng.
            publishVerified(lockerIdOfMessage, "order", "0");
            return;
        }

        Order order = ready.get();
        Compartment comp = order.getCompartment();
        String orderLockerId = order.getLocker().getLockerId();

        // Xác thực shipper vẫn bắt buộc trước khi mở cửa.
        if (!hasActiveShipperVerification(orderLockerId)) {
            log.warn("Đơn {} hợp lệ để nạp nhưng chưa có shipper xác thực còn hiệu lực tại tủ {}",
                    order.getOrderId(), orderLockerId);
            publishVerified(lockerIdOfMessage, "order", "0");
            return;
        }

        publishVerified(orderLockerId, "order", "1");
        publishCommand(orderLockerId, comp.getCompIndex(), "OPEN_DOOR", "SHIPPER_DEPOSIT", order.getOrderId());
        log.info("✅ Quét mã '{}' → đơn {} đã đặt trước ngăn {} tại tủ {} — phát verified/order=1 và mở ngăn",
                scanned, order.getOrderId(), comp.getCompIndex(), orderLockerId);
    }

    private void handleCustomerPhone(String topic, String rel, Payload payload, String payloadStr) {
        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_RECEIVE_PHONE", payloadStr);

        String phone = payload.str("phone");
        if (phone == null) {
            phone = payload.text();
        }
        if (phone == null || phone.isBlank()) {
            publishVerified(locker.getLockerId(), "customer", "-1");
            return;
        }

        List<Order> orders = orderRepository.findByCustomerPhone(phone.trim());
        if (orders == null || orders.isEmpty()) {
            publishVerified(locker.getLockerId(), "customer", "-1");
            return;
        }
        long ready = orders.stream().filter(o -> "DEPOSITED".equalsIgnoreCase(o.getStatus())).count();
        publishVerified(locker.getLockerId(), "customer", ready > 0 ? String.valueOf(ready) : "0");
    }

    private void handleCustomerOtp(String topic, String rel, Payload payload, String payloadStr) {
        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_RECEIVE_OTP", payloadStr);

        String otp = payload.str("otp");
        if (otp == null) {
            otp = payload.text();
        }
        try {
            PickupDTO.VerifyCredentialRequest req = PickupDTO.VerifyCredentialRequest.builder()
                    .lockerId(locker.getLockerId())
                    .authMethod("OTP")
                    .code(otp)
                    .build();
            PickupDTO.PickupResponse resp = pickupService.verifyAndPickup(req);
            if (resp.isSuccess() && resp.getCompartmentIndex() != null) {
                publishCommand(locker.getLockerId(), resp.getCompartmentIndex(), "OPEN_DOOR", "CUSTOMER_OTP", resp.getOrderId());
            } else {
                publishVerified(locker.getLockerId(), "qr_otp/failed", "-1");
            }
        } catch (Exception ex) {
            log.warn("Xác thực OTP từ Kiosk thất bại: {}", ex.getMessage());
            publishVerified(locker.getLockerId(), "qr_otp/failed", "-1");
        }
    }

    private void handleCustomerQr(String topic, String rel, Payload payload, String payloadStr) {
        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_QR_RECEIVE", payloadStr);

        String qr = payload.str("qr");
        if (qr == null) {
            qr = payload.text();
        }
        try {
            PickupDTO.VerifyCredentialRequest req = PickupDTO.VerifyCredentialRequest.builder()
                    .lockerId(locker.getLockerId())
                    .authMethod("QR")
                    .code(qr)
                    .build();
            PickupDTO.PickupResponse resp = pickupService.verifyAndPickup(req);
            if (resp.isSuccess() && resp.getCompartmentIndex() != null) {
                publishCommand(locker.getLockerId(), resp.getCompartmentIndex(), "OPEN_DOOR", "CUSTOMER_PICKUP", resp.getOrderId());
            } else {
                publishVerified(locker.getLockerId(), "qr_otp/failed", "-1");
            }
        } catch (Exception ex) {
            log.warn("Xác thực QR nhận hàng thất bại: {}", ex.getMessage());
            publishVerified(locker.getLockerId(), "qr_otp/failed", "-1");
        }
    }

    /**
     * Chọn ngăn từ Kiosk. {@code compartment} trong payload là 0-based → lưu 1-based.
     *
     * <p><b>Hàm này CHỈ GHI NHẬN, KHÔNG ra lệnh mở tủ.</b> Theo {@code MQTT_GUIDE.md} dòng 103
     * và firmware ({@code main.c:136,146} gọi {@code open_lock(compartment_idx)}): tủ TỰ mở ngăn
     * bằng phần cứng rồi mới publish {@code locker/select_compartment} kèm QR đơn để backend lưu.
     * Backend gửi thêm {@code locker/open} ở nhánh này là sai thiết kế ngay từ gốc — và còn là
     * đường mở tủ từ xa vì gói tin này không đòi phiên shipper đã xác thực.
     *
     * <p>Vì vậy lỗi bảo mật ở đây được xử lý bằng cách BỎ HẲN đường ra lệnh, không phải bằng cách
     * thêm kiểm tra quyền: không còn {@code publishCommand} thì không còn gì để mở tủ.
     */
    private void handleSelectCompartment(String topic, String rel, Payload payload, String payloadStr) {
        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_SELECT_COMPARTMENT", payloadStr);

        Integer zeroBased = payload.intOrNull("compartment");
        if (zeroBased == null) {
            log.warn("select_compartment thiếu trường 'compartment' (payload: {})", payloadStr);
            return;
        }
        int oneBased = zeroBased + 1;

        String qr = payload.str("qr");
        if (qr == null || qr.isBlank()) {
            log.info("Kiosk chọn ngăn {} (0-based {}) tại tủ {} — không kèm QR đơn, chỉ ghi nhận",
                    oneBased, zeroBased, locker.getLockerId());
            return;
        }

        Optional<Order> optOrder = orderRepository.findByIdWithCompartment(qr.trim());
        if (optOrder.isEmpty()) {
            log.warn("select_compartment nhận qr='{}' nhưng không tìm thấy đơn — chỉ ghi nhận", qr);
            return;
        }

        Order order = optOrder.get();
        String orderLockerId = (order.getLocker() != null && order.getLocker().getLockerId() != null)
                ? order.getLocker().getLockerId()
                : locker.getLockerId();

        // Ngăn đích phải tồn tại và thuộc ĐÚNG tủ của đơn, nếu không thì đơn sẽ trỏ sang tủ khác.
        Optional<Compartment> target = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(orderLockerId, oneBased);
        if (target.isEmpty()) {
            log.warn("select_compartment: ngăn {} không thuộc tủ {} của đơn {} — không cập nhật",
                    oneBased, orderLockerId, order.getOrderId());
            return;
        }

        // Chống ghi đè: đơn đã gắn ngăn khác thì giữ nguyên và cảnh báo.
        if (order.getCompartment() != null
                && order.getCompartment().getCompIndex() != null
                && !order.getCompartment().getCompIndex().equals(oneBased)) {
            log.warn("select_compartment: đơn {} đã gắn ngăn {} — TỪ CHỐI ghi đè sang ngăn {}",
                    order.getOrderId(), order.getCompartment().getCompIndex(), oneBased);
            return;
        }

        order.setCompartment(target.get());
        orderRepository.save(order);

        // KHÔNG publishCommand ở bất kỳ nhánh nào: tủ đã tự mở bằng phần cứng.
        log.info("Kiosk chọn ngăn {} tại tủ {} cho đơn {} — chỉ ghi nhận, không ra lệnh mở",
                oneBased, orderLockerId, order.getOrderId());
    }

    private void handleCompartmentStatus(String topic, String rel, Payload payload, String payloadStr) {
        String[] seg = rel.split("/");
        Integer index = parseCompartmentSegment(seg);
        if (index == null) {
            log.warn("Không đọc được chỉ số ngăn từ topic [{}]", rel);
            return;
        }

        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_COMPARTMENT_STATUS", payloadStr);

        // comp_index trong topic là 1-based (giữ nguyên như CSDL).
        int compIndex = index;
        compartmentRepository.findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex).ifPresent(comp -> {
            Double weight = payload.doubleOrNull("weight");
            if (weight != null) {
                comp.setCurrentWeight(weight);
            }
            Boolean doorClosed = payload.boolOrNull("door_closed");
            if (doorClosed != null) {
                comp.setIsDoorClosed(doorClosed);
            }
            Boolean hasItem = payload.boolOrNull("has_item");
            if (hasItem != null) {
                comp.setStatus(hasItem ? "OCCUPIED" : "EMPTY");
            }
            compartmentRepository.save(comp);
        });

        locker.setLastHeartbeat(LocalDateTime.now());
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);
    }

    private void handleCompartmentEvent(String topic, String rel, Payload payload, String payloadStr) {
        String[] seg = rel.split("/");
        Integer indexFromTopic = parseCompartmentSegment(seg);
        // Ưu tiên trường `compartment` trong payload nếu có (1-based theo hợp đồng event).
        Integer indexFromPayload = payload.intOrNull("compartment");
        Integer index = indexFromPayload != null ? indexFromPayload : indexFromTopic;
        if (index == null) {
            log.warn("Không đọc được chỉ số ngăn từ sự kiện [{}]", rel);
            return;
        }
        int compIndex = index;

        Locker locker = resolveLocker(deviceIdFromTopicOrPayload(rel, payload), rel, payloadStr);
        if (locker == null) {
            return;
        }
        saveEvent(locker, "HW_MQTT_COMPARTMENT_EVENT", payloadStr);

        String status = payload.str("status");
        if (status == null) {
            log.debug("Sự kiện ngăn thiếu trường 'status': {}", payloadStr);
            return;
        }

        if ("deposit_success".equalsIgnoreCase(status)) {
            compartmentRepository.findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex).ifPresent(comp -> {
                comp.setStatus("OCCUPIED");
                compartmentRepository.save(comp);

                List<Order> pendingOrders = orderRepository
                        .findByLockerAndStatusWithCompartment(locker.getLockerId(), "PENDING");
                for (Order ord : pendingOrders) {
                    if (ord.getCompartment() != null && ord.getCompartment().getCompIndex().equals(compIndex)) {
                        ord.setStatus("DEPOSITED");
                        ord.setDepositedAt(LocalDateTime.now());
                        ord.setExpiryDeadline(LocalDateTime.now().plusDays(2));
                        orderRepository.save(ord);
                        log.info("Đã chuyển đơn hàng {} sang trạng thái DEPOSITED", ord.getOrderId());
                        break;
                    }
                }
            });
        } else if ("pickup_success".equalsIgnoreCase(status)) {
            compartmentRepository.findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex).ifPresent(comp -> {
                comp.setStatus("EMPTY");
                comp.setCurrentWeight(0.0);
                compartmentRepository.save(comp);

                List<Order> depositedOrders = orderRepository
                        .findByLockerAndStatusWithCompartment(locker.getLockerId(), "DEPOSITED");
                for (Order ord : depositedOrders) {
                    if (ord.getCompartment() != null && ord.getCompartment().getCompIndex().equals(compIndex)) {
                        ord.setStatus("COMPLETED");
                        orderRepository.save(ord);
                        log.info("Đã chuyển đơn hàng {} sang trạng thái COMPLETED", ord.getOrderId());
                        break;
                    }
                }
            });
        }
    }

    /** Đọc N trong {@code .../compartment/N/...} (1-based). */
    private Integer parseCompartmentSegment(String[] seg) {
        for (int i = 0; i < seg.length - 1; i++) {
            if ("compartment".equalsIgnoreCase(seg[i])) {
                try {
                    return Integer.parseInt(seg[i + 1]);
                } catch (NumberFormatException ignored) {
                    return null;
                }
            }
        }
        return null;
    }
}
