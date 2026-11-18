package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.NotificationDTO;
import com.ptit.smartlocker.entity.Notification;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.exception.ResourceNotFoundException;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.NotificationRepository;
import com.ptit.smartlocker.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

/**
 * GĐ64a — THÔNG BÁO THẬT Ở MÁY CHỦ.
 *
 * <h2>Không bao giờ làm hỏng giao dịch chính</h2>
 * <p>{@link #notify} được gọi giữa luồng nạp/lấy/thu hồi. Nếu ghi thông báo lỗi (DB chập chờn,
 * chuỗi quá dài…) mà ném ra ngoài thì đơn hàng bị rollback — tức tủ đã mở/đóng mà DB không đổi.
 * Vì vậy: ghi trong giao dịch RIÊNG ({@code REQUIRES_NEW}, qua {@link TransactionTemplate} để không
 * dính bẫy tự-gọi của proxy {@code @Transactional}), mọi lỗi ⇒ log WARN rồi nuốt.
 *
 * <h2>Chống trùng 60 giây</h2>
 * <p>{@code deposit_success} bắn từ cả {@code MqttService} (firmware báo) lẫn {@code ShipperService}
 * (đường API); {@code PICKUP_SUCCESS} cũng có 2 đường. Bỏ qua nếu đã có dòng cùng
 * {@code type + orderId + người nhận + method} trong {@value #DEDUPE_SECONDS} giây. Kiểm-rồi-ghi
 * nằm trong {@code synchronized} để 2 thread (Paho callback + HTTP) không cùng lọt qua.
 * {@code method} nằm trong khoá để khách đổi QR → OTP trên tủ vẫn nhận được thông báo thứ hai.
 */
@Slf4j
@Service
public class NotificationService {

    public static final String DEPOSIT_SUCCESS = "DEPOSIT_SUCCESS";
    public static final String DEPOSIT_LEFT_EMPTY = "DEPOSIT_LEFT_EMPTY";
    public static final String KIOSK_METHOD_CHOSEN = "KIOSK_METHOD_CHOSEN";
    public static final String PICKUP_SUCCESS = "PICKUP_SUCCESS";
    public static final String PICKUP_LEFT_BEHIND = "PICKUP_LEFT_BEHIND";
    public static final String OVERDUE_CUSTOMER = "OVERDUE_CUSTOMER";
    public static final String OVERDUE_ALERT = "OVERDUE_ALERT";
    public static final String RECALLED = "RECALLED";
    public static final String RECALL_SUCCESS = "RECALL_SUCCESS";

    public static final String ROLE_SHIPPER = "SHIPPER";

    static final int DEDUPE_SECONDS = 60;
    static final int MAX_ITEMS = 50;

    private final NotificationRepository notificationRepository;
    private final UserRepository userRepository;
    private final LockerRepository lockerRepository;
    private final TransactionTemplate requiresNew;
    private final Object writeLock = new Object();

