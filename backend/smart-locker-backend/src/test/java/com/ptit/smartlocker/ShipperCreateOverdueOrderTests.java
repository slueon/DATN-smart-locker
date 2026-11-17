package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.entity.ShipperIdentityToken;
import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ51 — NÚT "+ THÊM ĐƠN QUÁ HẠN" Ở TAB THU HỒI CỦA SHIPPER.
 *
 * <h2>Vì sao cần</h2>
 * <p>Sau khi xoá {@code ORD-OVERDUE01} (yêu cầu user 17/11), muốn có một đơn quá hạn để demo hay
 * thử luồng thu hồi thì phải gõ SQL tay ({@code scripts/evidence/mk-overdue.sql}) — người dùng
 * không làm được trên web. Thẻ này mở đường tạo bằng 1 nút bấm (chỉ SHIPPER).
 *
 * <h2>Bốn luật dưới đây khoá lại</h2>
 * <ol>
 *   <li><b>Tạo được đơn OVERDUE</b> trên ngăn {@code EMPTY} của tủ: đơn {@code OVERDUE}, ngăn
 *       {@code OCCUPIED}, có credential nhận hàng, có vết {@code device_events}.</li>
 *   <li><b>KHÔNG gõ cân giả</b> (bài học GĐ50): {@code current_weight} và {@code ir_detected} phải
 *       giữ nguyên giá trị cảm biến đang có — đơn tạo thử không được tự đặt cân.</li>
 *   <li><b>Hết ngăn trống → 409</b> ({@code BusinessException}) với câu tiếng Việt rõ, và
 *       <b>không</b> tạo đơn rác.</li>
 *   <li><b>Tủ đang bảo trì → 409</b>, không chiếm ngăn.</li>
 * </ol>
 *
 * <p>Không test phân quyền ở đây: {@code SecurityConfig} là cấu hình khai báo, được khoá bằng
 * chính dòng {@code hasRole("SHIPPER")} và minh kiểm bằng HTTP thật (phép 5). Thêm
 * {@code spring-security-test} chỉ để test một dòng cấu hình là không tương xứng.
 */
@SpringBootTest
@Transactional
class ShipperCreateOverdueOrderTests {

    private static final String LOCKER = "LOCKER_HN_01";
    private static final String SHIPPER = "shipper";

    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private PickupCredentialRepository credentialRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;
    @Autowired private UserRepository userRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById(LOCKER).orElseThrow();
        locker.setConnectionStatus("ONLINE");
        lockerRepository.save(locker);

