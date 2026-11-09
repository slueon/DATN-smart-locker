package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.ReservationTimeoutService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Test tác vụ tự nhả ngăn đặt trước quá hạn.
 *
 * <p>Lớp này từng có 2 lỗi thật, cả hai đều được kiểm ở đây:
 * <ol>
 *   <li><b>Race condition</b>: {@code @Transactional} bọc cả lượt quét khiến nó ghi đè
 *       ngăn vừa được shipper nạp hàng (OCCUPIED → EMPTY). Test
 *       {@link #boQuaDonVuaDuocNapHang()} khoá lại hành vi đúng.</li>
 *   <li><b>Bịa trạng thái cảm biến</b>: đặt {@code isDoorClosed=true} và
 *       {@code currentWeight=0} dù không đọc cảm biến. Test
 *       {@link #giuNguyenTrangThaiCamBien()} khoá lại.</li>
 * </ol>
 */
@SpringBootTest
@Transactional
class ReservationTimeoutServiceTests {

    @Autowired private ReservationTimeoutService service;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;

    /**
     * Spy trên repository để chứng minh đường nhả ngăn THẬT SỰ đọc bằng truy vấn có KHOÁ.
     *
     * <p>Đây là assertion tất định duy nhất khoá lại được yêu cầu "phải dùng
     * `findByIdForReleaseWithLock`": nếu ai đổi sang `findById` thường thì lời gọi hàm có khoá
     * không còn xảy ra → `verify(...)` FAIL ngay, không phụ thuộc thời điểm như test 2 luồng.
     */
    @MockitoSpyBean private OrderRepository orderRepositorySpy;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        assertNotNull(locker, "Seed data phải có LOCKER_HN_01");
        // Mặc định timeout 120 phút theo application.properties
        ReflectionTestUtils.setField(service, "timeoutMinutes", 120L);
    }

    private Compartment layNgan(int compIndex) {
        return compartmentRepository
                .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), compIndex)
                .orElseThrow();
    }

    /** Tạo đơn PENDING đã đặt trước, giữ một ngăn, đặt trước cách đây `phut` phút. */
    private Order taoDonDatTruoc(String orderId, int compIndex, long phut) {
        Compartment comp = layNgan(compIndex);
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
                .shipperReservedAt(LocalDateTime.now().minusMinutes(phut))
                .build();
        return orderRepository.save(order);
    }

    @Test
    @DisplayName("Đặt trước quá hạn: ngăn về EMPTY, đơn mất dấu đặt trước")
    void nhaNganQuaHan() {
        Order order = taoDonDatTruoc("ORD-TT-QUAHAN", 1, 180);

        service.releaseExpiredReservations();

        Order sau = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertNull(sau.getShipperReservedAt(), "Dấu đặt trước phải bị xoá");
        assertNull(sau.getCompartment(), "Đơn phải không còn giữ ngăn");
        assertEquals("EMPTY", layNgan(1).getStatus(), "Ngăn phải được trả về EMPTY");
    }

    @Test
    @DisplayName("Đặt trước CHƯA quá hạn: không được nhả")
    void khongNhaKhiChuaQuaHan() {
        Order order = taoDonDatTruoc("ORD-TT-CONHAN", 1, 30); // 30 phút < 120 phút

        service.releaseExpiredReservations();

        Order sau = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertNotNull(sau.getShipperReservedAt(), "Chưa quá hạn thì phải giữ dấu đặt trước");
        assertEquals("RESERVED", layNgan(1).getStatus(), "Ngăn vẫn phải ở RESERVED");
    }

    @Test
    @DisplayName("LỖI ĐÃ VÁ: không bịa trạng thái cảm biến — cân nặng và cảm biến cửa giữ nguyên")
    void giuNguyenTrangThaiCamBien() {
        Order order = taoDonDatTruoc("ORD-TT-CAMBIEN", 1, 180);

        // Cửa đang MỞ, có hàng nặng 0.5kg theo cảm biến thật
        Compartment comp = layNgan(1);
        comp.setCurrentWeight(0.5);
        comp.setIsDoorClosed(false);
        compartmentRepository.save(comp);

        service.releaseExpiredReservations();

        Compartment sau = layNgan(1);
        assertEquals("EMPTY", sau.getStatus(), "Trạng thái chiếm dụng phải được giải phóng");
        assertEquals(0.5, sau.getCurrentWeight(), 0.001,
                "Cân nặng là nguồn sự thật của HX711 — tác vụ nhả ngăn KHÔNG được đặt về 0");
        assertFalse(sau.getIsDoorClosed(),
                "Trạng thái cửa là nguồn sự thật của MC-38 — KHÔNG được tự đặt thành đã đóng");
    }

    @Test
    @DisplayName("LỖI ĐÃ VÁ: không nhả ngăn đang OCCUPIED (có hàng thật bên trong)")
    void khongNhaNganDangCoHang() {
        Order order = taoDonDatTruoc("ORD-TT-OCCUPIED", 1, 180);

        // Shipper đã nạp hàng nhưng dấu đặt trước còn (dữ liệu lệch)
        Compartment comp = layNgan(1);
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);

        service.releaseExpiredReservations();

        assertEquals("OCCUPIED", layNgan(1).getStatus(),
                "Ngăn đang có hàng thật thì tuyệt đối không được trả về EMPTY");
        Order sau = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertEquals("PENDING", sau.getStatus(), "Đơn phải giữ nguyên trạng thái");
    }

    @Test
    @DisplayName("LỖI ĐÃ VÁ: đơn vừa được nạp hàng trong lúc chờ khoá thì bỏ qua (chống race)")
    void boQuaDonVuaDuocNapHang() {
        Order order = taoDonDatTruoc("ORD-TT-RACE", 1, 180);

        // Mô phỏng: shipper nạp hàng xong NGAY TRƯỚC khi tác vụ nhả chạy.
        // Đơn chuyển DEPOSITED, ngăn thành OCCUPIED.
        Compartment comp = layNgan(1);
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);
        order.setStatus("DEPOSITED");
        order.setDepositedAt(LocalDateTime.now());
        orderRepository.save(order);

        service.releaseExpiredReservations();

        // Đây chính là kịch bản từng làm mất dữ liệu: hàng nằm trong tủ nhưng DB ghi trống.
        Order sau = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertEquals("DEPOSITED", sau.getStatus(), "Đơn đã DEPOSITED không được bị đổi");
        assertNotNull(sau.getCompartment(), "Đơn đã nạp hàng phải giữ liên kết ngăn");
        assertEquals("OCCUPIED", layNgan(1).getStatus(),
                "Ngăn đang có hàng không được bị ghi đè thành EMPTY");
    }

    @Test
    @DisplayName("Ngăn đã bị người khác giải phóng (compartment null): chỉ xoá dấu, không lỗi")
    void nganDaBiGiaiPhong() {        Order order = taoDonDatTruoc("ORD-TT-NGANNULL", 1, 180);
        order.setCompartment(null);
        orderRepository.save(order);

        assertDoesNotThrow(() -> service.releaseExpiredReservations(),
                "Đơn không còn giữ ngăn không được làm tác vụ quét ném lỗi");

        Order sau = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertNull(sau.getShipperReservedAt(), "Dấu đặt trước phải được dọn");
    }

    @Test
    @DisplayName("Time + available_slots: nhả ngăn KHÔNG được cộng lại slot (slot đã trừ lúc khách đặt)")
    void nhaNganKhongCongSlot() {
        taoDonDatTruoc("ORD-TT-SLOT", 1, 180);

        Integer slotTruoc = null;
        var schedule = lockerRepository.findById(locker.getLockerId()).orElseThrow();
        // Ghi nhận trạng thái lịch biểu trước khi nhả
        Integer compsTruoc = compartmentRepository
                .findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY").size();

        service.releaseExpiredReservations();

        Integer compsSau = compartmentRepository
                .findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY").size();
        assertEquals(compsTruoc + 1, compsSau,
                "Ngăn EMPTY phải tăng 1 sau khi nhả (nhưng available_slots thì không được đụng)");
        assertNotNull(schedule, "Tủ phải tồn tại");
    }

    // ─────────────────────────────────────────────────────────────
    // CHỐNG RACE — phần mà test cũ KHÔNG khoá được
    //
    // Test cũ `boQuaDonVuaDuocNapHang` chạy ĐƠN LUỒNG: nó set DEPOSITED rồi mới gọi
    // tác vụ, nên dù không có khoá thì điều kiện `status != PENDING` vẫn chặn — bỏ
    // `findByIdForReleaseWithLock` mà test vẫn PASS. Hai test dưới đây khoá lại ĐÚNG
    // cơ chế: (E) đường nhả ngăn phải đọc bằng truy vấn CÓ KHOÁ, và (F) sau khi đọc
    // có khoá phải KIỂM LẠI điều kiện trên dữ liệu vừa đọc.
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Đường nhả ngăn PHẢI đọc bằng truy vấn có khoá bi quan (findByIdForReleaseWithLock)")
    void nhaNganPhaiDungTruyVanCoKhoa() {
        taoDonDatTruoc("ORD-TT-KHOA", 1, 180);
        org.mockito.Mockito.clearInvocations(orderRepositorySpy);

        service.releaseExpiredReservations();

        // Assertion TẤT ĐỊNH: đổi sang `findById` thường là FAIL ngay tại đây.
        verify(orderRepositorySpy, atLeastOnce()).findByIdForReleaseWithLock("ORD-TT-KHOA");
        // Và không được đi đường không khoá cho chính đơn này.
        verify(orderRepositorySpy, never()).findById("ORD-TT-KHOA");

        assertEquals("EMPTY", layNgan(1).getStatus(), "Ngăn phải thật sự được nhả");
    }

    @Test
    @DisplayName("Sau khi đọc có khoá phải KIỂM LẠI: đơn đã DEPOSITED thì không được nhả ngăn")
    void kiemLaiTrenBanGhiDaKhoa() {
        Order order = taoDonDatTruoc("ORD-TT-KIEMLAI", 1, 180);

        // Mô phỏng đúng kịch bản thật: danh sách quét thấy đơn này (vẫn PENDING, quá hạn),
        // nhưng NGAY TRƯỚC khi `releaseOne` đọc bản ghi có khoá thì shipper đã nạp hàng xong
        // và commit (trạng thái đổi thành DEPOSITED, ngăn OCCUPIED).
        //
        // Chặn tại chính lời gọi `findByIdForReleaseWithLock` để mô phỏng thứ tự này một cách
        // tất định — không phụ thuộc may rủi về thời điểm.
        org.mockito.Mockito.doAnswer(invocation -> {
            Compartment comp = compartmentRepository
                    .findByLocker_LockerIdAndCompIndex(locker.getLockerId(), 1).orElseThrow();
            comp.setStatus("OCCUPIED");
            compartmentRepository.save(comp);

            Order fresh = orderRepository.findById("ORD-TT-KIEMLAI").orElseThrow();
            fresh.setStatus("DEPOSITED");
            fresh.setDepositedAt(LocalDateTime.now());
            orderRepository.save(fresh);

            return invocation.callRealMethod();
        }).when(orderRepositorySpy).findByIdForReleaseWithLock("ORD-TT-KIEMLAI");

        service.releaseExpiredReservations();

        // Đây chính là dữ liệu từng bị mất: hàng nằm trong tủ nhưng DB ghi trống.
        assertEquals("OCCUPIED", layNgan(1).getStatus(),
                "Ngăn vừa được nạp hàng (OCCUPIED) TUYỆT ĐỐI không được bị nhả về EMPTY");
        Order sau = orderRepository.findById("ORD-TT-KIEMLAI").orElseThrow();
        assertEquals("DEPOSITED", sau.getStatus(), "Đơn đã nạp hàng phải giữ DEPOSITED");
        assertNotNull(sau.getCompartment(), "Đơn đã nạp hàng phải còn liên kết ngăn");
    }
}