    public NotificationService(NotificationRepository notificationRepository,
                               UserRepository userRepository,
                               LockerRepository lockerRepository,
                               PlatformTransactionManager transactionManager) {
        this.notificationRepository = notificationRepository;
        this.userRepository = userRepository;
        this.lockerRepository = lockerRepository;
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    // ------------------------------------------------------------------ ghi

    /**
     * Ghi 1 thông báo. KHÔNG BAO GIỜ ném lỗi.
     *
     * @return {@code true} nếu đã ghi dòng mới; {@code false} nếu trùng, thiếu người nhận hoặc lỗi
     */
    public boolean notify(String type, String recipientPhone, String recipientRole,
                          String orderId, String method, String title, String message) {
        try {
            String phone = blankToNull(recipientPhone);
            String role = blankToNull(recipientRole);
            if (phone == null && role == null) {
                log.warn("Bỏ thông báo {} đơn {}: không có người nhận", type, orderId);
                return false;
            }
            synchronized (writeLock) {
                Boolean written = requiresNew.execute(status -> {
                    LocalDateTime now = LocalDateTime.now();
                    if (notificationRepository.existsRecent(type, orderId, phone, role, method,
                            now.minusSeconds(DEDUPE_SECONDS))) {
                        log.debug("Bỏ thông báo trùng {} đơn {} ({}/{})", type, orderId, phone, role);
                        return false;
                    }
                    notificationRepository.save(Notification.builder()
                            .recipientPhone(phone)
                            .recipientRole(role)
                            .type(type)
                            .title(cut(title, 200))
                            .message(cut(message, 1000))
                            .orderId(orderId)
                            .method(method)
                            .isRead(false)
                            .createdAt(now)
                            .build());
                    return true;
                });
                return Boolean.TRUE.equals(written);
            }
        } catch (RuntimeException ex) {
            log.warn("Không ghi được thông báo {} đơn {}: {}", type, orderId, ex.toString());
            return false;
        }
    }

    // ------------------------------------------------------- điểm phát nghiệp vụ
    // Nội dung tiếng Việt theo đúng câu frontend đang dùng (CustomerPickupTab / ShipperRecallTab /
    // store.js). Mỗi hàm tự bọc try/catch: đọc quan hệ LAZY của Order cũng có thể ném lỗi.

    /** Nạp xong ⇒ khách. */
    public void depositSuccess(Order order, Integer compIndex) {
        try {
            if (order == null) return;
            notify(DEPOSIT_SUCCESS, order.getCustomerPhone(), null, order.getOrderId(), "qr",
                    "Bưu kiện đã về tủ",
                    "Kiện hàng" + productPart(order) + " đã được nạp vào tủ" + lockerPart(order)
                            + (compIndex != null ? " ngăn #" + compIndex : "")
                            + ". Bấm để xem mã QR/OTP mở tủ.");
        } catch (RuntimeException ex) {
            log.warn("depositSuccess: {}", ex.toString());
        }
    }

    /** Shipper quên nạp: ngăn đã trả lại nhưng kiện hàng chưa được bỏ vào tủ. */
    public void depositLeftEmpty(Order order, Integer compIndex) {
        try {
            if (order == null) return;
            notify(DEPOSIT_LEFT_EMPTY, null, ROLE_SHIPPER, order.getOrderId(), null,
                    "Bạn quên nạp hàng",
                    "Ngăn" + (compIndex != null ? " #" + compIndex : "")
                            + " đã trả lại. Vui lòng nạp lại kiện hàng.");
        } catch (RuntimeException ex) {
            log.warn("depositLeftEmpty: {}", ex.toString());
        }
    }

    /**
     * Khách chọn cách nhận trên màn hình tủ ⇒ khách.
     *
     * <p>Bản tin {@code receive/method} KHÔNG mang mã đơn, nên người nhận suy từ các đơn
     * {@code DEPOSITED} đang nằm ở tủ đó. Chỉ gửi khi các đơn đó thuộc ĐÚNG 1 khách — nếu nhiều
     * khách cùng có hàng ở tủ thì không đoán (gửi nhầm còn tệ hơn không gửi); web khách vẫn có
     * kiosk-events để tự xử lý như trước.
     */
    public void kioskMethodChosen(String lockerId, String method, List<Order> depositedAtLocker) {
        try {
            if (depositedAtLocker == null || depositedAtLocker.isEmpty()) return;
            List<String> phones = depositedAtLocker.stream()
                    .map(Order::getCustomerPhone).filter(Objects::nonNull).distinct().toList();
            if (phones.size() != 1) {
                log.info("KIOSK_METHOD_CHOSEN tại {}: {} khách có hàng — không gửi thông báo",
                        lockerId, phones.size());
                return;
            }
            Order single = depositedAtLocker.size() == 1 ? depositedAtLocker.get(0) : null;
            String label = "qr".equals(method) ? "mã QR" : "mã OTP";
            Integer comp = single != null && single.getCompartment() != null
                    ? single.getCompartment().getCompIndex() : null;
            notify(KIOSK_METHOD_CHOSEN, phones.get(0), null,
                    single != null ? single.getOrderId() : null, method,
                    "Tủ yêu cầu nhận hàng bằng " + label,
                    "Bấm để xem " + label + " và mở ngăn #" + (comp != null ? comp : "—") + ".");
        } catch (RuntimeException ex) {
            log.warn("kioskMethodChosen: {}", ex.toString());
        }
    }

    /** Lấy xong ⇒ khách. */
    public void pickupSuccess(Order order) {
        try {
            if (order == null) return;
            notify(PICKUP_SUCCESS, order.getCustomerPhone(), null, order.getOrderId(), null,
                    "Lấy hàng thành công",
                    "Kiện hàng" + productPart(order) + " đã được lấy khỏi tủ.");
        } catch (RuntimeException ex) {
            log.warn("pickupSuccess: {}", ex.toString());
        }
    }

    /** Cửa đóng nhưng hàng còn trong tủ ⇒ khách. */
    public void pickupLeftBehind(Order order, String message) {
        try {
            if (order == null) return;
            notify(PICKUP_LEFT_BEHIND, order.getCustomerPhone(), null, order.getOrderId(), "qr",
                    "Bạn quên lấy hàng — dùng mã mới", message);
        } catch (RuntimeException ex) {
            log.warn("pickupLeftBehind: {}", ex.toString());
        }
    }

    /** Quá hạn ⇒ khách + SHIPPER. */
    public void overdue(Order order) {
        try {
            if (order == null) return;
            String lockerName = lockerName(order);
            notify(OVERDUE_CUSTOMER, order.getCustomerPhone(), null, order.getOrderId(), null,
                    "⚠️ Bưu kiện quá hạn lưu kho",
                    "Bưu kiện " + order.getOrderId() + " tại " + lockerName
                            + " đã quá hạn lưu kho 24h00. Mã mở tủ đã tạm khóa. Shipper sẽ tiến hành thu hồi về kho bãi.");
            notify(OVERDUE_ALERT, null, ROLE_SHIPPER, order.getOrderId(), null,
                    "🚨 Lệnh Thu Hồi Bưu Kiện Quá Hạn!",
                    "Phát hiện bưu kiện " + order.getOrderId() + " tại " + lockerName + " - Ngăn #"
                            + compIndex(order) + " đã quá hạn lưu kho. Vui lòng tới trạm thu hồi để giải phóng ngăn tủ!");
        } catch (RuntimeException ex) {
            log.warn("overdue: {}", ex.toString());
        }
    }

    /** Thu hồi xong ⇒ khách + SHIPPER. */
    public void recalled(Order order) {
        try {
            if (order == null) return;
            String lockerName = lockerName(order);
            notify(RECALLED, order.getCustomerPhone(), null, order.getOrderId(), null,
                    "Bưu kiện đã được thu hồi về kho bãi",
                    "Đơn hàng " + order.getOrderId() + " tại " + lockerName
                            + " đã được Shipper thu hồi về kho do vượt quá hạn lưu kho 24h00. Vui lòng liên hệ hotline/quản trị viên để nhận lại bưu phẩm.");
            notify(RECALL_SUCCESS, null, ROLE_SHIPPER, order.getOrderId(), null,
                    "Đã giải phóng ngăn tủ thành công",
                    "Đã thu hồi thành công bưu kiện " + order.getOrderId() + " tại " + lockerName
                            + " - Ngăn #" + compIndex(order)
                            + ". Ngăn tủ đã được giải phóng thành EMPTY sẵn sàng nhận đơn mới!");
        } catch (RuntimeException ex) {
            log.warn("recalled: {}", ex.toString());
        }
    }

    // ------------------------------------------------------------------ đọc (API)

    @Transactional(readOnly = true)
    public NotificationDTO.ListResponse listMine(String username) {
        User me = requireUser(username);
        List<NotificationDTO.Item> items = notificationRepository
                .findMine(me.getPhone(), me.getRole(), PageRequest.of(0, MAX_ITEMS)).stream()
                .map(NotificationService::toItem)
                .toList();
        long unread = notificationRepository.countUnreadMine(me.getPhone(), me.getRole());
        return NotificationDTO.ListResponse.builder().items(items).unreadCount(unread).build();
    }

    /** Không phải của mình ⇒ 404 giống hệt "không tồn tại" (không lộ id có thật). */
    @Transactional
    public void markRead(String username, Long id) {
        User me = requireUser(username);
        Notification n = notificationRepository.findById(id)
                .filter(x -> isMine(x, me))
                .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy thông báo"));
        if (!Boolean.TRUE.equals(n.getIsRead())) {
            n.setIsRead(true);
            notificationRepository.save(n);
        }
    }

    @Transactional
    public int markAllRead(String username) {
        User me = requireUser(username);
        return notificationRepository.markAllReadMine(me.getPhone(), me.getRole());
    }

    // ------------------------------------------------------------------ tiện ích

    private User requireUser(String username) {
        if (username == null) {
            throw new ResourceNotFoundException("Không tìm thấy người dùng");
        }
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy người dùng"));
    }

    static boolean isMine(Notification n, User me) {
        return (n.getRecipientPhone() != null && n.getRecipientPhone().equals(me.getPhone()))
                || (n.getRecipientRole() != null && me.getRole() != null
                && n.getRecipientRole().equalsIgnoreCase(me.getRole()));
    }

    private static NotificationDTO.Item toItem(Notification n) {
        return NotificationDTO.Item.builder()
                .id(n.getId())
                .type(n.getType())
                .title(n.getTitle())
                .message(n.getMessage())
                .orderId(n.getOrderId())
                .method(n.getMethod())
                .isRead(Boolean.TRUE.equals(n.getIsRead()))
                .createdAt(n.getCreatedAt())
                .build();
    }

    private static String productPart(Order order) {
        String p = order.getProductName();
        return p == null || p.isBlank() ? "" : " \"" + p + "\"";
    }

    private String lockerPart(Order order) {
        String name = safeLockerName(order);
        return name == null ? "" : " " + name;
    }

    private String lockerName(Order order) {
        String name = safeLockerName(order);
        if (name != null) return name;
        String id = safeLockerId(order);
        return id != null ? id : "tủ";
    }

    /**
     * Tên tủ tra qua repository theo id, KHÔNG gọi {@code order.getLocker().getName()}: luồng MQTT
     * chạy ngoài transaction, {@code locker} là proxy LAZY ⇒ đọc tên sẽ ném
     * LazyInitializationException và mất thông báo. Đọc id của proxy thì không cần nạp.
     */
    private String safeLockerName(Order order) {
        try {
            String id = safeLockerId(order);
            if (id == null) return null;
            return lockerRepository.findById(id)
                    .map(l -> l.getName())
                    .filter(n -> n != null && !n.isBlank())
                    .orElse(null);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String safeLockerId(Order order) {
        try {
            return order.getLocker() != null ? order.getLocker().getLockerId() : null;
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private static String compIndex(Order order) {
        try {
            return order.getCompartment() != null && order.getCompartment().getCompIndex() != null
                    ? String.valueOf(order.getCompartment().getCompIndex()) : "—";
        } catch (RuntimeException ex) {
            return "—"; // proxy LAZY ngoài transaction — không để mất thông báo vì số ngăn
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String cut(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }
}
