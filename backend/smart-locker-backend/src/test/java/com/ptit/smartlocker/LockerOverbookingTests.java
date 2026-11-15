package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.OrderService;
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
 * Test chống đặt trùng ngăn (double-booking / overselling) — tính năng được
 * README quảng cáo là điểm đổi mới nổi bật ("Cơ chế Khóa Tranh Chấp Nguyên Tử").
 *
 * <h2>Vì sao lớp này được viết lại (2026-11-08)</h2>
 * Bộ test cũ có {@code catch (RuntimeException e) { }} RỖNG, nên nuốt cả
 * {@link NullPointerException}. Khi phá chốt {@code selectSuitableCompartment == null} thì
 * code nổ NPE tại {@code assignedComp.setStatus(...)}, NPE bị nuốt, biến đếm "thành công"
 * không tăng, và test vẫn PASS. Kết quả là bỏ cả hai chốt chặn mà không test nào phát hiện.
 *
 * <p>Luật mới: một ngoại lệ chỉ được coi là "từ chối nghiệp vụ" khi message của nó chứa
 * dấu hiệu nghiệp vụ. {@code NullPointerException} hoặc lỗi lập trình khác phải làm test FAIL.
 *
 * <h2>Hai chốt chặn và hai test khoá riêng</h2>
 * {@code OrderService.createOrder} có hai lớp bảo vệ độc lập:
 * <ol>
 *   <li><b>Chốt lịch biểu</b> — {@code if (schedule.getAvailableSlots() <= 0)}
 *       → ném "đã hết chỗ vào ngày ...".</li>
 *   <li><b>Chốt ngăn vật lý</b> — {@code if (assignedComp == null)}
 *       → ném "hiện không còn ngăn tủ trống phù hợp với kích thước".</li>
 * </ol>
 * {@link #hetChoTheoLichBieu()} và {@link #hetNganPhuHopTheoKichThuoc()} mỗi test khoá đúng
 * MỘT chốt, bằng cách khẳng định đúng câu thông báo của chốt đó — nên phá chốt nào thì test
 * tương ứng FAIL, không thể lọt.
 */
@SpringBootTest
@Transactional
class LockerOverbookingTests {

    /** Dấu hiệu của chốt lịch biểu: "Tủ ... đã hết chỗ vào ngày ...". */
    private static final String DAU_HIEU_HET_CHO = "hết chỗ";
    /** Dấu hiệu của chốt ngăn vật lý: "... không còn ngăn tủ trống phù hợp ...". */
    private static final String DAU_HIEU_KHONG_CON_NGAN = "không còn ngăn";

    @Autowired private OrderService orderService;
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

    @Test
    @DisplayName("Đặt 1 đơn hôm nay: ngăn EMPTY giảm 1, ngăn RESERVED tăng 1 (giữ chỗ vật lý)")
    void datMotDonGiuMotNgan() {
        int emptyTruoc = soNganTrong();
        int reservedTruoc = soNganReserved();
        assertTrue(emptyTruoc > 0, "Cần ít nhất 1 ngăn EMPTY để test");

        orderService.createOrder(taoRequest("0911111111", "S", LocalDate.now()));

        assertEquals(emptyTruoc - 1, soNganTrong(), "Đặt 1 đơn phải giữ đúng 1 ngăn");
        assertEquals(reservedTruoc + 1, soNganReserved(), "Ngăn phải chuyển sang RESERVED");
    }

    // ─────────────────────────────────────────────────────────────
    // CHỐT 1 — LỊCH BIỂU (available_slots)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("CHỐT LỊCH BIỂU: available_slots = 0 (còn ngăn EMPTY) thì bị từ chối bằng 'đã hết chỗ'")
    void hetChoTheoLichBieu() {
        // Khoá RIÊNG chốt `if (schedule.getAvailableSlots() <= 0)`.
        //
        // Vì sao dùng NGÀY MAI: với đơn hôm nay, code đồng bộ lại availableSlots = số ngăn EMPTY
        // thực tế (OrderService dòng 94-102), nên không thể ép về 0 khi vẫn còn ngăn trống.
        // Đơn ngày mai KHÔNG đi qua nhánh đồng bộ đó và cũng không gán ngăn vật lý → chỉ còn
        // đúng một chốt có thể chặn: chốt lịch biểu. Nhờ vậy test này tất định.
        LocalDate ngayMai = LocalDate.now().plusDays(1);
        slotScheduleRepository.initScheduleIfNotExists(locker.getLockerId(), ngayMai, 2);
        LockerSlotSchedule schedule = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), ngayMai)
                .orElseThrow();
        schedule.setAvailableSlots(0);
        slotScheduleRepository.save(schedule);

        assertTrue(soNganTrong() > 0,
                "Fixture phải CÒN ngăn EMPTY, để chốt bị kích hoạt chỉ có thể là chốt lịch biểu");

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> orderService.createOrder(taoRequest("0988880001", "S", ngayMai)),
                "available_slots = 0 thì phải bị từ chối");

        // Bỏ chốt `availableSlots <= 0` ⇒ không ném gì (hoặc ném lỗi khác) ⇒ FAIL tại đây.
        khangDinhTuChoiNghiepVu(ex, DAU_HIEU_HET_CHO,
                "Hết slot theo lịch biểu (chốt availableSlots <= 0)");

        LockerSlotSchedule sau = slotScheduleRepository
                .findByLocker_LockerIdAndScheduleDate(locker.getLockerId(), ngayMai)
                .orElseThrow();
        assertEquals(0, sau.getAvailableSlots(),
                "Đơn bị từ chối KHÔNG được trừ slot — phải giữ nguyên 0, không được âm");
    }

    @Test
    @DisplayName("CHỐT LỊCH BIỂU: available_slots giảm đúng 1 mỗi đơn thành công")
    void availableSlotsGiamDung() {
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

    // ─────────────────────────────────────────────────────────────
    // CHỐT 2 — NGĂN VẬT LÝ PHÙ HỢP (assignedComp == null)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ18: kiện size L ĐƯỢC cấp ngăn size S — không còn phân biệt size")
    void kienSizeLDuocCapNganS() {
        // GĐ18 — test cũ `hetNganPhuHopTheoKichThuoc` kiểm hành vi ĐÃ BỊ BỎ: "còn ngăn S mà xin
        // ngăn L thì từ chối". Nay mọi ngăn dùng được như nhau, nên kỳ vọng đảo lại: phải CẤP
        // được ngăn S cho kiện L. Đây chính là phép thử chứng minh đã bỏ phân biệt size thật sự.
        //
        // Chiếm hết ngăn L trước, để chắc chắn ngăn được cấp là ngăn S.
        //
        // KHÔNG dùng createOrder để chiếm: từ GĐ18 createOrder bỏ qua size nên nó sẽ lấy luôn
        // ngăn S đầu tiên, còn ngăn L vẫn trống — fixture không dựng được điều kiện cần. Đặt
        // thẳng status ở tầng repository: đây là dựng dữ liệu test, không phải đường nghiệp vụ.
        int soLChiem = 0;
        for (Compartment c : compartmentRepository
                .findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY")) {
            if ("L".equalsIgnoreCase(c.getSize())) {
                c.setStatus("OCCUPIED");
                compartmentRepository.save(c);
                soLChiem++;
            }
        }
        assertTrue(soLChiem > 0, "Fixture cần ít nhất 1 ngăn L đang trống để chiếm");

        List<Compartment> conTrong = compartmentRepository
                .findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY");
        assertTrue(!conTrong.isEmpty(),
                "Fixture cần CÒN ngăn trống (size S) để chứng minh ngăn S nhận được kiện L");
        // Nếu còn ngăn L trống thì ngăn được cấp có thể là L, và test sẽ không chứng minh được gì.
        for (Compartment c : conTrong) {
            assertEquals("S", c.getSize(),
                    "Sau fixture, mọi ngăn còn trống phải là size S");
        }

        // Xin size L khi chỉ còn ngăn S → PHẢI THÀNH CÔNG (trước GĐ18 là từ chối).
        OrderDTO.OrderResponse res = orderService.createOrder(
                taoRequest("0966666666", "L", LocalDate.now()));
        assertNotNull(res, "Kiện size L phải được cấp ngăn dù chỉ còn ngăn size S");

        // Chứng minh ngăn được cấp thực sự là size S — nếu không, test không nói lên điều gì.
        String assignedId = res.getOrderId();
        Compartment assigned = orderRepository.findById(assignedId)
                .map(o -> o.getCompartment())
                .orElse(null);
        assertNotNull(assigned, "Đơn phải có ngăn được gán");
        assertEquals("S", assigned.getSize(),
                "Ngăn được cấp phải là size S — đây là bằng chứng đã bỏ phân biệt size");
    }

    @Test
    @DisplayName("GĐ18: hết SẠCH ngăn trống thì báo 'Tủ đã hết ngăn trống' (không nhắc size)")
    void hetSachNganTrongBaoHetNgan() {
        // GĐ18 — test cũ `kichThuocQuaLonBiTuChoi` chiếm hết ngăn L rồi xin L và mong bị từ chối.
        // Nay ngăn S nhận được kiện L, nên muốn từ chối thì phải chiếm HẾT mọi ngăn trống.
        int chiemDuoc = 0;
        for (Compartment c : compartmentRepository
                .findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY")) {
            try {
                // Kích thước KHÔNG còn quan trọng — dùng "L" cho mọi lượt để thấy rõ điều đó.
                orderService.createOrder(taoRequest("095555111" + c.getCompIndex(), "L", LocalDate.now()));
                chiemDuoc++;
            } catch (RuntimeException e) {
                khangDinhTuChoiNghiepVu(e, DAU_HIEU_HET_CHO, "Chiếm hết ngăn trống");
            }
        }
        assertTrue(chiemDuoc > 0, "Fixture phải chiếm được ít nhất 1 ngăn");
        assertEquals(0, soNganTrong(), "Fixture phải chiếm SẠCH ngăn trống");

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> orderService.createOrder(taoRequest("0966667777", "L", LocalDate.now())),
                "Hết ngăn trống thì phải từ chối");
        khangDinhTuChoiNghiepVu(ex, DAU_HIEU_HET_CHO,
                "Hết sạch ngăn trống (không phải lý do kích thước)");
        // Message mới không được nhắc tới size nữa.
        String msg = String.valueOf(ex.getMessage());
        assertFalse(msg.toLowerCase().contains("kích thước"),
                "Message không được nhắc 'kích thước' vì mọi ngăn dùng được như nhau: " + msg);
    }

    // ─────────────────────────────────────────────────────────────
    // KHÔNG BAO GIỜ DOUBLE-BOOK
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("Không được cấp quá số ngăn thật: số đơn thành công <= số ngăn EMPTY ban đầu, không trùng ngăn")
    void khongCapQuaSoNganThat() {
        int emptyTruoc = soNganTrong();
        assertTrue(emptyTruoc > 0, "Cần ít nhất 1 ngăn EMPTY để test");

        // Chỉ theo dõi những đơn do CHÍNH test này tạo. `orderRepository.findAll()` còn chứa
        // dữ liệu seed/đơn của fixture khác, nên nếu quét cả bảng sẽ báo double-booking sai.
        List<String> orderIdDaTao = new java.util.ArrayList<>();
        for (int i = 0; i < emptyTruoc + 3; i++) {
            try {
                OrderDTO.OrderResponse res = orderService.createOrder(
                        taoRequest("09222200" + i, "S", LocalDate.now()));
                orderIdDaTao.add(res.getOrderId());
            } catch (RuntimeException e) {
                // Đây là chỗ bộ test CŨ nuốt mọi RuntimeException (kể cả NPE) nên vô nghĩa.
                // Nay: chỉ chấp nhận từ chối nghiệp vụ, NPE phải làm test FAIL.
                khangDinhTuChoiNghiepVu(e, DAU_HIEU_HET_CHO,
                        "Đơn vượt số ngăn (vòng " + i + ")");
            }
        }

        int thanhCong = orderIdDaTao.size();
        assertTrue(thanhCong <= emptyTruoc,
                "Không được cấp nhiều hơn " + emptyTruoc + " ngăn có thật, nhưng đã cấp " + thanhCong);
        assertEquals(0, soNganTrong(), "Sau khi đặt hết chỗ thì không còn ngăn EMPTY nào");

        // Khoá double-booking thật: trong các đơn VỪA TẠO, không có 2 đơn cùng trỏ 1 ngăn.
        Set<Integer> daDung = new HashSet<>();
        for (String oid : orderIdDaTao) {
            var o = orderRepository.findById(oid).orElseThrow();
            assertNotNull(o.getCompartment(),
                    "Đơn đặt cho hôm nay phải được gán ngăn: " + oid);
            assertTrue(daDung.add(o.getCompartment().getCompIndex()),
                    "Ngăn #" + o.getCompartment().getCompIndex()
                            + " bị cấp cho 2 đơn — đó là double-booking (đơn " + oid + ")");
        }
    }

    @Test
    @DisplayName("Đặt cho NGÀY MAI: không giữ ngăn vật lý hôm nay, chỉ trừ slot lịch biểu")
    void datChoNgayMaiKhongGiuNganVatLy() {
        int emptyTruoc = soNganTrong();
        LocalDate ngayMai = LocalDate.now().plusDays(1);

        orderService.createOrder(taoRequest("0944444444", "S", ngayMai));

        assertEquals(emptyTruoc, soNganTrong(),
                "Đơn cho ngày mai không được chiếm ngăn vật lý của hôm nay");
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
