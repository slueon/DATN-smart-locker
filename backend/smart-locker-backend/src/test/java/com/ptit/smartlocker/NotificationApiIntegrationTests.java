package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import com.ptit.smartlocker.service.NotificationService;
import com.ptit.smartlocker.service.OverdueSchedulerService;
import com.ptit.smartlocker.service.PickupService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * GĐ64a — integration: HTTP THẬT qua {@code TokenAuthFilter} + {@code SecurityConfig}
 * ({@code RANDOM_PORT}, Bearer token lưu trong {@code auth_sessions}).
 *
 * <p>Không {@code @Transactional}: request chạy trên thread khác nên dữ liệu phải được commit; mọi
 * dòng tạo ra được dọn ở {@link #tearDown}. Mọi đơn test dùng tủ ẢO {@code LOCKER_HN_02}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class NotificationApiIntegrationTests {

    private static final String LOCKER = "LOCKER_HN_02";
    private static final String PHONE_A = "0990640001";
    private static final String PHONE_B = "0990640002";
    private static final String PHONE_S = "0990640003";

    @Value("${local.server.port}") private int port;

    @Autowired private NotificationService notificationService;
    @Autowired private NotificationRepository notificationRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private AuthSessionRepository authSessionRepository;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private PickupService pickupService;
    @Autowired private OverdueSchedulerService overdueSchedulerService;
    @Autowired private ShipperService shipperService;
    @Autowired private PlatformTransactionManager txManager;

    private final HttpClient http = HttpClient.newHttpClient();
    private User userA, userB, userS, userS2;
    private String tokenA, tokenB, tokenS;

    @BeforeEach
    void setUp() {
        tearDown();
        userA = saveUser("gd64a_khach_a", PHONE_A, "CUSTOMER");
        userB = saveUser("gd64a_khach_b", PHONE_B, "CUSTOMER");
        userS = saveUser("gd64a_shipper", PHONE_S, "SHIPPER");
        userS2 = saveUser("gd64a_shipper_2", "0990640004", "SHIPPER");
        tokenA = saveSession(userA, "GD64A-TOKEN-A");
        tokenB = saveSession(userB, "GD64A-TOKEN-B");
        tokenS = saveSession(userS, "GD64A-TOKEN-S");
    }

    @AfterEach
    void tearDown() {
        notificationRepository.findAll().stream()
                .filter(n -> PHONE_A.equals(n.getRecipientPhone()) || PHONE_B.equals(n.getRecipientPhone())
                        || PHONE_S.equals(n.getRecipientPhone()) || "0990640004".equals(n.getRecipientPhone())
                        || "SHIPPER".equals(n.getRecipientRole())
                        || (n.getOrderId() != null && n.getOrderId().startsWith("ORD-GD64A")))
                .forEach(notificationRepository::delete);
        orderRepository.findAll().stream()
                .filter(o -> o.getOrderId().startsWith("ORD-GD64A"))
                .forEach(orderRepository::delete);
        authSessionRepository.findAll().stream()
                .filter(s -> s.getToken().startsWith("GD64A-TOKEN"))
                .forEach(authSessionRepository::delete);
        userRepository.findAll().stream()
                .filter(u -> u.getUsername().startsWith("gd64a_"))
                .forEach(userRepository::delete);
        resetCompartment(1);
        resetCompartment(2);
    }

    // ------------------------------------------------------------------ API

    @Test
    @DisplayName("GĐ64a API: chỉ thấy của mình; tham số phone giả không có tác dụng; chưa đăng nhập ⇒ 401")
    void chiThayCuaMinh() throws Exception {
        notificationService.notify("PICKUP_SUCCESS", PHONE_A, null, "ORD-GD64A-1", null, "A1", "của A");
        notificationService.notify("PICKUP_SUCCESS", PHONE_B, null, "ORD-GD64A-2", null, "B1", "của B");
        notificationService.notify("OVERDUE_ALERT", PHONE_S, null, "ORD-GD64A-3", null, "S1", "của shipper");
        notificationService.notify("OVERDUE_ALERT", null, "SHIPPER", "ORD-GD64A-LEGACY", null,
                "Thông báo cũ", "broadcast cũ");

        HttpResponse<String> a = get("/api/notifications?phone=" + PHONE_B + "&role=SHIPPER", tokenA);
        assertEquals(200, a.statusCode());
        assertTrue(a.body().contains("ORD-GD64A-1"), a.body());
        assertFalse(a.body().contains("ORD-GD64A-2"), "Khách A KHÔNG được thấy thông báo của B: " + a.body());
        assertFalse(a.body().contains("ORD-GD64A-3"), "Khách A KHÔNG được thấy thông báo vai SHIPPER");
        assertTrue(a.body().contains("\"unreadCount\":1"), a.body());

        HttpResponse<String> s = get("/api/notifications", tokenS);
        assertEquals(200, s.statusCode());
        assertTrue(s.body().contains("ORD-GD64A-3"), s.body());
        assertFalse(s.body().contains("ORD-GD64A-LEGACY"),
                "Thông báo thu hồi broadcast cũ không được hiện cho toàn bộ shipper");
        assertFalse(s.body().contains("ORD-GD64A-1"));

        assertEquals(401, get("/api/notifications", null).statusCode());
    }

    @Test
    @DisplayName("GĐ64a API: đọc thông báo của người khác ⇒ 404 và không đổi; của mình ⇒ 200; read-all đếm đúng")
    void docCuaNguoiKhac404() throws Exception {
        notificationService.notify("PICKUP_SUCCESS", PHONE_A, null, "ORD-GD64A-1", null, "A1", "của A");
        notificationService.notify("PICKUP_SUCCESS", PHONE_B, null, "ORD-GD64A-2", null, "B1", "của B");
        notificationService.notify("DEPOSIT_SUCCESS", PHONE_B, null, "ORD-GD64A-4", "qr", "B2", "của B");
        Notification ofA = only(PHONE_A);
        Long idOfB = rowsFor(PHONE_B).get(0).getId();

        assertEquals(404, post("/api/notifications/" + idOfB + "/read", tokenA).statusCode());
        assertFalse(notificationRepository.findById(idOfB).orElseThrow().getIsRead(),
                "404 nhưng vẫn đánh dấu là lỗ IDOR");
        assertEquals(404, post("/api/notifications/999999999/read", tokenA).statusCode(),
                "id không tồn tại cũng 404 — giống hệt id của người khác");

        assertEquals(200, post("/api/notifications/" + ofA.getId() + "/read", tokenA).statusCode());
        assertTrue(notificationRepository.findById(ofA.getId()).orElseThrow().getIsRead());

        HttpResponse<String> all = post("/api/notifications/read-all", tokenB);
        assertEquals(200, all.statusCode());
        assertTrue(all.body().contains("\"updated\":2"), all.body());
        assertTrue(get("/api/notifications", tokenB).body().contains("\"unreadCount\":0"));
    }

    // ------------------------------------------------------------- chống trùng / lỗi

    @Test
    @DisplayName("GĐ64a: cùng type+đơn+người nhận trong 60 s ⇒ chỉ 1 dòng; khác method ⇒ dòng mới")
    void chongTrung() {
        assertTrue(notificationService.notify("DEPOSIT_SUCCESS", PHONE_A, null, "ORD-GD64A-D", "qr", "t", "m"));
        assertFalse(notificationService.notify("DEPOSIT_SUCCESS", PHONE_A, null, "ORD-GD64A-D", "qr", "t", "m"));
        assertTrue(notificationService.notify("DEPOSIT_SUCCESS", PHONE_A, null, "ORD-GD64A-D", "otp", "t", "m"));
        assertEquals(2, countFor(PHONE_A));
    }

    @Test
    @DisplayName("GĐ64a: notify lỗi (type NULL vi phạm NOT NULL) ⇒ không ném, giao dịch ngoài KHÔNG bị rollback-only")
    void loiKhongLamHongGiaoDichNgoai() {
        Boolean rollbackOnly = new TransactionTemplate(txManager).execute(status -> {
            assertFalse(notificationService.notify(null, PHONE_A, null, "ORD-GD64A-E", null, "t", "m"));
            return status.isRollbackOnly();
        });
        assertEquals(Boolean.FALSE, rollbackOnly);
        assertEquals(0, countFor(PHONE_A));
    }

    // ------------------------------------------------------------- điểm phát

    @Test
    @DisplayName("GĐ64a điểm phát: chốt lấy hàng còn hàng ⇒ PICKUP_LEFT_BEHIND; hết hàng ⇒ PICKUP_SUCCESS (đúng 1 dòng)")
    void diemPhatPickup() {
        Order o = saveOrder("ORD-GD64A-P", 1, "PICKUP_OPENED", null);
        Compartment c = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();

        pickupService.chotPhienLayHang(o, c, true);
        Order sau = orderRepository.findById("ORD-GD64A-P").orElseThrow();
        pickupService.chotPhienLayHang(sau, c, false);
        // Mô phỏng đường thứ hai (MQTT `pickup_success`) bắn cùng sự kiện ngay sau đó.
        notificationService.pickupSuccess(sau);

        List<Notification> rows = rowsFor(PHONE_A);
        assertEquals(1, rows.stream().filter(n -> "PICKUP_LEFT_BEHIND".equals(n.getType())).count());
        assertEquals(1, rows.stream().filter(n -> "PICKUP_SUCCESS".equals(n.getType())).count(),
                "API + MQTT cùng chốt vẫn chỉ 1 thông báo PICKUP_SUCCESS");
    }

    @Test
    @DisplayName("Đóng ngăn không có hàng: thông báo thất bại chỉ gửi shipper được phân công")
    void diemPhatDepositFailedToAssignedShipper() {
        Order order = saveOrder("ORD-GD64A-DF", 1, "PENDING_OPENED", null);
        order.setAssignedShipper(userS);
        orderRepository.save(order);
        Compartment compartment = compartmentRepository
                .findByLocker_LockerIdAndCompIndex(LOCKER, 1).orElseThrow();

        assertFalse(shipperService.chotPhienNapHang(order, compartment, false));

        List<Notification> shipperRows = rowsFor(PHONE_S).stream()
                .filter(n -> "ORD-GD64A-DF".equals(n.getOrderId())).toList();
        assertEquals(1, shipperRows.size());
        assertEquals("DEPOSIT_FAILED", shipperRows.get(0).getType());
        assertTrue(rowsFor("0990640004").stream()
                .noneMatch(n -> "ORD-GD64A-DF".equals(n.getOrderId())));
    }

    @Test
    @DisplayName("Quá hạn và phân công: thông báo chỉ gửi tới shipper được giao, không phát theo vai trò")
    void diemPhatOverdue() {
        Order assigned = saveOrder("ORD-GD64A-O", 1, "DEPOSITED", LocalDateTime.now().minusHours(1));
        assigned.setAssignedShipper(userS);
        orderRepository.save(assigned);
        saveOrder("ORD-GD64A-UNASSIGNED", 2, "DEPOSITED", LocalDateTime.now().minusHours(1));

        overdueSchedulerService.scanAndLockOverdueOrders();

        assertEquals("OVERDUE", orderRepository.findById("ORD-GD64A-O").orElseThrow().getStatus());
        List<Notification> all = notificationRepository.findAll().stream()
                .filter(n -> "ORD-GD64A-O".equals(n.getOrderId())).toList();
        assertEquals(1, all.stream().filter(n -> "OVERDUE_CUSTOMER".equals(n.getType())
                && PHONE_A.equals(n.getRecipientPhone())).count());
        assertEquals(1, all.stream().filter(n -> "OVERDUE_ALERT".equals(n.getType())
                && PHONE_S.equals(n.getRecipientPhone())
                && n.getRecipientRole() == null).count());
        assertTrue(notificationRepository.findAll().stream()
                .noneMatch(n -> "ORD-GD64A-UNASSIGNED".equals(n.getOrderId())
                        && "OVERDUE_ALERT".equals(n.getType())
                        && "SHIPPER".equals(n.getRecipientRole())),
                "Đơn chưa được phân công không được phát thông báo chung cho mọi shipper");

        shipperService.assignShipperByAdmin("ORD-GD64A-UNASSIGNED", userS2.getId(), null);
        assertEquals(1, notificationRepository.findAll().stream()
                .filter(n -> "ORD-GD64A-UNASSIGNED".equals(n.getOrderId())
                        && "OVERDUE_ALERT".equals(n.getType())
                        && "0990640004".equals(n.getRecipientPhone())
                        && n.getRecipientRole() == null).count(),
                "Khi admin phân công đơn đã quá hạn, shipper mới phải nhận thông báo riêng");
    }

    // ------------------------------------------------------------------ tiện ích

    private User saveUser(String username, String phone, String role) {
        return userRepository.save(User.builder().username(username).password("x")
                .fullName("GĐ64a " + username).phone(phone).role(role).build());
    }

    private String saveSession(User u, String token) {
        authSessionRepository.save(AuthSession.builder().token(token).user(u).role(u.getRole())
                .expiresAt(LocalDateTime.now().plusHours(1)).revoked(false).build());
        return token;
    }

    private Order saveOrder(String id, int compIndex, String status, LocalDateTime expiry) {
        Locker locker = lockerRepository.findById(LOCKER).orElseThrow();
        Compartment comp = compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, compIndex).orElseThrow();
        comp.setStatus("OCCUPIED");
        compartmentRepository.save(comp);
        return orderRepository.save(Order.builder()
                .orderId(id).customerName("Khách GĐ64a").customerPhone(PHONE_A)
                .deliveryType("LOCKER").locker(locker).compartment(comp)
                .expectedDate(LocalDate.now()).status(status)
                .depositedAt(LocalDateTime.now().minusDays(1)).expiryDeadline(expiry)
                .totalAmount(BigDecimal.valueOf(1000)).productName("Kiện GĐ64a").build());
    }

    private void resetCompartment(int idx) {
        compartmentRepository.findByLocker_LockerIdAndCompIndex(LOCKER, idx).ifPresent(c -> {
            c.setStatus("EMPTY");
            compartmentRepository.save(c);
        });
    }

    private List<Notification> rowsFor(String phone) {
        return notificationRepository.findAll().stream()
                .filter(n -> phone.equals(n.getRecipientPhone())).toList();
    }

    private long countFor(String phone) {
        return rowsFor(phone).size();
    }

    private Notification only(String phone) {
        List<Notification> rows = rowsFor(phone);
        assertEquals(1, rows.size());
        return rows.get(0);
    }

    private HttpResponse<String> get(String path, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
        if (token != null) b.header("Authorization", "Bearer " + token);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .POST(HttpRequest.BodyPublishers.noBody());
        if (token != null) b.header("Authorization", "Bearer " + token);
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }
}
