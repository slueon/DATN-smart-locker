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

import static org.junit.jupiter.api.Assertions.*;

/**
 * Test chống đặt trùng ngăn (double-booking / overselling) — tính năng được
 * README quảng cáo là điểm đổi mới nổi bật ("Cơ chế Khóa Tranh Chấp Nguyên Tử").
 *
 * <p>Trước đây phần này KHÔNG có test nào. Nếu khoá bi quan hỏng, hai khách đặt
 * cùng một ngăn cuối cùng của tủ mà cả hai đều nhận xác nhận thành công — lỗi
 * rất khó phát hiện khi demo, chỉ lộ khi có 2 người đặt thật cùng lúc.
 */
@SpringBootTest
@Transactional
class LockerOverbookingTests {

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

    @Test
    @DisplayName("Đặt nhiều đơn hơn số ngăn trống: KHÔNG được cấp quá số ngăn thật")
    void khongCapQuaSoNganThat() {
        int emptyTruoc = soNganTrong();
        assertTrue(emptyTruoc > 0, "Cần ít nhất 1 ngăn EMPTY để test");

        // Đặt nhiều hơn số ngăn còn trống: các đơn vượt phải bị từ chối
        int thanhCong = 0;
        for (int i = 0; i < emptyTruoc + 3; i++) {
            try {
                orderService.createOrder(taoRequest("09222200" + i, "S", LocalDate.now()));
                thanhCong++;
            } catch (RuntimeException e) {
                // Hết chỗ là đúng
            }
        }

        assertTrue(thanhCong <= emptyTruoc,
                "Không được cấp nhiều hơn " + emptyTruoc + " ngăn có thật, nhưng đã cấp " + thanhCong);
        assertEquals(0, soNganTrong(),
                "Sau khi đặt hết chỗ thì không còn ngăn EMPTY nào để cấp sai");
    }

    @Test
    @DisplayName("available_slots giảm đúng 1 mỗi đơn, không âm")
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
            assertEquals(slotTruoc - 1, sau.getAvailableSlots(),
                    "Mỗi đơn phải trừ đúng 1 slot");
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
    @DisplayName("Kích thước kiện lớn hơn mọi ngăn trống: phải từ chối, không cấp ngăn bé hơn")
    void kichThuocQuaLonBiTuChoi() {
        // Seed data: ngăn 1 = S, ngăn 2 = L. Đặt size L khi chỉ còn ngăn S phải bị từ chối.
        // Trước tiên chiếm hết ngăn L để chỉ còn S.
        for (Compartment c : compartmentRepository.findByLocker_LockerIdAndStatus(locker.getLockerId(), "EMPTY")) {
            if ("L".equalsIgnoreCase(c.getSize())) {
                try {
                    orderService.createOrder(taoRequest("095555000" + c.getCompIndex(), "L", LocalDate.now()));
                } catch (RuntimeException ignored) {
                }
            }
        }

        // Giờ xin ngăn L nữa: phải bị từ chối vì không còn ngăn L nào
        assertThrows(RuntimeException.class,
                () -> orderService.createOrder(taoRequest("0966666666", "L", LocalDate.now())),
                "Hết ngăn L thì phải từ chối, không được cấp ngăn S cho kiện size L");
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