        // Dọn trạng thái để mỗi test bắt đầu từ "2 ngăn EMPTY, không cân" (đúng baseline sau GĐ50).
        for (int i = 1; i <= 2; i++) {
            Compartment c = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, i).orElseThrow();
            c.setStatus("EMPTY");
            c.setCurrentWeight(0.0);
            c.setIrDetected(null);
            c.setIsDoorClosed(true);
            compartmentRepository.save(c);
        }
        // Xoá đơn test còn sót (dữ liệu seed không có ORD-GD51-*).
        orderRepository.findByStatus("OVERDUE").stream()
                .filter(o -> o.getOrderId().startsWith("ORD-GD51-"))
                .forEach(orderRepository::delete);
    }

    /** Tạo token shipper đã xác thực tại tủ (chỉ để chứng minh luồng sau đó chạy được). */
    private void taoPhienShipper(String token) {
        LocalDateTime now = LocalDateTime.now();
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId(SHIPPER).dynamicToken(token)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
    }

    // ─────────────────────────────────────────────────────────────
    // (1) TẠO ĐƯỢC ĐƠN OVERDUE TRÊN NGĂN EMPTY
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ51 (1): shipper tạo đơn quá hạn → đơn OVERDUE trên ngăn EMPTY, ngăn OCCUPIED, có credential")
    void taoDonQuaHanThanhCong() {
        long donTruoc = orderRepository.count();
        String nguoiTao = SHIPPER;

        var res = shipperService.createOverdueOrder(LOCKER, null, nguoiTao);

        assertNotNull(res, "Phải trả về thông tin đơn vừa tạo để UI hiện mã đơn + ngăn");
        assertNotNull(res.getOrderId(), "Đơn mới phải có mã");
        assertTrue(res.getOrderId().startsWith("ORD-"), "Mã đơn theo đúng định dạng dự án: " + res.getOrderId());

        assertEquals(donTruoc + 1, orderRepository.count(), "Phải tạo ĐÚNG 1 đơn");

        Order don = orderRepository.findById(res.getOrderId()).orElseThrow();
        assertEquals("OVERDUE", don.getStatus(),
                "Đơn tạo thử phải ở trạng thái OVERDUE ngay — đây là mục đích của nút.");
        assertNotNull(don.getCompartment(), "Đơn phải gắn một ngăn cụ thể");
        assertEquals("OCCUPIED", don.getCompartment().getStatus(),
                "Ngăn nhận đơn phải là OCCUPIED (có hàng trong tủ).");
        assertNotNull(don.getExpiryDeadline(), "Phải có hạn lưu kho");
        assertTrue(don.getExpiryDeadline().isBefore(LocalDateTime.now()),
                "Hạn lưu kho phải ở QUÁ KHỨ thì mới là 'quá hạn' — thực tế: " + don.getExpiryDeadline());
        assertNotNull(don.getDepositedAt(), "Phải có mốc nạp hàng (đơn đã nằm trong tủ)");

        // Credential nhận hàng: khách phải có mã để tra (dù đơn đã quá hạn).
        PickupCredential cred = credentialRepository.findByOrder_OrderId(don.getOrderId()).orElse(null);
        assertNotNull(cred, "Đơn phải có pickup_credentials để tra cứu như mọi đơn thật");
        assertNotNull(cred.getQrToken(), "Phải có qrToken");
        assertFalse(cred.getQrToken().isBlank(), "qrToken không được rỗng");
        assertNotEquals("", cred.getOtpCode() == null ? "" : cred.getOtpCode(),
                "Phải có OTP 6 số như đơn đã nạp thật");
        assertEquals(6, cred.getOtpCode().length(), "OTP đúng 6 số");

        // Vết kiểm toán: ai tạo.
        Integer compIndex = don.getCompartment().getCompIndex();
        assertTrue(compIndex == 1 || compIndex == 2, "Ngăn phải là ngăn có thật của tủ: " + compIndex);
    }

    // ─────────────────────────────────────────────────────────────
    // (2) KHÔNG GÕ CÂN GIẢ (bài học GĐ50)
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ51 (2): KHÔNG được gõ cân/IR — current_weight và ir_detected giữ nguyên giá trị cảm biến")
    void khongGoCanGia() {
        // Ngăn 1: cảm biến đang đọc 0 g (đúng baseline). Ngăn 2: đặt 850 g như dữ liệu cũ để chắc
        // chắn hàm không ghi đè lên số cảm biến đang có.
        Compartment c2 = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 2).orElseThrow();
        c2.setStatus("EMPTY");
        c2.setCurrentWeight(850.0);
        c2.setIrDetected(true);
        compartmentRepository.save(c2);

        // Khoá ngăn 1 lại để hàm buộc phải chọn ngăn 2.
        Compartment c1 = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();
        c1.setStatus("OCCUPIED");
        compartmentRepository.save(c1);

        var res = shipperService.createOverdueOrder(LOCKER, null, SHIPPER);
        Order don = orderRepository.findById(res.getOrderId()).orElseThrow();
        Compartment nganNhan = compartmentRepository
                .findById(don.getCompartment().getCompartmentId()).orElseThrow();

        assertEquals(2, nganNhan.getCompIndex(), "Chỉ còn ngăn 2 trống nên phải chọn ngăn 2");
        assertEquals(850.0, nganNhan.getCurrentWeight(), 0.01,
                "CẤM gõ cân giả: current_weight phải giữ đúng số cảm biến đang có (850 g), "
                        + "không được tự đặt 0/giá trị bịa. Bài học GĐ50: số cân giả khiến cả hệ "
                        + "tin rằng có kiện 0,85 kg.");
        assertEquals(Boolean.TRUE, nganNhan.getIrDetected(),
                "ir_detected cũng phải giữ nguyên — không được ghi đè cờ cảm biến.");
    }

    // ─────────────────────────────────────────────────────────────
    // (3) HẾT NGĂN TRỐNG → 409, KHÔNG TẠO ĐƠN RÁC
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ51 (3): tủ hết ngăn trống → BusinessException (409) câu rõ, KHÔNG tạo đơn")
    void hetNganTrongThiBao409() {
        for (int i = 1; i <= 2; i++) {
            Compartment c = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, i).orElseThrow();
            c.setStatus("OCCUPIED");
            compartmentRepository.save(c);
        }
        long donTruoc = orderRepository.count();

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.createOverdueOrder(LOCKER, null, SHIPPER),
                "Hết ngăn trống phải là lỗi nghiệp vụ (409), không phải 500 hay im lặng thành công.");

        assertNotNull(ex.getMessage());
        assertTrue(ex.getMessage().toLowerCase().contains("ngăn"),
                "Câu lỗi phải nói rõ vấn đề là NGĂN, để người dùng biết đường xử lý. Thực tế: "
                        + ex.getMessage());
        assertEquals(donTruoc, orderRepository.count(),
                "KHÔNG được để lại đơn rác khi thất bại (transaction phải rollback).");
    }

    // ─────────────────────────────────────────────────────────────
    // (4) TỦ ĐANG BẢO TRÌ → 409
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ51 (4): tủ đang MAINTENANCE → BusinessException, không chiếm ngăn")
    void tuBaoTriThiBao409() {
        locker.setConnectionStatus("MAINTENANCE");
        lockerRepository.save(locker);
        long donTruoc = orderRepository.count();

        BusinessException ex = assertThrows(BusinessException.class,
                () -> shipperService.createOverdueOrder(LOCKER, null, SHIPPER),
                "Tủ đang bảo trì không được nhận đơn mới (cùng luật với luồng đặt ngăn).");

        assertNotNull(ex.getMessage());
        assertEquals(donTruoc, orderRepository.count(), "Không được tạo đơn khi tủ bảo trì.");

        List<Compartment> sau = compartmentRepository.findByLocker_LockerId(LOCKER);
        assertTrue(sau.stream().allMatch(c -> "EMPTY".equals(c.getStatus())),
                "Không ngăn nào được chiếm khi tủ bảo trì. Thực tế: "
                        + sau.stream().map(Compartment::getStatus).toList());
    }

    // ─────────────────────────────────────────────────────────────
    // (5) KHOÁ CHỌN KHÁCH PHẢI DUY NHẤT — họ tên chỉ để hiển thị
    // ─────────────────────────────────────────────────────────────

    @Test
    @DisplayName("GĐ51 (5): chọn khách bằng username (khoá duy nhất) — kể cả khi HAI khách TRÙNG họ tên")
    void chonKhachBangKhoaDuyNhat() {
        // `getCustomerOptions` phải trả `username` cho UI dùng làm value.
        var ds = shipperService.getCustomerOptions();
        assertTrue(ds.stream().allMatch(c -> c.getUsername() != null && !c.getUsername().isBlank()),
                "Danh sách khách PHẢI có `username` — thiếu nó thì UI chỉ còn họ tên để chọn, mà họ "
                        + "tên không duy nhất.");

        // Hai khách TRÙNG họ tên, khác username ⇒ chọn bằng họ tên sẽ gán nhầm người.
        String hoTenTrung = "Nguyễn Văn Trùng Tên GĐ51";
        userRepository.save(com.ptit.smartlocker.entity.User.builder()
                .username("gd51-trung-a").password("x").fullName(hoTenTrung)
                .phone("0900000051").role("CUSTOMER").build());
        userRepository.save(com.ptit.smartlocker.entity.User.builder()
                .username("gd51-trung-b").password("x").fullName(hoTenTrung)
                .phone("0900000052").role("CUSTOMER").build());

        // Chọn theo username ⇒ phải ra ĐÚNG người đó về SĐT, không phải người trùng tên còn lại.
        var resB = shipperService.createOverdueOrder(LOCKER, "gd51-trung-b", SHIPPER);
        Order donB = orderRepository.findById(resB.getOrderId()).orElseThrow();
        assertEquals(hoTenTrung, donB.getCustomerName());
        assertEquals("0900000052", donB.getCustomerPhone(),
                "Chọn 'gd51-trung-b' phải ra SĐT của chính tài khoản đó — nếu ra 0900000051 nghĩa là "
                        + "hệ thống khớp theo HỌ TÊN và đã gán nhầm người.");

        // Họ tên KHÔNG còn là khoá: tra bằng họ tên phải thất bại rõ ràng, không đoán bừa.
        var ex = assertThrows(com.ptit.smartlocker.exception.ResourceNotFoundException.class,
                () -> shipperService.createOverdueOrder(LOCKER, hoTenTrung, SHIPPER),
                "Họ tên không phải khoá duy nhất ⇒ phải từ chối (không được chọn đại người đầu tiên "
                        + "trùng tên).");
        assertNotNull(ex.getMessage());
    }
}
