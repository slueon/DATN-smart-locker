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

    /**
     * GĐ7 — lịch sử mở tủ, mới nhất trước.
     *
     * <p><b>Vì sao cần endpoint này:</b> bảng {@code command_logs} đã ghi mọi lệnh mở tủ từ đầu
     * dự án nhưng chưa có cách nào xem lại. Khi hội đồng hỏi "làm sao biết tủ đã mở lúc nào, do
     * ai", câu trả lời phải là một bảng trên web chứ không phải câu SQL gõ tay.
     *
     * <p><b>Trần {@code limit}:</b> chặn ở 200 dòng dù client xin bao nhiêu. Bảng này tăng mãi
     * theo thời gian chạy; cho phép {@code limit=1000000} là tự tạo đường DoS bằng một request.
     *
     * @param lockerId bỏ trống = mọi tủ
     * @param limit    số dòng tối đa (mặc định 50, tối đa 200)
     */
    @GetMapping("/command-logs")
    public ResponseEntity<ApiResponse<java.util.List<com.ptit.smartlocker.dto.CommandLogDTO>>> getCommandLogs(
            @RequestParam(required = false) String lockerId,
            @RequestParam(required = false, defaultValue = "50") Integer limit) {
        java.util.List<com.ptit.smartlocker.dto.CommandLogDTO> logs =
                mqttService.getCommandHistory(lockerId, limit);
        return ResponseEntity.ok(ApiResponse.ok(
                "Lấy lịch sử mở tủ thành công (" + logs.size() + " bản ghi)", logs));
    }
}
