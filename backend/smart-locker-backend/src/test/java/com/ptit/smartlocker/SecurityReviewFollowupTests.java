package com.ptit.smartlocker;

import com.ptit.smartlocker.controller.ShipperController;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.ShipperIdentityToken;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.ShipperService;
import jakarta.persistence.LockModeType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;

import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Các mục còn lại của đợt review bảo mật sau khi gộp nhánh ThanhChung.
 *
 * <ul>
 *   <li>#7 — đọc đơn để nạp/xoá/thu hồi phải khoá dòng ({@code SELECT ... FOR UPDATE});</li>
 *   <li>#8 — {@code depositPackage} phải đối chiếu chủ token với người đăng nhập;</li>
 *   <li>dọn code chết — {@code GET /api/shipper/suggest-lockers} đã gỡ.</li>
 * </ul>
 *
 * <p><b>KHÔNG {@code @Transactional} ở lớp:</b> ca khoá đồng thời cần dữ liệu đã commit để luồng
 * thứ hai nhìn thấy, nên tự dọn ở {@link #don()}.
 */
@SpringBootTest
class SecurityReviewFollowupTests {

    private static final String LOCKER = "LOCKER_HN_07";
    private static final String ORD_OVERDUE = "ORD-SRF-OVERDUE";
    private static final String ORD_PENDING = "ORD-SRF-PENDING";
    private static final String TOKEN_SHIPPER = "SHIP-SRF-OK";
    private static final String TOKEN_OTHER = "SHIP-SRF-OTHER";
    private static final String OTHER_USERNAME = "shipper-srf-khac";

    @Autowired private ShipperService shipperService;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private ShipperIdentityTokenRepository tokenRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private Compartment comp;

    @BeforeEach
    void setUp() {
        don();
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1)
                .orElseThrow(() -> new AssertionError("Seed phải có ngăn #1 của " + LOCKER));
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);
        User shipper = userRepository.findByUsername("shipper").orElseThrow();
        userRepository.save(User.builder()
                .username(OTHER_USERNAME).password("x").fullName("Shipper khác SRF")
                .phone("0912345177").role("SHIPPER").build());

        orderRepository.save(Order.builder()
                .orderId(ORD_OVERDUE).customerName("Khách SRF").customerPhone("0912345678")
                .deliveryType("LOCKER").locker(locker).compartment(comp)
                .expectedDate(LocalDate.now()).status("OVERDUE")
                .totalAmount(BigDecimal.valueOf(50000)).productName("Kiện SRF")
                .assignedShipper(shipper).build());
        orderRepository.save(Order.builder()
                .orderId(ORD_PENDING).customerName("Khách SRF").customerPhone("0912345678")
                .deliveryType("LOCKER").locker(locker)
                .expectedDate(LocalDate.now()).status("PENDING")
                .totalAmount(BigDecimal.valueOf(50000)).productName("Kiện SRF")
                .assignedShipper(shipper).build());

        LocalDateTime now = LocalDateTime.now();
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId("shipper").dynamicToken(TOKEN_SHIPPER)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
        tokenRepository.save(ShipperIdentityToken.builder()
                .shipperId(OTHER_USERNAME).dynamicToken(TOKEN_OTHER)
                .createdAt(now).expiredAt(now.plusMinutes(5))
                .isVerified(true).lockerId(LOCKER).build());
    }

    @AfterEach
    void don() {
        for (String t : new String[]{TOKEN_SHIPPER, TOKEN_OTHER}) {
            tokenRepository.findByDynamicToken(t).ifPresent(tokenRepository::delete);
        }
        for (String id : new String[]{ORD_OVERDUE, ORD_PENDING}) {
            orderRepository.findById(id).ifPresent(o -> {
                o.setCompartment(null);
                orderRepository.save(o);
                orderRepository.delete(o);
            });
        }
        userRepository.findByUsername(OTHER_USERNAME).ifPresent(userRepository::delete);
        compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).ifPresent(c -> {
            c.setStatus("EMPTY");
            compartmentRepository.save(c);
        });
    }

    private ShipperDTO.DepositPackageRequest yeuCauNap(String token) {
        return ShipperDTO.DepositPackageRequest.builder()
                .lockerId(LOCKER).orderId(ORD_PENDING).dynamicToken(token)
                .isDoorClosed(true).weightGrams(0.5).build();
    }

    @Test
    @DisplayName("#8: nạp hàng bằng token của shipper KHÁC → 403, đơn vẫn PENDING")
    void napBangTokenCuaNguoiKhacBiChan() {
        AccessDeniedException ex = assertThrows(AccessDeniedException.class,
                () -> shipperService.depositPackage(yeuCauNap(TOKEN_OTHER), "shipper"));
        assertTrue(ex.getMessage().contains("không thuộc tài khoản đang đăng nhập"), ex.getMessage());
        assertEquals("PENDING", orderRepository.findById(ORD_PENDING).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("#8: shipper khác cầm token của mình cũng không nạp được đơn không giao cho họ")
    void tokenDungNguoiNhungDonKhongDuocGiao() {
        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> shipperService.depositPackage(yeuCauNap(TOKEN_OTHER), OTHER_USERNAME));
        assertTrue(ex.getMessage().contains("chưa được phân công"), ex.getMessage());
        assertEquals("PENDING", orderRepository.findById(ORD_PENDING).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("#8: thiếu người đăng nhập (principal null) → 403")
    void napKhongCoNguoiDangNhapBiChan() {
        assertThrows(AccessDeniedException.class,
                () -> shipperService.depositPackage(yeuCauNap(TOKEN_SHIPPER), null));
    }

    @Test
    @DisplayName("#7: repository khoá đơn bằng PESSIMISTIC_WRITE")
    void repositoryKhoaBiQuan() throws NoSuchMethodException {
        Method m = OrderRepository.class.getMethod("findByIdForUpdate", String.class);
        Lock lock = m.getAnnotation(Lock.class);
        assertNotNull(lock, "findByIdForUpdate phải có @Lock");
        assertEquals(LockModeType.PESSIMISTIC_WRITE, lock.value());
    }

    @Test
    @DisplayName("#7: thu hồi chờ transaction đang khoá đơn commit rồi mới kiểm trạng thái → 409")
    void thuHoiChoKhoaDonRoiDocLaiTrangThai() throws Exception {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        CountDownLatch daKhoa = new CountDownLatch(1);
        CountDownLatch thaKhoa = new CountDownLatch(1);

        // Luồng A giữ khoá dòng đơn (giả lập một lần thu hồi khác đang chạy), rồi chốt COMPLETED.
        CompletableFuture<Void> luongA = CompletableFuture.runAsync(() -> tx.executeWithoutResult(s -> {
            Order o = orderRepository.findByIdForUpdate(ORD_OVERDUE).orElseThrow();
            daKhoa.countDown();
            try {
                assertTrue(thaKhoa.await(10, TimeUnit.SECONDS));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
            o.setStatus("COMPLETED");
            orderRepository.save(o);
        }));
        assertTrue(daKhoa.await(10, TimeUnit.SECONDS), "Luồng A phải lấy được khoá");

        // Luồng B: thu hồi cùng đơn. Có khoá thì B phải ĐỨNG CHỜ, không đọc ngay trạng thái OVERDUE cũ.
        CompletableFuture<Void> luongB = CompletableFuture.runAsync(
                () -> shipperService.recallOverduePackage(ORD_OVERDUE, TOKEN_SHIPPER, "shipper"));
        Thread.sleep(700);
        assertFalse(luongB.isDone(), "Thu hồi phải chờ khoá dòng đơn, không được chạy song song");

        thaKhoa.countDown();
        luongA.get(10, TimeUnit.SECONDS);

        ExecutionException ex = assertThrows(ExecutionException.class, () -> luongB.get(15, TimeUnit.SECONDS));
        assertInstanceOf(BusinessException.class, ex.getCause(),
                "Sau khi A commit, B phải đọc lại COMPLETED và trả 409: " + ex.getCause());
        assertEquals("COMPLETED", orderRepository.findById(ORD_OVERDUE).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("#7: xoá đơn PENDING cũng chờ khoá dòng đơn")
    void xoaDonChoKhoa() throws Exception {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        CountDownLatch daKhoa = new CountDownLatch(1);
        CountDownLatch thaKhoa = new CountDownLatch(1);

        // Luồng A giả lập admin đang chuyển phân công đơn sang shipper khác.
        CompletableFuture<Void> luongA = CompletableFuture.runAsync(() -> tx.executeWithoutResult(s -> {
            Order o = orderRepository.findByIdForUpdate(ORD_PENDING).orElseThrow();
            daKhoa.countDown();
            try {
                assertTrue(thaKhoa.await(10, TimeUnit.SECONDS));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
            o.setAssignedShipper(userRepository.findByUsername(OTHER_USERNAME).orElseThrow());
            orderRepository.save(o);
        }));
        assertTrue(daKhoa.await(10, TimeUnit.SECONDS));

        CompletableFuture<Void> luongB = CompletableFuture.runAsync(
                () -> shipperService.deletePendingOrder(ORD_PENDING, "shipper"));
        Thread.sleep(700);
        assertFalse(luongB.isDone(), "Xoá đơn phải chờ khoá dòng đơn");

        thaKhoa.countDown();
        luongA.get(10, TimeUnit.SECONDS);

        ExecutionException ex = assertThrows(ExecutionException.class, () -> luongB.get(15, TimeUnit.SECONDS));
        assertInstanceOf(IllegalArgumentException.class, ex.getCause(),
                "Shipper cũ không còn quyền xoá sau khi đơn đã chuyển: " + ex.getCause());
        assertTrue(orderRepository.findById(ORD_PENDING).isPresent(), "Đơn không được bị xoá");
    }

    @Test
    @DisplayName("Dọn code chết: ShipperController không còn GET /suggest-lockers")
    void khongConEndpointGoiYTu() {
        boolean conEndpoint = Arrays.stream(ShipperController.class.getDeclaredMethods())
                .map(m -> m.getAnnotation(GetMapping.class))
                .filter(a -> a != null)
                .flatMap(a -> Arrays.stream(a.value()))
                .anyMatch(p -> p.contains("suggest-lockers"));
        assertFalse(conEndpoint);
    }
}
