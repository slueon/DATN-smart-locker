package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test chống đặt trùng ngăn (double-booking) — <b>viết lại ở GĐ65a</b>.
 *
 * <h2>Vì sao lớp này đổi hẳn kỳ vọng</h2>
 * Trước GĐ65a, {@code OrderService.createOrder} tự lấy 1 ngăn {@code EMPTY}, đặt
 * {@code RESERVED} và gán vào đơn mỗi khi đơn giao HÔM NAY. Bộ test cũ khoá đúng hành vi đó
 * ({@code datMotDonGiuMotNgan}, {@code hetSachNganTrongBaoHetNgan}, {@code khongCapQuaSoNganThat},
 * {@code kienSizeLDuocCapNganS}).
 *
 * <p>User báo lỗi 18/11: "tôi không thao tác đặt trước" mà ngăn vẫn bị giữ — vì `ShipperTab`
 * luôn gửi {@code deliveryDate = today}. Nay tạo đơn <b>KHÔNG</b> giữ ngăn:
 * {@code compartment_id = NULL}, {@code shipper_reserved_at = NULL}, 0 ngăn đổi trạng thái.
 * Ngăn chỉ bị giữ khi shipper chủ động {@code reserveCompartment}/{@code assignLocker}.
 *
 * <h2>Bảo đảm chống double-booking KHÔNG bị mất</h2>
 * Chốt chặn nay nằm ở {@code reserveCompartment} (khoá bi quan
 * {@code findWithLockByLockerIdAndStatus(...,"EMPTY")}). Hai test cuối khoá đúng chốt đó: mỗi lần
 * đặt trước giữ đúng 1 ngăn, và hai lần đặt trước không thể cùng một ngăn.
 *
 * <p>Chốt lịch biểu ({@code available_slots}) vẫn của {@code createOrder} — test thứ ba khoá nó.
 */
@SpringBootTest
@Transactional
class LockerOverbookingTests {

    /** Dấu hiệu của chốt lịch biểu: "Tủ ... đã hết chỗ vào ngày ...". */
    private static final String DAU_HIEU_HET_CHO = "hết chỗ";
    /** Dấu hiệu của chốt ngăn vật lý ở `reserveCompartment`: "... không trống ...". */
    private static final String DAU_HIEU_NGAN_KHONG_TRONG = "không trống";

