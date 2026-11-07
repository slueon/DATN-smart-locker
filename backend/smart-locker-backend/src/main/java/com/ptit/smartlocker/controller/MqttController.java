package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.service.MqttService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/mqtt")
public class MqttController {

    private final MqttService mqttService;

    @Autowired
    public MqttController(MqttService mqttService) {
        this.mqttService = mqttService;
    }

    /**
     * Lấy nhật ký lệnh mở khóa và sự kiện cảm biến từ trạm Kiosk
     */
    @GetMapping("/recent-logs")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getRecentLogs() {
        return ResponseEntity.ok(ApiResponse.ok("Lấy nhật ký MQTT thành công", mqttService.getRecentLogs()));
    }

    /**
     * Bắn lệnh MQTT điều khiển Solenoid thủ công từ Web UI hoặc Postman
     */
    @PostMapping("/command")
    public ResponseEntity<ApiResponse<Boolean>> publishManualCommand(@RequestBody Map<String, Object> req) {
        String lockerId = (String) req.getOrDefault("lockerId", "LOCKER_HN_01");
        int compIndex = req.containsKey("compIndex") ? Integer.parseInt(req.get("compIndex").toString()) : 1;
        String action = (String) req.getOrDefault("action", "OPEN_DOOR");
        String triggeredBy = (String) req.getOrDefault("triggeredBy", "API_MANUAL");
        String orderId = (String) req.get("orderId");

        boolean success = mqttService.publishCommand(lockerId, compIndex, action, triggeredBy, orderId);
        return ResponseEntity.ok(ApiResponse.ok("Đã phát lệnh MQTT thành công!", success));
    }

    /**
     * Nâng cấp 1 & 2: Truy vấn trạng thái an ninh MQTT (TLS, Auth, ACL, LWT, Retain)
     */
    @GetMapping("/security-status")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getSecurityStatus() {
        return ResponseEntity.ok(ApiResponse.ok("Lấy trạng thái bảo mật MQTT thành công", mqttService.getSecurityStatus()));
    }

    /**
     * Nâng cấp 4: Phát thủ công bản tin Trạng thái Giữ Chậm (Retained State Snapshot) cho trạm tủ
     */
    @PostMapping("/retained-state/{lockerId}")
    public ResponseEntity<ApiResponse<Boolean>> publishRetainedState(@PathVariable String lockerId) {
        boolean ok = mqttService.publishLockerRetainedState(lockerId);
        return ResponseEntity.ok(ApiResponse.ok("Đã phát bản tin Retained State thành công cho tủ " + lockerId, ok));
    }
}
