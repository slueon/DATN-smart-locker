package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.service.MqttService;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ22 — cảm biến HỒNG NGOẠI {@code ir_detected} của {@code compartment/N/status}.
 *
 * <p><b>Vấn đề thật:</b> kiện quá nhẹ thì loadcell đọc {@code weight = 0}; firmware thật đã gửi
 * {@code weight:0, ir_detected:1, has_item:1}. Nếu chỉ tin cân thì ngăn bị coi là trống.
 *
 * <p><b>Phạm vi đã làm (hướng B):</b> chỉ LƯU {@code ir_detected} để truy vết + log WARN ca kiện
 * nhẹ. KHÔNG đổi công thức {@code has_item} — firmware cũ ở hiện trường không gửi trường này, đổi
 * công thức sẽ làm hành vi của nó thay đổi ngoài ý muốn.
 */
@SpringBootTest
@Transactional
class IrDetectedCompartmentTests {

    @Autowired private MqttService mqttService;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private LockerRepository lockerRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElseThrow();
    }

    private void publish(String topic, String payload) {
        mqttService.messageArrived(topic, new MqttMessage(payload.getBytes(StandardCharsets.UTF_8)));
    }

    private Compartment layNgan(int compIndex) {
        return compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex)
                .orElseThrow();
    }

    private void datNgan(int compIndex, String status, Boolean ir, Double weight) {
        Compartment c = layNgan(compIndex);
        c.setStatus(status);
        c.setIrDetected(ir);
        c.setCurrentWeight(weight);
        compartmentRepository.save(c);
    }

    @Test
    @DisplayName("GĐ22 (1): ir_detected=1, weight=0, has_item=1 → OCCUPIED, lưu ir=1, cân vẫn 0")
    void kienNheIrBaoCoHang() {
        datNgan(1, "EMPTY", null, 0.0);

        publish("ptit/Tu_1/compartment/1/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":1,\"ir_detected\":1,\"door_closed\":1,\"weight\":0}");

        Compartment c = layNgan(1);
        assertEquals("OCCUPIED", c.getStatus(),
                "has_item=1 phải làm ngăn OCCUPIED — IR là bằng chứng có hàng dù cân 0");
        assertEquals(Boolean.TRUE, c.getIrDetected(), "Phải lưu cờ IR = 1");
        assertEquals(0.0, c.getCurrentWeight(), 0.0001,
                "CẤM ghi đè cân: 0 là số đo thật của loadcell, không phải 'không có hàng'");
    }

    @Test
    @DisplayName("GĐ22 (2): ir_detected=0, weight=0, has_item=0 → EMPTY, ir=0")
    void nganTrong() {
        datNgan(1, "OCCUPIED", null, 0.0);

        publish("ptit/Tu_1/compartment/1/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":0,\"ir_detected\":0,\"door_closed\":1,\"weight\":0}");

        Compartment c = layNgan(1);
        assertEquals("EMPTY", c.getStatus());
        assertEquals(Boolean.FALSE, c.getIrDetected());
    }

    @Test
    @DisplayName("GĐ22 (3): ir_detected=0 nhưng weight=120.5, has_item=1 → OCCUPIED (cân vẫn thắng)")
    void canVanThangIr() {
        datNgan(1, "EMPTY", null, 0.0);

        publish("ptit/Tu_1/compartment/1/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":1,\"ir_detected\":0,\"door_closed\":1,\"weight\":120.5}");

        Compartment c = layNgan(1);
        assertEquals("OCCUPIED", c.getStatus(), "Cân báo có hàng thì phải OCCUPIED dù IR = 0");
        assertEquals(120.5, c.getCurrentWeight(), 0.0001);
        assertEquals(Boolean.FALSE, c.getIrDetected());
    }

    @Test
    @DisplayName("GĐ22 (4): payload firmware CŨ (không có ir_detected) → OCCUPIED, KHÔNG xoá IR đã lưu")
    void firmwareCuKhongGhiDeIr() {
        // Đã từng nhận IR = 1 từ firmware mới; giờ firmware cũ gửi bản tin không có trường đó.
        datNgan(1, "EMPTY", Boolean.TRUE, 0.0);

        publish("ptit/Tu_1/compartment/1/status",
                "{\"locker_id\":\"Tu_1\",\"has_item\":1,\"door_closed\":1,\"weight\":88.0}");

        Compartment c = layNgan(1);
        assertEquals("OCCUPIED", c.getStatus(), "has_item=1 phải giữ nguyên hành vi cũ");
        assertEquals(88.0, c.getCurrentWeight(), 0.0001);
        assertEquals(Boolean.TRUE, c.getIrDetected(),
                "Payload KHÔNG có ir_detected thì KHÔNG được ghi đè — nếu ghi null/0 là biến cột "
                        + "truy vết thành rác");
    }

    @Test
    @DisplayName("GĐ22: ngăn chưa từng nhận IR thì ir_detected vẫn NULL (cột NULL-able)")
    void nganChuaTungCoIr() {
        Compartment c = layNgan(2);
        // Không publish gì — mô phỏng 20 ngăn có sẵn trước GĐ22.
        assertNull(c.getIrDetected(),
                "Ngăn cũ phải có ir_detected = NULL, không bị backfill thành 0");
    }
}