    @Autowired private OrderService orderService;
    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private LockerSlotScheduleRepository slotScheduleRepository;
    @Autowired private OrderRepository orderRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElse(null);
        assertNotNull(locker, "Seed data phải có LOCKER_HN_01");
    }

    private OrderDTO.CheckoutRequest taoRequest(String phone, String size, LocalDate ngay) {
        return new OrderDTO.CheckoutRequest(
                "Khách " + phone, phone, "LOCKER", locker.getLockerId(), ngay,
                "ONLINE_VIETQR", "PAID", "Kiện test", size, BigDecimal.valueOf(50000));
    }

    private int soNganTrong() {
        return compartmentRepository.findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY").size();
    }

    private int soNganReserved() {
        return compartmentRepository.findByLocker_LockerIdAndStatus(locker.getLockerId(), "RESERVED").size();
    }

    /**
     * Khẳng định một ngoại lệ là TỪ CHỐI NGHIỆP VỤ thật.
     *
     * <p>Cố tình không nhận {@code RuntimeException} bất kỳ: nếu code nổ NPE/IllegalState do
     * thiếu chốt chặn, đây phải là FAIL chứ không phải "đã bị từ chối đúng luật".
     */
    private void khangDinhTuChoiNghiepVu(RuntimeException ex, String dauHieu, String nguCanh) {
        assertFalse(ex instanceof NullPointerException,
                nguCanh + ": code nổ NullPointerException — đó là LỖI LẬP TRÌNH (thiếu chốt chặn), "
                        + "không phải từ chối nghiệp vụ. Chi tiết: " + ex);
        assertNotNull(ex.getMessage(),
                nguCanh + ": ngoại lệ nghiệp vụ phải có thông báo cho người dùng, nhưng message là null");
        assertTrue(ex.getMessage().contains(dauHieu),
                nguCanh + ": phải bị chặn bởi chốt '" + dauHieu + "'. Message thực tế: " + ex.getMessage());
    }

    // ─────────────────────────────────────────────────────────────
    // GĐ65a — TẠO ĐƠN KHÔNG GIỮ NGĂN
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ65a: tạo đơn HÔM NAY ⇒ compartment_id NULL, shipper_reserved_at NULL, 0 ngăn đổi trạng thái")
    void taoDonHomNayKhongGiuNgan() {
        int emptyTruoc = soNganTrong();
        int reservedTruoc = soNganReserved();
        assertTrue(emptyTruoc > 0, "Cần ít nhất 1 ngăn EMPTY để phép đo có nghĩa");

        OrderDTO.OrderResponse res = orderService.createOrder(
                taoRequest("0911111111", "S", LocalDate.now()));

        Order don = orderRepository.findById(res.getOrderId()).orElseThrow();
        assertNull(don.getCompartment(),
                "Tạo đơn KHÔNG được giữ ngăn — user báo 'tôi không thao tác đặt trước'");
        assertNull(don.getShipperReservedAt(),
                "Không có đặt trước nào ⇒ shipper_reserved_at phải NULL");
        assertEquals("PENDING", don.getStatus(), "Đơn mới phải ở PENDING");
        assertEquals(emptyTruoc, soNganTrong(), "Không ngăn EMPTY nào được bị lấy đi");
        assertEquals(reservedTruoc, soNganReserved(), "Không ngăn nào được chuyển sang RESERVED");
        // Đề xuất tủ vẫn được ghi — đó là chỗ shipper dự kiến giao, không phải giữ chỗ.
        assertNotNull(don.getLocker(), "locker_id vẫn được ghi như ĐỀ XUẤT");
    }

    @Test
    @DisplayName("GĐ65a: nhiều đơn hôm nay liên tiếp vẫn không ngăn nào bị giữ")
    void nhieuDonLienTiepKhongGiuNgan() {
        int emptyTruoc = soNganTrong();
        int reservedTruoc = soNganReserved();
        for (int i = 0; i < 3; i++) {
            orderService.createOrder(taoRequest("093333330" + i, "S", LocalDate.now()));
        }
        assertEquals(emptyTruoc, soNganTrong(), "3 đơn ⇒ vẫn 0 ngăn EMPTY bị chiếm");
        assertEquals(reservedTruoc, soNganReserved(), "3 đơn ⇒ vẫn 0 ngăn RESERVED");
    }

    @Test
    @DisplayName("GĐ65a: tạo đơn vẫn trừ đúng 1 slot lịch biểu (đó là chỗ theo ngày, không phải ngăn)")
    void taoDonVanTruSlotLichBieu() {
        LockerSlotSchedule truoc = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), LocalDate.now())
                .orElse(null);
        int slotTruoc = truoc != null && truoc.getAvailableSlots() != null ? truoc.getAvailableSlots() : -1;

        orderService.createOrder(taoRequest("0933333333", "S", LocalDate.now()));

        LockerSlotSchedule sau = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), LocalDate.now())
                .orElseThrow();
        assertNotNull(sau.getAvailableSlots());
        assertTrue(sau.getAvailableSlots() >= 0, "available_slots không được âm");
        if (slotTruoc >= 0) {
            assertEquals(slotTruoc - 1, sau.getAvailableSlots(), "Mỗi đơn phải trừ đúng 1 slot");
        }
    }

    @Test
    @DisplayName("CHỐT LỊCH BIỂU: available_slots = 0 thì bị từ chối bằng 'đã hết chỗ'")
    void hetChoTheoLichBieu() {
        // Vì sao dùng NGÀY MAI: với đơn hôm nay, code đồng bộ lại availableSlots = số ngăn EMPTY
        // thực tế, nên không thể ép về 0 khi vẫn còn ngăn trống. Đơn ngày mai không đi qua nhánh
        // đồng bộ đó ⇒ chỉ còn đúng một chốt có thể chặn: chốt lịch biểu.
        LocalDate ngayMai = LocalDate.now().plusDays(1);
        slotScheduleRepository.initScheduleIfNotExists(locker.getLockerId(), ngayMai, 2);
        LockerSlotSchedule schedule = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), ngayMai)
                .orElseThrow();
        schedule.setAvailableSlots(0);
        slotScheduleRepository.save(schedule);

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> orderService.createOrder(taoRequest("0988880001", "S", ngayMai)),
                "available_slots = 0 thì phải bị từ chối");
        khangDinhTuChoiNghiepVu(ex, DAU_HIEU_HET_CHO, "Hết slot theo lịch biểu");

        LockerSlotSchedule sau = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), ngayMai)
                .orElseThrow();
        assertEquals(0, sau.getAvailableSlots(),
                "Đơn bị từ chối KHÔNG được trừ slot — phải giữ nguyên 0, không được âm");
    }

    @Test
    @DisplayName("Đặt cho NGÀY MAI: không giữ ngăn vật lý hôm nay, chỉ trừ slot lịch biểu")
    void datChoNgayMaiKhongGiuNganVatLy() {
        int emptyTruoc = soNganTrong();
        LocalDate ngayMai = LocalDate.now().plusDays(1);

        OrderDTO.OrderResponse res = orderService.createOrder(
                taoRequest("0944444444", "S", ngayMai));

        assertEquals(emptyTruoc, soNganTrong(),
                "Đơn cho ngày mai không được chiếm ngăn vật lý của hôm nay");
        assertNull(orderRepository.findById(res.getOrderId()).orElseThrow().getCompartment());
    }

    // ─────────────────────────────────────────────────────────────
    // CHỐT CHỐNG DOUBLE-BOOKING NAY NẰM Ở reserveCompartment
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Đặt trước thủ công: giữ đúng 1 ngăn, đơn có shipper_reserved_at")
    void datTruocThuCongGiuDungMotNgan() {
        int emptyTruoc = soNganTrong();
        assertTrue(emptyTruoc > 0, "Cần ngăn EMPTY để đặt trước");
        OrderDTO.OrderResponse tao = orderService.createOrder(
                taoRequest("0955555555", "S", LocalDate.now()));
        assertEquals(emptyTruoc, soNganTrong(), "Tạo đơn chưa được giữ ngăn");

        OrderDTO.OrderResponse dat = shipperService.reserveCompartment(
                tao.getOrderId(), null, 1, 2);

        assertEquals(emptyTruoc - 1, soNganTrong(), "Đặt trước phải giữ đúng 1 ngăn");
        assertNotNull(dat.getCompartmentIndex(), "Phải trả về ngăn đã giữ");
        assertTrue(Boolean.TRUE.equals(dat.getIsShipperReserved()),
                "Đơn đặt trước phải có dấu shipper_reserved_at");
        Order sau = orderRepository.findById(tao.getOrderId()).orElseThrow();
        assertNotNull(sau.getCompartment(), "Sau đặt trước, đơn phải trỏ tới ngăn");
        assertNotNull(sau.getShipperReservedAt(), "shipper_reserved_at phải khác NULL");
    }

    @Test
    @DisplayName("Hai đơn không thể đặt trước CÙNG một ngăn — chốt khoá bi quan còn hiệu lực")
    void haiDonKhongCungMotNgan() {
        OrderDTO.OrderResponse a = orderService.createOrder(
                taoRequest("0977777001", "S", LocalDate.now()));
        OrderDTO.OrderResponse b = orderService.createOrder(
                taoRequest("0977777002", "S", LocalDate.now()));

        shipperService.reserveCompartment(a.getOrderId(), null, 1, 2);

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.reserveCompartment(b.getOrderId(), null, 1, 2),
                "Ngăn 1 đã bị đơn A giữ thì đơn B không được giữ nữa");
        khangDinhTuChoiNghiepVu(ex, DAU_HIEU_NGAN_KHONG_TRONG,
                "Hai đơn đặt trước cùng một ngăn");

        // Và không có 2 đơn cùng trỏ 1 ngăn trong các đơn vừa tạo.
        Set<Integer> daDung = new HashSet<>();
        for (String oid : List.of(a.getOrderId(), b.getOrderId())) {
            Compartment c = orderRepository.findById(oid).orElseThrow().getCompartment();
            if (c != null) {
                assertTrue(daDung.add(c.getCompIndex()),
                        "Ngăn #" + c.getCompIndex() + " bị cấp cho 2 đơn — double-booking");
            }
        }
    }

    @Test
    @DisplayName("Mỗi đơn tạo ra đúng 1 pickup_credential với qrToken ngẫu nhiên, không suy từ orderId")
    void qrTokenNgauNhienKhongSuyTuOrderId() {
        OrderDTO.OrderResponse res = orderService.createOrder(
                taoRequest("0977777777", "S", LocalDate.now()));

        assertNotNull(res.getOrderId());
        assertNotNull(res.getQrToken());
        assertNotEquals("PKUP-" + res.getOrderId(), res.getQrToken(),
                "qrToken KHÔNG được suy ra từ orderId — đây là lỗ hổng đã vá");
        assertFalse(res.getQrToken().contains(res.getOrderId()),
                "qrToken không được chứa orderId, nếu không sẽ đoán được");
        assertTrue(res.getQrToken().length() >= 20,
                "qrToken phải đủ dài để không đoán được, hiện tại: " + res.getQrToken().length());
    }
}
