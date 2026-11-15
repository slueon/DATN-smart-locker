package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.ShipperIdentityToken;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ33 — MỘT MÃ QR SHIPPER DUY NHẤT (ấn bao nhiêu lần vẫn mã đó).
 *
 * <p>Thay đổi: {@code generateDynamicToken} dùng lại token của chính shipper
 * ({@code findTopByShipperIdOrderByCreatedAtDesc}) và chỉ reset {@code isVerified = false} +
 * {@code lockerId = null} thay vì sinh UUID mới. {@code verifyDynamicToken} không đổi — nhờ vậy
 * {@code isVerified} trở thành cờ PHIÊN.
 *
 * <p><b>Cặp đối chứng quan trọng nhất:</b> (3) generate → verify → generate → verify phải OK **cả
 * hai lần**; (4) verify 2 lần liên tiếp **không generate ở giữa** thì lần 2 phải **bị từ chối** —
 * chứng minh không mất lớp chống replay trong phiên.
 */
@SpringBootTest
@Transactional
class ShipperSingleQrTests {

    private static final String SHIPPER = "shipper-gd33";
    private static final String LOCKER = "LOCKER_HN_01";

    @Autowired private ShipperService shipperService;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;

    private long demToken() {
        return tokenRepository.findAll().stream()
                .filter(t -> SHIPPER.equals(t.getShipperId())).count();
    }

    @Test
    @DisplayName("GĐ33 (1): generate 3 lần → cùng MỘT mã (so từng ký tự)")
    void generateBaLanCungMotMa() {
        String m1 = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();
        String m2 = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();
        String m3 = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();

        assertEquals(m1, m2, "Lần 2 phải trả đúng mã của lần 1");
        assertEquals(m1, m3, "Lần 3 phải trả đúng mã của lần 1");
        assertNotNull(m1);
        assertTrue(m1.startsWith("SHIP-"), "Vẫn giữ tiền tố SHIP-");
    }

    @Test
    @DisplayName("GĐ33 (2): gọi 3 lần KHÔNG sinh thêm dòng token")
    void khongSinhDongMoi() {
        shipperService.generateDynamicToken(SHIPPER);   // lần đầu: tạo 1 dòng
        long sauLanDau = demToken();
        assertEquals(1, sauLanDau, "Lần đầu tạo đúng 1 dòng cho shipper này");

        shipperService.generateDynamicToken(SHIPPER);
        shipperService.generateDynamicToken(SHIPPER);

        assertEquals(sauLanDau, demToken(),
                "Các lần sau KHÔNG được tạo dòng mới (điều cấm #3: cũng không xoá dòng cũ)");
    }

    @Test
    @DisplayName("GĐ33 (3): generate → verify → generate → verify CÙNG MÃ phải OK CẢ HAI LẦN")
    void quetLaiDuocSauMoiLanGenerate() {
        String ma = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();

        assertEquals(true, shipperService.verifyDynamicToken(LOCKER, ma),
                "Phiên 1: quét mã phải thành công");

        // Bấm lấy QR lần nữa = mở phiên mới, mã KHÔNG đổi.
        String maLan2 = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();
        assertEquals(ma, maLan2, "Mã vẫn là mã cũ");

        assertEquals(true, shipperService.verifyDynamicToken(LOCKER, ma),
                "Phiên 2: quét LẠI ĐÚNG mã đó phải thành công — đây là điểm dễ hỏng nhất của GĐ33");
    }

    @Test
    @DisplayName("GĐ33 (4): verify 2 lần KHÔNG generate ở giữa → lần 2 bị TỪ CHỐI")
    void khongQuetLaiTrongCungPhien() {
        String ma = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();

        assertEquals(true, shipperService.verifyDynamicToken(LOCKER, ma));

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.verifyDynamicToken(LOCKER, ma),
                "Quét lần 2 trong CÙNG phiên phải bị chặn — nếu không là mất lớp chống replay");
        assertTrue(ex.getMessage().contains("đã được sử dụng"),
                "Message phải nói rõ mã đã được sử dụng, hiện tại: " + ex.getMessage());
    }

    @Test
    @DisplayName("GĐ33: mỗi lần generate reset cả isVerified VÀ lockerId")
    void generateResetCaHaiCo() {
        String ma = shipperService.generateDynamicToken(SHIPPER).getDynamicToken();
        shipperService.verifyDynamicToken(LOCKER, ma);

        ShipperIdentityToken sauKhiQuet = tokenRepository.findByDynamicToken(ma).orElseThrow();
        assertTrue(Boolean.TRUE.equals(sauKhiQuet.getIsVerified()), "Sau khi quét: isVerified = true");
        assertEquals(LOCKER, sauKhiQuet.getLockerId(), "Sau khi quét: gắn đúng tủ");

        shipperService.generateDynamicToken(SHIPPER);

        ShipperIdentityToken sauGenerate = tokenRepository.findByDynamicToken(ma).orElseThrow();
        assertFalse(Boolean.TRUE.equals(sauGenerate.getIsVerified()),
                "Generate phải mở phiên mới (isVerified = false)");
        assertNull(sauGenerate.getLockerId(),
                "Generate phải bỏ ràng buộc tủ của phiên trước (shipper có thể giao tủ khác)");
    }

    @Test
    @DisplayName("GĐ33 (3b): shipper KHÁC có mã KHÁC (mã cố định theo shipper, không dùng chung)")
    void haiShipperKhacMa() {
        String a = shipperService.generateDynamicToken("shipper-a-gd33").getDynamicToken();
        String b = shipperService.generateDynamicToken("shipper-b-gd33").getDynamicToken();
        assertNotEquals(a, b, "Mỗi shipper một mã riêng — cấm dùng chung một mã");
    }
}
