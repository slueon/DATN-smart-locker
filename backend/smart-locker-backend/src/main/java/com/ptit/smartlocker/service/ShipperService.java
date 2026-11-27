package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class ShipperService {

    private final ShipperIdentityTokenRepository tokenRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;
    private final PickupCredentialRepository credentialRepository;
    private final DeviceEventRepository deviceEventRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;
    private final LockerRepository lockerRepository;
    private final UserRepository userRepository;

    @Autowired(required = false)
    @Lazy
    private MqttService mqttService;

    /**
     * GĐ42 — bộ đệm sự kiện Kiosk, để báo cho web khi shipper quên nạp hàng.
     *
     * <p><b>Vì sao {@code required = false} + {@code @Lazy}:</b> {@code KioskEventService} là bean
     * đơn giản (không phụ thuộc ngược lại), nhưng dùng đúng mẫu của {@code mqttService} ở trên để
     * <b>không tạo vòng phụ thuộc cứng</b> nếu sau này KioskEventService có thêm phụ thuộc
     * (điều cấm #5 của thẻ GĐ42). Luôn guard {@code != null} khi dùng.
     */
    @Autowired(required = false)
    @Lazy
    private KioskEventService kioskEventService;

    /** GĐ64a — thông báo máy chủ (tự nuốt lỗi). Cùng mẫu tiêm với {@code kioskEventService}. */
    @Autowired(required = false)
    @Lazy
    private NotificationService notificationService;

    public ShipperService(
            ShipperIdentityTokenRepository tokenRepository,
            OrderRepository orderRepository,
            CompartmentRepository compartmentRepository,
            PickupCredentialRepository credentialRepository,
            DeviceEventRepository deviceEventRepository,
            LockerSlotScheduleRepository slotScheduleRepository,
            LockerRepository lockerRepository,
            UserRepository userRepository) {
        this.tokenRepository = tokenRepository;
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
        this.credentialRepository = credentialRepository;
        this.deviceEventRepository = deviceEventRepository;
        this.slotScheduleRepository = slotScheduleRepository;
        this.lockerRepository = lockerRepository;
        this.userRepository = userRepository;
    }

    /**
     * GĐ21 — danh sách KHÁCH HÀNG để shipper chọn khi tạo đơn hộ.
     *
     * <p><b>Vì sao phải là endpoint chứ không hard-code:</b> trước đây nút "+ Thêm đơn" ghi cứng
     * tên/SĐT của một khách, nên mọi đơn tạo từ màn shipper đều gán cho đúng người đó bất kể khách
     * thật là ai. Danh sách phải đọc từ CSDL để tài khoản tạo thêm sau này cũng hiện ra.
     *
     * <p>Chỉ trả {@code userId}, {@code fullName}, {@code phone} — <b>không</b> {@code password},
     * {@code role}, {@code createdAt}. Sắp theo tên để hộp chọn có thứ tự ổn định.
     */
    @Transactional(readOnly = true)
    public List<ShipperDTO.CustomerOptionResponse> getCustomerOptions() {
        return userRepository.findByRole("CUSTOMER").stream()
                .sorted(java.util.Comparator
                        .comparing((User u) -> u.getFullName() == null ? "" : u.getFullName(),
                                java.util.Comparator.naturalOrder())
                        .thenComparing(u -> u.getId() == null ? 0L : u.getId()))
                .map(u -> ShipperDTO.CustomerOptionResponse.builder()
                        .userId(u.getId())
                        // GĐ51 — trả `username` để UI có KHOÁ DUY NHẤT (họ tên có thể trùng).
                        .username(u.getUsername())
                        .fullName(u.getFullName())
                        .phone(u.getPhone())
                        .build())
                .toList();
    }

    @Transactional(readOnly = true)
    public List<ShipperDTO.ShipperOptionResponse> getShipperOptions() {
        return userRepository.findByRole("SHIPPER").stream()
                    .sorted(java.util.Comparator
                            .comparing((User u) -> u.getFullName() == null ? "" : u.getFullName(),
                                    java.util.Comparator.naturalOrder())
                            .thenComparing(u -> u.getId() == null ? 0L : u.getId()))
                    .map(u -> ShipperDTO.ShipperOptionResponse.builder()
                            .userId(u.getId())
                            .username(u.getUsername())
                            .fullName(u.getFullName())
                            .phone(u.getPhone())
                            .build())
                    .toList();
    }

    /** GĐ11 — ngưỡng "tủ còn sống": nhịp tim cũ hơn 5 phút thì không cho shipper chọn. */
    private static final long HEARTBEAT_FRESH_MINUTES = 5L;

    /**
     * GĐ53 — tên tủ để ghép vào câu báo lỗi, KHÔNG lặp chữ "Tủ".
     *
     * <p>Tên trong CSDL đã là {@code "Tủ Giao Nhận KTX A1 (Trụ Sở PTIT)"} ⇒ câu cũ
     * {@code "Tủ " + locker.getName()} in ra {@code "Tủ Tủ Giao Nhận…"}. Bỏ tiền tố khi tên đã có,
     * và luôn trả chuỗi bắt đầu bằng "Tủ".
     */
    private static String tenTu(Locker locker) {
        String ten = locker == null ? null : locker.getName();
        if (ten == null || ten.isBlank()) {
            return "Tủ";
        }
        String t = ten.trim();
        if (t.regionMatches(true, 0, "Tủ", 0, 2)) {
            return t;
        }
        return "Tủ " + t;
    }

    /** GĐ11 — ngưỡng tủ "đã kín": lấp đầy từ 80% trở lên thì không gợi ý nữa. */
    private static final double MAX_OCCUPANCY_RATIO = 0.8;

    /**
     * GĐ15 — mốc "vĩnh viễn" cho mã QR định danh shipper.
     *
     * <p><b>Vì sao năm 9999 chứ không phải {@code null}:</b> cột {@code shipper_identity_tokens.expired_at}
     * trong CSDL là {@code NOT NULL} và entity khai {@code nullable = false}. Dùng mốc rất xa giữ
     * nguyên schema, không cần migration, và dữ liệu cũ vẫn đọc được bình thường.
     *
     * <p><b>Vì sao dùng mốc này lại không phải sửa truy vấn:</b>
     * {@code ShipperIdentityTokenRepository.findActiveVerifiedTokensForLocker} lọc
     * {@code expiredAt > :now} — với năm 9999 điều kiện đó luôn đúng, nên phiên mở tủ của shipper
     * không bao giờ hết hạn mà không phải sửa một dòng JPQL nào.
     */
    private static final LocalDateTime PERPETUAL_EXPIRY = LocalDateTime.of(9999, 12, 31, 23, 59, 59);

    /**
     * GĐ72 — LUẬT DUY NHẤT cho hạn lưu kho: hết 24h00 ngày hôm sau ngày nạp (23:59:59.999…).
     *
     * <p>Trước GĐ72 mỗi đường nạp tự tính: nạp qua web/cảm biến đóng cửa dùng luật này, còn nhánh
     * MQTT {@code deposit_success} dùng {@code now + 2 ngày} ⇒ cùng một kiện mà hạn lệch tới gần 1
     * ngày tuỳ đường nạp. Mọi chỗ đặt {@code expiryDeadline} phải gọi hàm này.
     */
    public static LocalDateTime hanLuuKho(LocalDateTime thoiDiemNap) {
        return LocalDateTime.of(thoiDiemNap.toLocalDate().plusDays(1), LocalTime.MAX);
    }

    /**
     * 1. Sinh mã QR định danh cho Shipper — <b>KHÔNG có hạn</b> (GĐ15) và <b>CỐ ĐỊNH theo shipper</b>
     * (GĐ33, user chốt: "ấn mấy lần thì cũng chỉ có 1 mã đó").
     *
     * <p><b>GĐ33 — một dòng token / một shipper, {@code isVerified} là cờ PHIÊN:</b>
     * <ul>
     *   <li>Đã có token cũ ({@link ShipperIdentityTokenRepository#findTopByShipperIdOrderByCreatedAtDesc}) →
     *       <b>KHÔNG tạo dòng mới</b>, chỉ <b>reset {@code isVerified = false}</b> + {@code lockerId = null}
     *       (mở phiên mới) và trả về <b>đúng mã cũ</b>.</li>
     *   <li>Chưa có → tạo mới như trước.</li>
     * </ul>
     *
     * <p><b>Vì sao BẮT BUỘC phải reset {@code isVerified}:</b> {@link #verifyDynamicToken} chặn
     * quét lại token đã dùng. Nếu chỉ đổi mã thành cố định mà không reset cờ thì shipper quét được
     * <b>đúng 1 lần trong cả đời tài khoản</b>, mọi lần sau nhận "Mã QR Shipper này đã được sử dụng!".
     * Nay mỗi lần bấm lấy QR = mở phiên mới (cờ về false) → quét được 1 lần → cờ true → hết phiên.
     * {@code verifyDynamicToken} <b>không đổi một dòng nào</b>.
     *
     * <p><b>RỦI RO ĐÃ ĐƯỢC USER CHẤP NHẬN TƯỜNG MINH:</b> mã <b>cố định</b> nên ai chụp được ảnh QR
     * của shipper một lần thì <b>dùng được ở MỌI phiên shipper mở sau này</b> (trước GĐ33 thì ảnh
     * chụp vô dụng vì mã đổi mỗi lần). Cộng thêm GĐ15 đã bỏ hạn 60 giây.
     * Ba lớp giảm thiểu CÒN LẠI (bắt buộc giữ, xem {@link #verifyDynamicToken}):
     * <ol>
     *   <li>{@code isVerified} — mỗi phiên chỉ quét được MỘT lần (chống phát lại trong phiên).</li>
     *   <li>{@code lockerId} — token gắn tủ lúc quét, không dùng chéo sang tủ khác.</li>
     *   <li>Phải đăng nhập tài khoản SHIPPER mới mở được phiên (endpoint có xác thực).</li>
     * </ol>
     * Ghi trong {@code docs/GIOI-HAN-BAOMAT.md} mục 6 cùng chỗ với ghi chú QR vĩnh viễn.
     *
     * <p><b>Dữ liệu cũ KHÔNG bị xoá:</b> trước GĐ33 mỗi lần bấm sinh một dòng, nên DB có thể có
     * nhiều token/shipper. Chỉ dùng dòng MỚI NHẤT; các dòng cũ thành lịch sử, không ảnh hưởng vì UI
     * chỉ hiện mã backend trả về (điều cấm #3 của thẻ: cấm xoá token cũ).
     */
    @Transactional
    public ShipperDTO.GenerateTokenResponse generateDynamicToken(String shipperId) {
        // GĐ33 — dùng lại token của chính shipper này nếu đã có.
        java.util.Optional<ShipperIdentityToken> cu =
                tokenRepository.findTopByShipperIdOrderByCreatedAtDesc(shipperId);

        String dynamicToken;
        if (cu.isPresent()) {
            ShipperIdentityToken token = cu.get();
            dynamicToken = token.getDynamicToken();
            // Mở PHIÊN MỚI: cho phép quét lại đúng mã này một lần nữa, và bỏ ràng buộc tủ của phiên
            // trước (shipper có thể giao ở tủ khác).
            token.setIsVerified(false);
            token.setLockerId(null);
            token.setExpiredAt(PERPETUAL_EXPIRY);
            tokenRepository.save(token);
        } else {
            dynamicToken = "SHIP-" + UUID.randomUUID();
            tokenRepository.save(ShipperIdentityToken.builder()
                    .shipperId(shipperId)
                    .dynamicToken(dynamicToken)
                    .expiredAt(PERPETUAL_EXPIRY)
                    .isVerified(false)
                    .build());
        }

        return ShipperDTO.GenerateTokenResponse.builder()
                .shipperId(shipperId)
                .dynamicToken(dynamicToken)
                .expiresAt(PERPETUAL_EXPIRY)
                .validitySeconds(0) // 0 = không giới hạn (trước đây 60)
                .build();
    }

    /**
     * 2. Tủ (đầu đọc GM65) quét và xác thực mã QR định danh của Shipper.
     *
     * <p><b>GĐ15 — đã XOÁ khối kiểm hết hạn.</b> Không còn so {@code now} với {@code expiredAt};
     * mã đã sinh là dùng được vĩnh viễn. Xem rủi ro trong {@link #generateDynamicToken}.
     *
     * <p><b>GIỮ NGUYÊN hai lớp bảo vệ còn lại — KHÔNG được bỏ:</b>
     * <ul>
     *   <li>{@code isVerified}: chặn quét lại cùng một mã đã dùng. Đây là lớp DUY NHẤT còn lại
     *       chống việc phát lại đúng bản tin, bỏ nó là mất hoàn toàn khả năng chống quét lại.</li>
     *   <li>{@code lockerId}: ghi tủ đã quét để không dùng chéo tủ.</li>
     * </ul>
     */
    @Transactional
    public boolean verifyDynamicToken(String lockerId, String dynamicToken) {
        ShipperIdentityToken token = tokenRepository.findByDynamicToken(dynamicToken)
                .orElseThrow(() -> new RuntimeException("Mã QR Shipper không hợp lệ!"));

        if (Boolean.TRUE.equals(token.getIsVerified())) {
            throw new RuntimeException("Mã QR Shipper này đã được sử dụng!");
        }

        token.setIsVerified(true);
        // Ghi lại TỦ đã quét mã. Thiếu bước này thì token xác thực ở tủ A
        // vẫn dùng được để mở cửa tủ B (lỗi cross-locker).
        token.setLockerId(lockerId);
        tokenRepository.save(token);
        return true;
    }

    /**
     * GĐ75 (#9) — chủ sở hữu của một mã QR shipper; {@code null} nếu mã rỗng/không tồn tại.
     * Chỉ đọc, không đổi trạng thái token.
     */
    @Transactional(readOnly = true)
    public String findShipperIdByToken(String dynamicToken) {
        if (dynamicToken == null || dynamicToken.isBlank()) return null;
        return tokenRepository.findByDynamicToken(dynamicToken)
                .map(ShipperIdentityToken::getShipperId)
                .orElse(null);
    }

    /**
     * Có phiên shipper ĐÃ xác thực tại ĐÚNG tủ này và CÒN hiệu lực hay không.
     *
     * <p>Dùng để chặn topic `ptit/QR_send`. Bắt buộc lọc theo {@code lockerId}:
     * nếu chỉ kiểm "có token verified nào đó", shipper xác thực ở tủ A sẽ mở được
     * cửa tủ B — và tệ hơn, mở nhầm sang tủ khác với đơn hàng.
     */
    @Transactional(readOnly = true)
    public boolean hasAnyVerifiedShipperToken(String lockerId, LocalDateTime now) {
        if (lockerId == null || lockerId.isBlank()) {
            return false;
        }
        return !tokenRepository.findActiveVerifiedTokensForLocker(lockerId, now).isEmpty();
    }

    /**
     * 3. Shipper quét mã vận đơn đơn hàng và bỏ hàng vào ngăn tủ
     * Kiểm tra cảm biến kép: Cảm biến trọng lượng HX711 + Cảm biến đóng cửa MC-38
     */
    @Transactional
    public ShipperDTO.DepositResponse depositPackage(ShipperDTO.DepositPackageRequest request,
                                                     String currentUsername) {
        // Kiểm tra danh tính Shipper (Quy trình bảo mật 2 bước tại Kiosk)
        if (request.getDynamicToken() == null || request.getDynamicToken().isBlank()) {
            throw new RuntimeException("Vui lòng quét mã QR xác thực danh tính Shipper trước khi gửi hàng!");
        }

        ShipperIdentityToken token = tokenRepository.findByDynamicToken(request.getDynamicToken().trim())
                .orElseThrow(() -> new RuntimeException("Mã QR định danh Shipper không hợp lệ!"));

        if (!Boolean.TRUE.equals(token.getIsVerified())) {
            throw new RuntimeException("Mã QR Shipper chưa được quét xác thực tại trạm tủ!");
        }

        // Review bảo mật #8 — token phải thuộc CHÍNH người đang đăng nhập, giống điều kiện (4) của
        // luồng thu hồi (`xacThucVaTimDonThuHoi`). Thiếu bước này, shipper A cầm token đã xác thực
        // của shipper B nạp được đơn giao cho B. 403 vì là lỗi quyền.
        if (currentUsername == null || token.getShipperId() == null
                || !token.getShipperId().equalsIgnoreCase(currentUsername)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Mã QR này không thuộc tài khoản đang đăng nhập!");
        }

        // Review bảo mật #7 — khoá dòng đơn (SELECT ... FOR UPDATE) như assign/reserve/claim, để
        // admin chuyển phân công hoặc tác vụ nhả ngăn chạy cùng lúc phải chờ, không ghi đè nhau.
        Order order = orderRepository.findByIdForUpdate(request.getOrderId())
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + request.getOrderId()));

        if (order.getAssignedShipper() == null
                || !order.getAssignedShipper().getUsername().equalsIgnoreCase(token.getShipperId())) {
            throw new RuntimeException("Đơn hàng này chưa được phân công cho tài khoản shipper này!");
        }

        // GĐ31b — nhận cả `PENDING_OPENED`: đó là đơn đang trong phiên nạp (cửa đã mở) mà shipper
        // bấm xác nhận nạp trên web. Chặn ở đây sẽ khiến shipper không chốt được đúng lúc hàng
        // đã vào tủ.
        if (!"PENDING".equalsIgnoreCase(order.getStatus())
                && !"PENDING_OPENED".equalsIgnoreCase(order.getStatus())) {
            throw new RuntimeException("Đơn hàng không ở trạng thái chờ gửi (Hiện tại: " + order.getStatus() + ")");
        }

        if (order.getLocker() == null || !order.getLocker().getLockerId().equals(request.getLockerId())) {
            throw new RuntimeException("Đơn hàng này không được phân bổ tới tủ: " + request.getLockerId());
        }

        // GĐ28 — CHẶN NẠP HÀNG VÀO TỦ ĐANG BẢO TRÌ.
        //
        // Đây là đường shipper gửi hàng THẬT. Trước GĐ28 hàm này chỉ kiểm token/đơn PENDING/đúng
        // tủ/còn ngăn/cửa đóng/có cân — KHÔNG kiểm `MAINTENANCE`, nên shipper vẫn nạp được hàng vào
        // tủ admin vừa khoá để sửa chữa (ảnh user 15/11: `qviet` vẫn OPEN_DOOR sau khi khoá tủ).
        // `suggestLockers` và `assignLocker` đã kiểm từ trước; chỗ lọt đúng là ở đây.
        //
        // 409 (BusinessException) chứ không phải 400: trạng thái hiện tại của tủ không cho phép
        // thao tác, client cần biết để hiện "tủ đang bảo trì" chứ không phải "request sai".
        if ("MAINTENANCE".equalsIgnoreCase(order.getLocker().getConnectionStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Tủ " + order.getLocker().getLockerId() + " đang bảo trì nên không thể nạp hàng. "
                            + "Vui lòng liên hệ admin mở khoá bảo trì hoặc chuyển đơn sang tủ khác.");
        }

        // GĐ30 — CHẶN NẠP HÀNG VÀO TỦ THẬT ĐANG MẤT NHỊP TIM.
        //
        // Đây là bước DUY NHẤT thực sự đưa hàng vào tủ, mà trước GĐ30 lại là bước duy nhất KHÔNG
        // kiểm nhịp tim: `suggestLockers` (:642) loại tủ thật mất nhịp khỏi gợi ý, `assignLocker`
        // (:747) trả 409 khi chốt tủ, nhưng `depositPackage` vẫn cho nạp. Đo thật 15/11/2026:
        // `LOCKER_HN_01` (tủ thật, `is_virtual=0`) mất nhịp **130 phút** → `POST /api/shipper/deposit`
        // trả **200**, đơn `PENDING → DEPOSITED`, ngăn `EMPTY → OCCUPIED`. Tức hàng vào một tủ
        // không ai điều khiển được: không mở được cửa, không xác nhận được cửa đã đóng.
        //
        // Cố ý để THÀNH KHỐI RIÊNG, không gộp vào khối `MAINTENANCE` bên trên (điều cấm #4): hai lý
        // do khác hẳn nhau và shipper phải phân biệt được "chờ admin mở khoá bảo trì" với "chờ tủ
        // có mạng trở lại".
        //
        // Tủ ẢO (`is_virtual = 1`) BỎ QUA hoàn toàn (điều cấm #1): 9 tủ khai báo trong CSDL không
        // có thiết bị nên không bao giờ gửi nhịp tim, chặn là mất 9/10 tủ — đúng luật GĐ12.
        //
        // `lastHeartbeat == null` bị coi là CHẾT (điều cấm #2): "chưa từng gửi nhịp tim" không thể
        // suy ra "vừa sống".
        //
        // Dùng lại `HEARTBEAT_FRESH_MINUTES` (:80), không tạo hằng số mới (điều cấm #3).
        if (!Boolean.TRUE.equals(order.getLocker().getIsVirtual())) {
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime hb = order.getLocker().getLastHeartbeat();
            if (hb == null || hb.isBefore(now.minusMinutes(HEARTBEAT_FRESH_MINUTES))) {
                String matBaoLau = (hb == null)
                        ? "chưa từng gửi nhịp tim"
                        : "mất nhịp tim " + java.time.Duration.between(hb, now).toMinutes() + " phút";
                // GĐ30b — `lockers.name` ĐÃ bắt đầu bằng "Tủ" ("Tủ Giao Nhận KTX A1…"), nên ghép
                // thêm "Tủ " ở đây ra "Tủ Tủ Giao Nhận…" (minh bắt được khi nghiệm thu GĐ30).
                // Dùng thẳng `getName()` để câu chữ đúng, giữ `lockerId` trong ngoặc để shipper
                // đối chiếu được với mã tủ trên nhãn vật lý.
                throw new com.ptit.smartlocker.exception.BusinessException(
                        order.getLocker().getName() + " (" + order.getLocker().getLockerId() + ") đang "
                                + matBaoLau + ", không thể nạp hàng. Tủ này là tủ thật nên phải có nhịp tim "
                                + "trong " + HEARTBEAT_FRESH_MINUTES + " phút gần đây; vui lòng kiểm tra nguồn "
                                + "điện/mạng của tủ hoặc chuyển đơn sang tủ khác.");
            }
        }

        Compartment compartment = order.getCompartment();
        if (compartment == null) {
            // Tự động tìm ngăn tủ còn EMPTY tại trạm để nạp hàng nếu lúc đặt chưa gán.
            // GĐ28 — ghi rõ: `EMPTY` tự loại `OUT_OF_SERVICE`/`OCCUPIED`/`RESERVED` nên nhánh này
            // không thể chọn nhầm ngăn đang bảo trì; nhánh dưới mới là chỗ cần kiểm tay.
            List<Compartment> empties = compartmentRepository.findByLocker_LockerIdAndStatus(request.getLockerId(), "EMPTY");
            if (empties.isEmpty()) {
                throw new RuntimeException("Tủ " + request.getLockerId() + " hiện tại không còn ngăn trống để nạp hàng!");
            }
            compartment = empties.get(0);
            order.setCompartment(compartment);
        } else if ("OUT_OF_SERVICE".equalsIgnoreCase(compartment.getStatus())) {
            // GĐ28 — ngăn ĐÃ GÁN mà đang bảo trì thì không được đặt hàng vào. Trước đây chỉ kiểm
            // `compartment == null`, nên ngăn `OUT_OF_SERVICE` lọt qua và bị đổi thành `OCCUPIED`,
            // tức là bảo trì ngăn bị vô hiệu hoá đúng ở đường nạp hàng.
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Ngăn #" + compartment.getCompIndex() + " của tủ " + request.getLockerId()
                            + " đang bảo trì nên không thể nạp hàng. Vui lòng chọn ngăn khác.");
        }

        // Kiểm tra điều kiện Cảm biến kép:
        if (request.getIsDoorClosed() != null && !request.getIsDoorClosed()) {
            throw new RuntimeException("Cửa ngăn tủ chưa được đóng kín! Vui lòng đóng cửa để hoàn tất gửi hàng.");
        }

        if (request.getWeightGrams() != null && request.getWeightGrams() <= 0.05) {
            throw new RuntimeException("Cảm biến chưa phát hiện kiện hàng được đặt vào ngăn tủ!");
        }

        // Cập nhật trạng thái ngăn tủ.
        //
        // KHÔNG hardcode isDoorClosed = true: đây là trạng thái của cảm biến từ MC-38 (và
        // currentWeight của HX711). Nếu client không gửi giá trị nào thì phải GIỮ NGUYÊN giá trị
        // phần cứng đã báo, không được tự khẳng định "cửa đã đóng" — nếu không dashboard sẽ hiển
        // thị sai khi cửa thật đang mở.
        compartment.setStatus("OCCUPIED");
        if (request.getWeightGrams() != null) {
            compartment.setCurrentWeight(request.getWeightGrams());
        }
        if (request.getIsDoorClosed() != null) {
            compartment.setIsDoorClosed(request.getIsDoorClosed());
        }
        compartmentRepository.save(compartment);

        // Quy định lưu trữ: Đến hết ngày tiếp theo (24h00 của ngày N+1)
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime expiryDeadline = hanLuuKho(now);

        order.setStatus("DEPOSITED");
        order.setDepositedAt(now);
        order.setExpiryDeadline(expiryDeadline);
        orderRepository.save(order);

        // Đồng bộ thời hạn mã nhận hàng của khách
        credentialRepository.findByOrder_OrderId(order.getOrderId()).ifPresent(cred -> {
            cred.setExpiredAt(expiryDeadline);
            credentialRepository.save(cred);
        });

        // Ghi nhật ký sự kiện cảm biến
        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(compartment.getCompartmentId())
                .eventType("DEPOSIT_SUCCESS")
                .eventPayload("Weight: " + request.getWeightGrams() + "kg, Door: CLOSED")
                .build();
        deviceEventRepository.save(event);

        // Bắn lệnh MQTT thông báo trạng thái nạp hàng thành công tới Kiosk và MQTTX
        if (mqttService != null && order.getLocker() != null) {
            mqttService.publishCommand(order.getLocker().getLockerId(), compartment.getCompIndex(), "OPEN_DOOR", "SHIPPER_DEPOSIT", order.getOrderId());
        }

        // GĐ42 vòng 2 — BẮN SỰ KIỆN KIOSK CHO ĐƯỜNG NẠP QUA **API**.
        //
        // `DEPOSIT_SUCCESS` trước vòng này CHỈ được bắn từ nhánh MQTT `deposit_success`
        // (`MqttService`), tức đường **firmware báo**. Đường **API** (`POST /api/shipper/deposit`,
        // đúng đường web shipper dùng) chỉ ghi `device_events` rồi trả về ⇒ web shipper không có
        // sự kiện nào để bắt, chỉ cập nhật nhờ nhịp dự phòng 10 giây.
        //
        // Đo thật (minh, 2 lần chạy): đơn tự cập nhật sau **3738 ms** và **3602 ms** — vượt ngưỡng
        // ≤3 s của phép thử #2/#3.
        //
        // Guard `!= null` giống nhánh `!conHang` bên dưới, vì bean được tiêm
        // `@Autowired(required=false)`.
        if (kioskEventService != null && order.getLocker() != null) {
            kioskEventService.record(order.getLocker().getLockerId(),
                    KioskEventService.DEPOSIT_SUCCESS,
                    order.getOrderId(), order.getTrackingCode(),
                    compartment.getCompIndex(), null,
                    "Nạp hàng thành công ngăn #" + compartment.getCompIndex());
        }
        if (notificationService != null) {
            notificationService.depositSuccess(order, compartment.getCompIndex());
        }

        return ShipperDTO.DepositResponse.builder()
                .success(true)
                .message("Gửi hàng vào ngăn tủ số " + compartment.getCompIndex() + " thành công!")
                .orderId(order.getOrderId())
                .compartmentIndex(compartment.getCompIndex())
                .relayPin(compartment.getRelayPin())
                .lockerId(order.getLocker().getLockerId())
                .build();
    }

    /**
     * T3 — Danh sách đơn PENDING cho shipper chọn đặt trước trên web.
     *
     * <p>{@code trackingCode} trả về = {@code tracking_code} nếu đã đặt, ngược lại là
     * {@code order_id} (mặc định lấy order_id, cho phép sửa).
     *
     * <p><b>GĐ11:</b> nhánh "mọi tủ" phải dùng {@code findByStatusWithCompartment} — truy vấn
     * theo tủ cụ thể sẽ bỏ sót vĩnh viễn các đơn <b>chưa được gán tủ</b> ({@code locker_id IS NULL}),
     * mà từ GĐ11 loại đơn đó là bình thường (khách đặt trước, shipper chọn tủ sau). Nhánh lọc
     * theo tủ thì đổi sang {@code findByLockerAndStatusFetchAll} để nạp sẵn cả {@code locker} —
     * bản cũ chỉ fetch {@code compartment} nên đọc {@code getLocker()} trong vòng lặp là N+1.
     *
     * @param lockerId null/rỗng/"ALL" = mọi tủ
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getPendingOrders(String lockerId, String shipperUsername) {
        List<Order> list;
        if (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId)) {
            list = orderRepository.findByStatusWithCompartmentAndAssignedShipper(
                    List.of("PENDING", "PENDING_OPENED"));
        } else {
            list = orderRepository.findByLockerAndStatusFetchAllWithAssignedShipper(
                    lockerId, List.of("PENDING", "PENDING_OPENED"));
        }

        return list.stream()
                .filter(o -> o.getAssignedShipper() != null
                        && o.getAssignedShipper().getUsername().equalsIgnoreCase(shipperUsername))
                .map(o -> OrderDTO.OrderResponse.builder()
                        .orderId(o.getOrderId())
                        .customerName(o.getCustomerName())
                        .customerPhone(o.getCustomerPhone())
                        .deliveryType(o.getDeliveryType())
                        .lockerId(o.getLocker() != null ? o.getLocker().getLockerId() : null)
                        .lockerName(o.getLocker() != null ? o.getLocker().getName() : null)
                        .compartmentIndex(o.getCompartment() != null ? o.getCompartment().getCompIndex() : null)
                        .compartmentSize(o.getCompartment() != null ? o.getCompartment().getSize() : null)
                        .isShipperReserved(o.getShipperReservedAt() != null)
                        .expectedDate(o.getExpectedDate())
                        .status(o.getStatus())
                        .productName(o.getProductName())
                        .totalAmount(o.getTotalAmount())
                        .paymentMethod(o.getPaymentMethod())
                        .paymentStatus(o.getPaymentStatus())
                        .createdAt(o.getCreatedAt())
                        // Mặc định mã vận đơn = order_id khi chưa đặt trước (Q1 = (c)).
                        .trackingCode(o.getTrackingCode() != null && !o.getTrackingCode().isBlank()
                                ? o.getTrackingCode()
                                : o.getOrderId())
                        .assignedShipperUsername(o.getAssignedShipper() != null
                                ? o.getAssignedShipper().getUsername()
                                : null)
                        .build())
                .collect(Collectors.toList());
    }

    @Transactional
    public void claimPendingOrder(String orderId, String shipperUsername) {
        User shipper = userRepository.findByUsernameForUpdate(shipperUsername)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản shipper."));
        if (!"SHIPPER".equals(shipper.getRole())) {
            throw new IllegalArgumentException("Chỉ tài khoản shipper mới được nhận đơn.");
        }

        Order order = orderRepository.findByIdForShipperClaim(orderId)
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng."));
        if (!"PENDING".equals(order.getStatus()) && !"PENDING_OPENED".equals(order.getStatus())) {
            throw new IllegalArgumentException("Đơn hàng không còn ở trạng thái chờ giao.");
        }

        User assignedShipper = order.getAssignedShipper();
        if (assignedShipper != null && !assignedShipper.getId().equals(shipper.getId())) {
            throw new IllegalArgumentException("Đơn hàng đã được shipper khác nhận.");
        }
        if (assignedShipper == null) {
            throw new IllegalArgumentException(
                    "Đơn chưa được Admin phân công. Shipper không thể tự nhận.");
        }
    }

    @Transactional
    public OrderDTO.OrderResponse createOrderByAdmin(ShipperDTO.CreateOrderByAdminRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Thiếu dữ liệu tạo đơn.");
        }
        // Gộp ThanhChung — áp cùng chốt GĐ75 (#3) như OrderService.createOrder: luồng admin tạo đơn
        // không đi qua checkout nên trước đây nhận được đơn −5 đ.
        if (request.getTotalAmount() != null && request.getTotalAmount().signum() < 0) {
            throw new IllegalArgumentException("Giá trị đơn hàng không được là số âm!");
        }
        if (request.getCustomerUsername() == null || request.getCustomerUsername().isBlank()) {
            throw new IllegalArgumentException("Vui lòng chọn khách hàng.");
        }
        if (request.getLockerId() == null || request.getLockerId().isBlank()) {
            throw new IllegalArgumentException("Vui lòng chọn tủ giao hàng.");
        }

        User customer = userRepository.findByUsername(request.getCustomerUsername().trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản khách hàng."));
        if (!"CUSTOMER".equalsIgnoreCase(customer.getRole())) {
            throw new IllegalArgumentException("Tài khoản được chọn không có vai trò CUSTOMER.");
        }
        Locker locker = lockerRepository.findById(request.getLockerId().trim())
                .orElseThrow(() -> new IllegalArgumentException("Tủ giao hàng không tồn tại."));
        if ("MAINTENANCE".equalsIgnoreCase(locker.getConnectionStatus())) {
            throw new IllegalArgumentException("Tủ giao hàng đang bảo trì.");
        }

        User shipper = null;
        if (request.getShipperUserId() != null) {
            shipper = userRepository.findById(request.getShipperUserId())
                    .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản shipper."));
        } else if (request.getShipperUsername() != null && !request.getShipperUsername().isBlank()) {
            shipper = userRepository.findByUsername(request.getShipperUsername().trim())
                    .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản shipper."));
        }
        if (shipper != null && !"SHIPPER".equalsIgnoreCase(shipper.getRole())) {
            throw new IllegalArgumentException("Tài khoản được chọn không có vai trò SHIPPER.");
        }

        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        String productName = request.getProductName() == null || request.getProductName().isBlank()
                ? "Bưu kiện Smart Locker" : request.getProductName().trim();
        String paymentMethod = request.getPaymentMethod() == null || request.getPaymentMethod().isBlank()
                ? "ONLINE_VIETQR" : request.getPaymentMethod().trim();
        String paymentStatus = request.getPaymentStatus() == null || request.getPaymentStatus().isBlank()
                ? ("COD".equalsIgnoreCase(paymentMethod) ? "UNPAID" : "PAID")
                : request.getPaymentStatus().trim();

        Order order = Order.builder()
                .orderId(orderId)
                .customerName(customer.getFullName())
                .customerPhone(customer.getPhone())
                .deliveryType("LOCKER")
                .locker(locker)
                .expectedDate(java.time.LocalDate.now())
                .status("PENDING")
                .totalAmount(request.getTotalAmount() != null
                        ? request.getTotalAmount() : java.math.BigDecimal.ZERO)
                .paymentMethod(paymentMethod)
                .paymentStatus(paymentStatus)
                .productName(productName)
                .trackingCode(orderId)
                .assignedShipper(shipper)
                .build();
        orderRepository.save(order);

        String qrToken = "PKUP-" + UUID.randomUUID();
        credentialRepository.save(com.ptit.smartlocker.entity.PickupCredential.builder()
                .order(order)
                .otpCode("")
                .qrToken(qrToken)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(java.time.LocalDateTime.now().plusDays(2))
                .build());
        return mapPendingOrderResponse(order);
    }

    @Transactional
    public OrderDTO.OrderResponse assignShipperByAdmin(String orderId, Long shipperUserId,
                                                        String shipperUsername) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần phân công!");
        }
        if (shipperUserId == null && (shipperUsername == null || shipperUsername.isBlank())) {
            throw new IllegalArgumentException("Vui lòng chọn shipper phụ trách!");
        }

        Order order = orderRepository.findByIdForShipperClaim(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng."));
        if (!"PENDING".equalsIgnoreCase(order.getStatus())
                && !"PENDING_OPENED".equalsIgnoreCase(order.getStatus())
                && !"OVERDUE".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException("Chỉ phân công đơn chờ giao hoặc đơn quá hạn.");
        }

        User shipper = shipperUserId != null
                ? userRepository.findByIdForUpdate(shipperUserId)
                        .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản shipper."))
                : userRepository.findByUsernameForUpdate(shipperUsername.trim())
                        .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy tài khoản shipper."));
        if (!"SHIPPER".equalsIgnoreCase(shipper.getRole())) {
            throw new IllegalArgumentException("Tài khoản được chọn không có vai trò SHIPPER.");
        }

        order.setAssignedShipper(shipper);
        order = orderRepository.save(order);
        if ("OVERDUE".equalsIgnoreCase(order.getStatus()) && notificationService != null) {
            notificationService.overdueAssigned(order);
        }
        return mapPendingOrderResponse(order);
    }

    private OrderDTO.OrderResponse mapPendingOrderResponse(Order order) {
        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(order.getLocker() != null ? order.getLocker().getLockerId() : null)
                .lockerName(order.getLocker() != null ? order.getLocker().getName() : null)
                .lockerAddress(order.getLocker() != null ? order.getLocker().getAddress() : null)
                .compartmentIndex(order.getCompartment() != null ? order.getCompartment().getCompIndex() : null)
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .productName(order.getProductName())
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .createdAt(order.getCreatedAt())
                .trackingCode(order.getTrackingCode() != null && !order.getTrackingCode().isBlank()
                        ? order.getTrackingCode() : order.getOrderId())
                .assignedShipperUsername(order.getAssignedShipper() != null
                        ? order.getAssignedShipper().getUsername() : null)
                .build();
    }

    /**
     * T3 — Shipper đặt trước một ngăn cụ thể cho đơn PENDING.
     *
     * <p>Đặt trước chỉ giữ ngăn vật lý; tạo đơn và gán tủ không giữ suất trong lịch giao hàng.
     *
     * <p>Khoá đơn và ngăn được chọn bằng khoá bi quan: hai shipper bấm cùng lúc thì chỉ một người
     * giành được ngăn, người kia nhận lỗi.
     */
    @Transactional
    public OrderDTO.OrderResponse reserveCompartment(String orderId, String trackingCode,
                                                     Integer compartmentIndex, Integer reserveHours) {
        return reserveCompartment(orderId, trackingCode, compartmentIndex, reserveHours, null);
    }

    @Transactional
    public OrderDTO.OrderResponse reserveCompartment(String orderId, String trackingCode,
                                                     Integer compartmentIndex, Integer reserveHours,
                                                     String shipperUsername) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần đặt trước!");
        }
        if (compartmentIndex == null || compartmentIndex < 1) {
            throw new IllegalArgumentException("Chỉ số ngăn không hợp lệ (phải từ 1 trở lên)!");
        }
        // GĐ21 — thời hạn giữ chỗ do shipper chọn: chỉ 1 hoặc 2 giờ. Thiếu thì mặc định 2 giờ.
        // Giá trị khác bị TỪ CHỐI rõ ràng, KHÔNG âm thầm kẹp về 1 — kẹp im lặng là kiểu lỗi khiến
        // shipper tưởng đã giữ 5 giờ trong khi chỉ được 1.
        if (reserveHours == null) {
            reserveHours = 2;
        }
        if (reserveHours != 1 && reserveHours != 2) {
            throw new IllegalArgumentException(
                    "Thời hạn đặt trước chỉ nhận 1 hoặc 2 giờ (nhận được: " + reserveHours + ").");
        }

        Order order = orderRepository.findByIdForShipperClaim(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (shipperUsername != null && (order.getAssignedShipper() == null
                || !order.getAssignedShipper().getUsername().equalsIgnoreCase(shipperUsername))) {
            throw new IllegalArgumentException("Đơn hàng không thuộc phụ trách của tài khoản shipper này.");
        }

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Chỉ đặt trước được đơn đang chờ gửi. Đơn " + orderId + " hiện ở trạng thái "
                            + order.getStatus() + ".");
        }

        // Ngăn chỉ được gán ở luồng đặt trước; đơn chưa đặt trước không có ngăn để chuyển.
        if (order.getShipperReservedAt() != null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " đã được đặt trước. Huỷ đặt trước trước khi đổi ngăn.");
        }

        if (order.getLocker() == null || order.getLocker().getLockerId() == null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " chưa được gán trạm tủ nên không thể đặt trước ngăn.");
        }
        String lockerId = order.getLocker().getLockerId();

        // Mã vận đơn: để trống thì lấy order_id (Q1 = (c)).
        String finalTracking = (trackingCode == null || trackingCode.isBlank())
                ? order.getOrderId()
                : trackingCode.trim();
        if (finalTracking.length() > 50) {
            throw new IllegalArgumentException("Mã vận đơn quá dài (tối đa 50 ký tự)!");
        }

        // Mã vận đơn không được trùng đơn KHÁC.
        orderRepository.findByTrackingCode(finalTracking).ifPresent(other -> {
            if (!other.getOrderId().equalsIgnoreCase(order.getOrderId())) {
                throw new IllegalArgumentException(
                        "Mã vận đơn '" + finalTracking + "' đã thuộc đơn " + other.getOrderId() + "!");
            }
        });

        Compartment old = order.getCompartment();
        Compartment target;

        if (old != null && old.getCompIndex().equals(compartmentIndex)) {
            target = compartmentRepository.findWithLockByLockerIdAndCompIndex(lockerId, compartmentIndex)
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Không tìm thấy ngăn " + compartmentIndex + " của tủ " + lockerId + "."));
            if ("RESERVED".equalsIgnoreCase(target.getStatus())
                    && orderRepository.countOtherActiveOrdersForCompartment(
                            target.getCompartmentId(), order.getOrderId(),
                            List.of("PENDING", "PENDING_OPENED", "DEPOSITED", "PICKUP_OPENED", "OVERDUE")) > 0) {
                throw new IllegalArgumentException(
                        "Ngăn " + compartmentIndex + " của tủ " + lockerId
                                + " đã có đơn khác giữ chỗ. Vui lòng chọn ngăn khác.");
            }
            if (!"EMPTY".equalsIgnoreCase(target.getStatus())
                    && !"RESERVED".equalsIgnoreCase(target.getStatus())) {
                throw new IllegalArgumentException(
                        "Ngăn " + compartmentIndex + " của tủ " + lockerId
                                + " không trống (đã có người giữ hoặc đang chứa hàng). Vui lòng chọn ngăn khác.");
            }
        } else {
            // Đổi ngăn: nhả ngăn CŨ trước — nhưng CHỈ khi ngăn cũ đang RESERVED (ngăn do checkout
            // gán giữ chỗ). Nếu ngăn cũ đang OCCUPIED thì có hàng thật trong đó: KHÔNG được đá
            // hàng của người khác ra, phải từ chối để shipper chọn ngăn khác.
            if (old != null) {
                if ("OCCUPIED".equalsIgnoreCase(old.getStatus())) {
                    throw new IllegalArgumentException(
                            "Ngăn " + old.getCompIndex() + " mà đơn đang trỏ tới đang CHỨA HÀNG (OCCUPIED). "
                                    + "Không thể đổi sang ngăn " + compartmentIndex
                                    + " vì sẽ mất dấu kiện hàng. Vui lòng liên hệ admin.");
                }
                if ("RESERVED".equalsIgnoreCase(old.getStatus())) {
                    old.setStatus("EMPTY");
                    compartmentRepository.save(old);
                }
            }

            // Khoá chính ngăn được chọn rồi kiểm tra trạng thái mới nhất để chống đặt trùng.
            target = compartmentRepository
                    .findWithLockByLockerIdAndCompIndex(lockerId, compartmentIndex)
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Không tìm thấy ngăn " + compartmentIndex + " của tủ " + lockerId + "."));
            if (!"EMPTY".equalsIgnoreCase(target.getStatus())) {
                throw new IllegalArgumentException(
                        "Ngăn " + compartmentIndex + " của tủ " + lockerId
                                + " không trống (đã có người giữ hoặc đang chứa hàng). Vui lòng chọn ngăn khác.");
            }
        }

        target.setStatus("RESERVED");
        compartmentRepository.save(target);

        order.setCompartment(target);
        order.setTrackingCode(finalTracking);
        // Dấu hiệu DUY NHẤT cho biết shipper đã chủ động đặt trước (Q4).
        LocalDateTime reservedAt = LocalDateTime.now();
        order.setShipperReservedAt(reservedAt);
        // GĐ21 — lưu hạn RIÊNG của đơn này (1h hoặc 2h). ReservationTimeoutService đọc cột này
        // trước; đơn cũ để NULL và rơi về công thức 120 phút.
        order.setReserveExpiresAt(reservedAt.plusHours(reserveHours));
        orderRepository.save(order);

        // KHÔNG đụng available_slots (R2).

        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(target.getCompartmentId())
                .eventType("RESERVE_COMPARTMENT")
                .eventPayload("Order " + order.getOrderId() + " reserved compartment "
                        + target.getCompIndex() + " (tracking=" + finalTracking + ")"
                        + (old != null && !old.getCompIndex().equals(compartmentIndex)
                                ? ", released old compartment " + old.getCompIndex() : ""))
                .build();
        deviceEventRepository.save(event);

        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(lockerId)
                .lockerName(order.getLocker().getName())
                .compartmentIndex(target.getCompIndex())
                .compartmentSize(target.getSize())
                .isShipperReserved(order.getShipperReservedAt() != null)
                // GĐ21 — trả hạn giữ chỗ để web hiện "giữ đến HH:mm" mà KHÔNG tự cộng giờ ở client
                // (client cộng giờ sẽ lệch nếu đồng hồ máy khác máy chủ).
                .reserveExpiresAt(order.getReserveExpiresAt())
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .productName(order.getProductName())
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .createdAt(order.getCreatedAt())
                .trackingCode(finalTracking)
                .build();
    }

    /**
     * GĐ31b — CHỐT PHIÊN NẠP HÀNG THEO CẢM BIẾN (TH1: shipper mở tủ rồi đóng lại không bỏ hàng).
     *
     * <p>Trước GĐ31b, nếu shipper mở cửa rồi đóng mà không bỏ hàng thì KHÔNG ai làm gì: đơn vẫn
     * {@code PENDING}, ngăn vẫn {@code RESERVED} tới hết hạn đặt trước (1-2 giờ). Không mất dữ
     * liệu nhưng ngăn bị khoá vô ích và shipper không được báo gì.
     *
     * <p>Gọi từ {@code MqttService} khi cửa ngăn ĐÓNG và đơn đang ở {@code PENDING_OPENED}:
     * <ul>
     *   <li>Có hàng ({@code conHang}) → {@code DEPOSITED} + ngăn {@code OCCUPIED} (như nạp thành
     *       công bình thường).</li>
     *   <li>Không có hàng → nhả ngăn về {@code EMPTY}, xoá {@code shipper_reserved_at} +
     *       {@code reserve_expires_at}, đơn về {@code PENDING} để shipper chọn lại tủ/ngăn ngay,
     *       và bắn thông báo cho shipper.</li>
     * </ul>
     *
     * @return {@code true} nếu đã nạp được hàng, {@code false} nếu ngăn được nhả (không có hàng).
     */
    @Transactional
    public boolean chotPhienNapHang(Order order, Compartment compartment, boolean conHang) {
        if (order == null || !"PENDING_OPENED".equalsIgnoreCase(order.getStatus())) {
            return false;
        }

        if (conHang) {
            order.setStatus("DEPOSITED");
            LocalDateTime now = LocalDateTime.now();
            order.setDepositedAt(now);
            order.setExpiryDeadline(hanLuuKho(now));
            // GĐ65b — hạn phiên nạp trực tiếp hết ý nghĩa khi đã nạp xong.
            if (order.getShipperReservedAt() == null) {
                order.setReserveExpiresAt(null);
            }
            orderRepository.save(order);

            if (compartment != null) {
                compartment.setStatus("OCCUPIED");
                compartmentRepository.save(compartment);
            }
            credentialRepository.findByOrder_OrderId(order.getOrderId()).ifPresent(cred -> {
                cred.setExpiredAt(order.getExpiryDeadline());
                credentialRepository.save(cred);
            });
            return true;
        }

        // Không có hàng: nhả ngăn NGAY (không bắt shipper chờ hết hạn đặt trước).
        order.setStatus("PENDING");
        order.setShipperReservedAt(null);
        order.setReserveExpiresAt(null);
        order.setCompartment(null);
        orderRepository.save(order);

        if (compartment != null && !"OCCUPIED".equalsIgnoreCase(compartment.getStatus())) {
            compartment.setStatus("EMPTY");
            compartmentRepository.save(compartment);
        }

        // GĐ42 — BẮN SỰ KIỆN "shipper quên nạp hàng".
        //
        // Trước GĐ42 khối này đổi DB đúng nhưng KHÔNG báo gì cho web, nên shipper không biết ngăn
        // đã được trả lại và phải F5 (lỗi user báo "web đứng yên"). Đo thật: đóng cửa không bỏ
        // hàng → DB `PENDING`/`EMPTY` mà `kiosk-events` trả **0 sự kiện**.
        //
        // Đây là sự kiện THẤT BẠI: frontend phải hiện thông báo khác `DEPOSIT_SUCCESS` (điều cấm #2).
        // Guard `!= null` vì bean được tiêm `@Autowired(required=false)`.
        if (kioskEventService != null && order.getLocker() != null) {
            kioskEventService.record(order.getLocker().getLockerId(),
                    KioskEventService.DEPOSIT_LEFT_EMPTY,
                    order.getOrderId(), order.getTrackingCode(),
                    compartment != null ? compartment.getCompIndex() : null, null,
                    "Chưa phát hiện kiện hàng — ngăn đã trả lại, vui lòng nạp lại");
        }
        if (notificationService != null) {
            notificationService.depositLeftEmpty(order,
                    compartment != null ? compartment.getCompIndex() : null);
        }
        return false;
    }

    /**
     * Xoá một đơn PENDING do shipper/admin thêm nhầm.
     *
     * <p>Chỉ cho phép xoá đơn chưa nạp. Nhả ngăn đang giữ và xoá mã nhận hàng
     * đi kèm để dữ liệu không còn đơn mồ côi.
     */
    @Transactional
    public void deletePendingOrder(String orderId, String shipperUsername) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần xoá!");
        }

        // Review bảo mật #7 — khoá dòng đơn để không xoá đè lúc admin đang chuyển phân công.
        Order order = orderRepository.findByIdForUpdate(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (order.getAssignedShipper() == null
                || !order.getAssignedShipper().getUsername().equalsIgnoreCase(shipperUsername)) {
            throw new IllegalArgumentException("Shipper không có quyền xoá đơn chưa thuộc phụ trách.");
        }

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Chỉ xoá được đơn đang chờ nạp. Đơn " + orderId
                            + " hiện ở trạng thái " + order.getStatus() + ".");
        }

        Compartment compartment = order.getCompartment();

        if (compartment != null) {
            String compartmentStatus = compartment.getStatus();
            if ("OCCUPIED".equalsIgnoreCase(compartmentStatus)
                    || "OVERDUE".equalsIgnoreCase(compartmentStatus)) {
                throw new IllegalArgumentException(
                        "Không xoá được đơn " + orderId
                                + " vì ngăn đang có hàng hoặc hàng quá hạn.");
            }
            compartment.setStatus("EMPTY");
            compartmentRepository.save(compartment);
        }

        credentialRepository.findByOrder_OrderId(orderId.trim())
                .ifPresent(credentialRepository::delete);

        orderRepository.delete(order);
    }

    @Transactional
    public void deletePendingOrderByAdmin(String orderId) {
        deletePendingOrderCore(orderId);
    }

    @Transactional
    public void deletePendingOrder(String orderId) {
        deletePendingOrderCore(orderId);
    }

    private void deletePendingOrderCore(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần xoá!");
        }
        Order order = orderRepository.findByIdForUpdate(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));
        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Chỉ xoá được đơn đang chờ nạp. Đơn " + orderId
                            + " hiện ở trạng thái " + order.getStatus() + ".");
        }
        Compartment compartment = order.getCompartment();
        if (compartment != null) {
            if ("OCCUPIED".equalsIgnoreCase(compartment.getStatus())
                    || "OVERDUE".equalsIgnoreCase(compartment.getStatus())) {
                throw new IllegalArgumentException(
                        "Không xoá được đơn " + orderId + " vì ngăn đang có hàng hoặc hàng quá hạn.");
            }
            compartment.setStatus("EMPTY");
            compartmentRepository.save(compartment);
        }
        credentialRepository.findByOrder_OrderId(orderId.trim())
                .ifPresent(credentialRepository::delete);
        orderRepository.delete(order);
    }

    /**
     * T3 — Huỷ đặt trước: ngăn về {@code EMPTY}, đơn bỏ ngăn.
     *
     * <p>Đặt trước chỉ giữ ngăn vật lý, không giữ suất trong lịch giao hàng.
     */
    @Transactional
    public void cancelReserve(String orderId, String shipperUsername) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần huỷ đặt trước!");
        }

        Order order = orderRepository.findByIdWithCompartment(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (order.getAssignedShipper() == null
                || !order.getAssignedShipper().getUsername().equalsIgnoreCase(shipperUsername)) {
            throw new IllegalArgumentException("Đơn hàng không thuộc phụ trách của tài khoản shipper này.");
        }

        if (order.getCompartment() == null) {
            throw new IllegalArgumentException("Đơn " + orderId + " hiện không giữ ngăn nào để huỷ.");
        }
        // Q4: chỉ huỷ được cái do CHÍNH shipper đặt trước. Ngăn do checkout gán
        // (`shipper_reserved_at = NULL`) không phải "đặt trước" nên không có gì để huỷ.
        if (order.getShipperReservedAt() == null) {
            throw new IllegalArgumentException(
                    "Đơn " + orderId + " chưa được đặt trước nên không có gì để huỷ.");
        }
        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new IllegalArgumentException(
                    "Không huỷ đặt trước cho đơn đang ở trạng thái " + order.getStatus() + ".");
        }

        Compartment compartment = order.getCompartment();

        // Chỉ nhả khi ngăn chưa bị dùng: EMPTY (bình thường) hoặc vẫn đang RESERVED (đúng ca này).
        boolean canRelease = "RESERVED".equalsIgnoreCase(compartment.getStatus())
                || "EMPTY".equalsIgnoreCase(compartment.getStatus());
        if (!canRelease) {
            throw new IllegalArgumentException(
                    "Ngăn " + compartment.getCompIndex() + " đang ở trạng thái " + compartment.getStatus()
                            + " nên không thể huỷ đặt trước.");
        }

        compartment.setStatus("EMPTY");
        compartmentRepository.save(compartment);

        order.setCompartment(null);
        // Xoá dấu đặt trước → đơn trở về trạng thái "ngăn do hệ thống/khách", quét nhãn sẽ ra 0.
        order.setShipperReservedAt(null);
        // GĐ21 — phải xoá CẢ hạn giữ chỗ của đơn. Nếu để lại, đơn đã huỷ vẫn mang
        // `reserve_expires_at` của lần đặt trước cũ; lần đặt trước sau (nếu có) sẽ ghi đè, nhưng
        // dữ liệu giữa hai lần đó là mâu thuẫn: có hạn mà không có dấu đặt trước.
        order.setReserveExpiresAt(null);
        orderRepository.save(order);

        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(compartment.getCompartmentId())
                .eventType("CANCEL_RESERVE")
                .eventPayload("Order " + order.getOrderId() + " released compartment "
                        + compartment.getCompIndex())
                .build();
        deviceEventRepository.save(event);
    }

    /** Gán tủ giao hàng cho đơn mà không giữ ngăn; giữ ngăn là thao tác riêng. */
    @Transactional
    public OrderDTO.OrderResponse assignLocker(String orderId, String lockerId) {
        if (orderId == null || orderId.isBlank()) {
            throw new IllegalArgumentException("Thiếu mã đơn hàng cần chọn tủ!");
        }
        if (lockerId == null || lockerId.isBlank()) {
            throw new IllegalArgumentException("Vui lòng chọn tủ cần giao!");
        }
        // Khoá bi quan dòng đơn: đổi tủ chạy song song với tác vụ tự nhả ngăn quá hạn.
        Order order = orderRepository.findByIdForReleaseWithLock(orderId.trim())
                .orElseThrow(() -> new IllegalArgumentException("Không tìm thấy đơn hàng: " + orderId));

        if (!"PENDING".equalsIgnoreCase(order.getStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Chỉ chọn tủ cho đơn đang chờ gửi. Đơn " + order.getOrderId()
                            + " hiện ở trạng thái " + order.getStatus() + ".");
        }

        Locker targetLocker = lockerRepository.findById(lockerId.trim())
                .orElseThrow(() -> new com.ptit.smartlocker.exception.BusinessException(
                        "Tủ " + lockerId + " không tồn tại."));

        if ("MAINTENANCE".equalsIgnoreCase(targetLocker.getConnectionStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    targetLocker.getName() + " đang bảo trì, vui lòng chọn tủ khác.");
        }
        LocalDateTime now = LocalDateTime.now();
        // GĐ12 — cùng quy tắc với `suggestLockers`: tủ ảo bỏ qua kiểm nhịp tim, tủ thật thì
        // KHÔNG. Thiết bị `Tu_1` im quá 5 phút thì shipper giao vào LOCKER_HN_01 sẽ nhận 409
        // — đúng ý user: tủ thật phải theo dõi được có đang kết nối hay không.
        if (!Boolean.TRUE.equals(targetLocker.getIsVirtual())) {
            if (targetLocker.getLastHeartbeat() == null
                    || targetLocker.getLastHeartbeat().isBefore(now.minusMinutes(HEARTBEAT_FRESH_MINUTES))) {
                throw new com.ptit.smartlocker.exception.BusinessException(
                        targetLocker.getName() + " không có nhịp tim trong "
                                + HEARTBEAT_FRESH_MINUTES + " phút gần đây, không thể giao hàng vào tủ này.");
            }
        }

        Compartment old = order.getCompartment();
        if (old != null && "OCCUPIED".equalsIgnoreCase(old.getStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Ngăn " + old.getCompIndex() + " của tủ cũ đang CHỨA HÀNG (OCCUPIED) nên không thể "
                            + "đổi tủ. Vui lòng liên hệ admin.");
        }

        if (old != null && "RESERVED".equalsIgnoreCase(old.getStatus())) {
            old.setStatus("EMPTY");
            compartmentRepository.save(old);
        }

        order.setLocker(targetLocker);
        order.setCompartment(null);
        order.setShipperReservedAt(null);
        order.setReserveExpiresAt(null);
        orderRepository.save(order);

        DeviceEvent event = DeviceEvent.builder()
                .locker(targetLocker)
                .compartmentId(null)
                .eventType("ASSIGN_LOCKER")
                .eventPayload("Order " + order.getOrderId() + " assigned to " + targetLocker.getLockerId()
                        + " without reserving a compartment")
                .build();
        deviceEventRepository.save(event);

        String tracking = order.getTrackingCode() != null && !order.getTrackingCode().isBlank()
                ? order.getTrackingCode()
                : order.getOrderId();
        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(targetLocker.getLockerId())
                .lockerName(targetLocker.getName())
                .compartmentIndex(null)
                .compartmentSize(null)
                .isShipperReserved(false)
                .reserveExpiresAt(null)
                .expectedDate(order.getExpectedDate())
                .status(order.getStatus())
                .productName(order.getProductName())
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .createdAt(order.getCreatedAt())
                .trackingCode(tracking)
                .build();
    }

    /**
     * Nhãn sức khoẻ — 3 mức cho TỦ THẬT, suy thuần từ {@code lastHeartbeat} (KHÔNG đọc
     * {@code connection_status}).
     *
     * <p>GĐ12: nhánh tủ ảo đặt TRƯỚC mọi phép tính tuổi nhịp tim. Tủ ảo luôn "Online" nhưng có
     * hậu tố "(tủ ảo)" để người đọc không tưởng nhầm đang có thiết bị chạy và gửi nhịp tim thật.
     */
    private String healthLabel(LocalDateTime heartbeat, LocalDateTime now, boolean isVirtual) {
        if (isVirtual) return "Online (tủ ảo)";
        if (heartbeat == null) return "MẤT KẾT NỐI";
        long minutes = java.time.Duration.between(heartbeat, now).toMinutes();
        if (minutes <= HEARTBEAT_FRESH_MINUTES) return "Online";
        if (minutes <= 60) return "Không rõ";
        return "MẤT KẾT NỐI";
    }

    /**
     * 4. Lấy danh sách bưu kiện quá hạn lưu kho để Shipper chủ động thu hồi
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOverdueOrders(String lockerId, String shipperUsername) {
        String lockerFilter = lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId)
                ? null : lockerId.trim();
        User requester = userRepository.findByUsername(shipperUsername)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy người dùng."));
        List<Order> list = "ADMIN".equalsIgnoreCase(requester.getRole())
                ? orderRepository.findOverdueForAdmin(lockerFilter)
                : orderRepository.findOverdueAssignedToShipper(shipperUsername, lockerFilter);

        return list.stream()
                .map(o -> OrderDTO.OrderResponse.builder()
                        .orderId(o.getOrderId())
                        .customerName(o.getCustomerName())
                        .customerPhone(o.getCustomerPhone())
                        .deliveryType(o.getDeliveryType())
                        .lockerId(o.getLocker() != null ? o.getLocker().getLockerId() : null)
                        .lockerName(o.getLocker() != null ? o.getLocker().getName() : null)
                        .compartmentIndex(o.getCompartment() != null ? o.getCompartment().getCompIndex() : null)
                        .compartmentSize(o.getCompartment() != null ? o.getCompartment().getSize() : null)
                        .isShipperReserved(o.getShipperReservedAt() != null)
                        .expectedDate(o.getExpectedDate())
                        .depositedAt(o.getDepositedAt())
                        .expiryDeadline(o.getExpiryDeadline())
                        .status(o.getStatus())
                        .totalAmount(o.getTotalAmount())
                        .paymentMethod(o.getPaymentMethod())
                        .paymentStatus(o.getPaymentStatus())
                        .createdAt(o.getCreatedAt())
                        .assignedShipperUsername(o.getAssignedShipper() != null
                                ? o.getAssignedShipper().getUsername() : null)
                        .build())
                .collect(Collectors.toList());
    }

    /**
     * 5. Shipper thu hồi bưu kiện quá hạn về kho bãi và giải phóng ngăn tủ
     *
     * <p><b>GĐ41 — BẮT BUỘC xác thực bằng QR shipper, đồng bộ với {@link #depositPackage}.</b>
     *
     * <p>Trước GĐ41 hàm này <b>không kiểm danh tính một dòng nào</b>: ai đăng nhập được (kể cả
     * ADMIN) gọi {@code POST /api/shipper/recall-overdue?orderId=…} là thu hồi được, và mã QR hiện ở
     * tab thu hồi lại do client tự bịa nên <b>không tồn tại trong DB</b> (đo thật: 0 dòng mang tiền
     * tố {@code SHIPPER-TOKEN-}, toàn bộ 32 token thật đều là {@code SHIP-…}). Tức cả hai chiều đều
     * sai: mã không dùng được, mà cũng không cần dùng.
     *
     * <p><b>Ba điều kiện dùng đúng câu chữ của {@code depositPackage} (:218-227)</b> để hai tab nói
     * cùng một ngôn ngữ, cộng một điều kiện thứ tư:
     * <ol>
     *   <li>thiếu token → 400 "Vui lòng quét mã QR xác thực danh tính Shipper trước khi gửi hàng!"
     *       (dùng chung câu với nạp hàng);</li>
     *   <li>token không tồn tại → 400 "Mã QR định danh Shipper không hợp lệ!";</li>
     *   <li>{@code isVerified != true} → 400 "Mã QR Shipper chưa được quét xác thực tại trạm tủ!";</li>
     *   <li>token thuộc <b>shipper khác</b> người đang đăng nhập → <b>403</b>.</li>
     * </ol>
     *
     * @param orderId        đơn cần thu hồi
     * @param dynamicToken   mã QR shipper (bắt buộc, lấy từ {@code /api/shipper/token/generate})
     * @param currentUsername <b>lấy từ {@code Principal} của phiên đăng nhập</b> — TUYỆT ĐỐI không
     *                        nhận từ client (điều cấm #3: client không được tự khai danh tính)
     */
    @Transactional
    public void recallOverduePackage(String orderId, String dynamicToken, String currentUsername) {
        Order order = xacThucVaTimDonThuHoi(orderId, dynamicToken, currentUsername);

        order.setStatus("COMPLETED");
        orderRepository.save(order);

        if (order.getCompartment() != null) {
            Compartment compartment = order.getCompartment();
            // Shipper đã thu hồi kiện hàng: giải phóng trạng thái chiếm dụng. Cân nặng thật do
            // HX711 báo qua MqttService.handleCompartmentStatus — không tự đặt 0 ở đây.
            compartment.setStatus("EMPTY");
            compartmentRepository.save(compartment);
        }

        // Hoàn trả 1 slot khả dụng cho ngày hôm nay trên lịch biểu
        if (order.getLocker() != null) {
            LocalDate today = LocalDate.now();
            slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(order.getLocker().getLockerId(), today)
                    .ifPresent(schedule -> {
                        int total = order.getLocker().getTotalCompartments();
                        int currentAvail = schedule.getAvailableSlots() != null ? schedule.getAvailableSlots() : 0;
                        if (currentAvail < total) {
                            schedule.setAvailableSlots(currentAvail + 1);
                            slotScheduleRepository.save(schedule);
                        }
                    });
        }

        // Ghi nhật ký sự kiện thu hồi
        DeviceEvent event = DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(order.getCompartment() != null ? order.getCompartment().getCompartmentId() : null)
                .eventType("RECALL_OVERDUE_SUCCESS")
                .eventPayload("Shipper recalled overdue order " + orderId + " back to warehouse")
                .build();
        deviceEventRepository.save(event);

        // GĐ64a — báo khách (máy khác vẫn nhận) + vai SHIPPER. Trước đây web shipper tự lưu
        // thông báo "đã thu hồi" của khách vào localStorage của CHÍNH trình duyệt shipper.
        if (notificationService != null) {
            notificationService.recalled(order);
        }

        // GĐ46 — BỎ lệnh mở cửa ở đây. Trước GĐ46 khối này phát
        // `OPEN_DOOR/SHIPPER_RECALL` ở **cuối** hàm, tức sau khi đơn đã `COMPLETED` và ngăn đã
        // `EMPTY`: thứ tự ngược (DB báo ngăn trống trong khi hàng còn trong tủ) và cửa bị mở
        // **lần hai** ngay sau khi shipper vừa đóng. Nay cửa được mở ở bước riêng
        // `openForRecall` (nút "Mở Cửa Ngăn"), trước khi lấy hàng; hàm này chỉ chốt nghiệp vụ.
    }

    /**
     * GĐ51 — TẠO "ĐƠN QUÁ HẠN" ĐỂ DEMO/THỬ luồng thu hồi (nút "+ Thêm đơn quá hạn" ở tab thu hồi).
     *
     * <p><b>Vì sao cần endpoint này:</b> sau khi xoá {@code ORD-OVERDUE01} (yêu cầu user 17/11),
     * muốn có một đơn quá hạn để thử luồng thu hồi thì phải gõ SQL tay
     * ({@code scripts/evidence/mk-overdue.sql}) — người dùng không làm được trên web. Đây là công
     * cụ demo, cùng loại với "Quét đơn quá hạn" của ADMIN.
     *
     * <p><b>Điều cấm #1 — KHÔNG GÕ CÂN GIẢ.</b> Hàm này <b>không</b> chạm
     * {@code current_weight}/{@code ir_detected}: đó là số của cảm biến HX711/IR, không phải của
     * đơn hàng. Bài học GĐ50: {@code mk-overdue.sql} ghi tay {@code current_weight=850} rồi hệ
     * thống tin đó là hàng thật, và retained cũ còn làm số đó sống lại sau mỗi lần restart.
     *
     * <p><b>Điều cấm #2 — chỉ lấy ngăn {@code EMPTY} và tủ không bảo trì.</b> Dùng
     * {@link CompartmentRepository#findWithLockByLockerIdAndStatus} (khoá bi quan) đúng như luồng
     * đặt ngăn, nên hai shipper bấm cùng lúc không thể nhận cùng một ngăn.
     *
     * <p><b>Điều cấm #3 — KHÔNG viết quy tắc quá hạn thứ hai.</b> Đơn được tạo với
     * {@code expiryDeadline} trong quá khứ rồi đặt thẳng {@code OVERDUE}: đó <b>chính là</b> kết quả
     * mà {@link OverdueSchedulerService} sẽ tạo ra cho một đơn {@code DEPOSITED} đã hết hạn. Không
     * sửa, không gọi lại scheduler (nó quét cả bảng và bắn sự kiện).
     *
     * @param lockerId        tủ nhận đơn (null/rỗng ⇒ tủ mặc định {@code mqtt.locker.id.default})
     * @param customerUsername tên đăng nhập khách (null/rỗng ⇒ {@code khachhang})
     * @param createdBy       <b>lấy từ {@code Principal}</b> — không nhận từ body
     */
    @Transactional
    public OrderDTO.OrderResponse createOverdueOrder(String lockerId, String customerUsername,
                                                     String createdBy) {
        String maTu = (lockerId == null || lockerId.isBlank()) ? "LOCKER_HN_01" : lockerId.trim();
        Locker locker = lockerRepository.findById(maTu)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy tủ: " + maTu));

        // Cùng luật với luồng đặt ngăn: tủ đang bảo trì thì không nhận đơn.
        if ("MAINTENANCE".equalsIgnoreCase(locker.getConnectionStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    tenTu(locker) + " đang bảo trì, không thể tạo đơn quá hạn tại đây. "
                            + "Vui lòng chọn tủ khác hoặc mở khoá bảo trì trước.");
        }

        // Khoá bi quan ngăn EMPTY — đúng cơ chế chống tranh chấp của `OrderService.createOrder`.
        List<Compartment> nganTrong = compartmentRepository
                .findWithLockByLockerIdAndStatus(locker.getLockerId(), "EMPTY");
        if (nganTrong.isEmpty()) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    tenTu(locker) + " không còn ngăn trống nào — không tạo được đơn quá hạn. "
                            + "Hãy thu hồi hoặc giải phóng một ngăn trước.");
        }
        Compartment ngan = nganTrong.get(0);

        // Khách: mặc định `khachhang` (đúng khách mẫu của dự án). Không có thì báo rõ, KHÔNG bịa tên.
        //
        // GĐ51 (Chief chốt 16:41) — CHỈ tra theo KHOÁ DUY NHẤT: `username`, hoặc `userId` dạng chuỗi.
        // KHÔNG khớp theo họ tên: họ tên không duy nhất, hai khách cùng tên là gán nhầm đơn cho
        // người khác mà không ai biết. `fullName` chỉ để HIỂN THỊ ở hộp chọn.
        String khoa = (customerUsername == null || customerUsername.isBlank())
                ? "khachhang" : customerUsername.trim();
        User khach = userRepository.findByUsername(khoa)
                .orElseGet(() -> {
                    try {
                        return userRepository.findById(Long.parseLong(khoa)).orElse(null);
                    } catch (NumberFormatException e) {
                        return null; // không phải số ⇒ chỉ có thể là username, đã tra ở trên
                    }
                });
        if (khach == null) {
            throw new com.ptit.smartlocker.exception.ResourceNotFoundException(
                    "Không tìm thấy khách hàng có tài khoản hoặc mã '" + khoa + "' để gán cho đơn.");
        }
        if (!"CUSTOMER".equalsIgnoreCase(khach.getRole())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Tài khoản '" + khoa + "' không phải khách hàng (vai trò: " + khach.getRole()
                            + ") — không gán đơn được.");
        }

        LocalDateTime now = LocalDateTime.now();
        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        Order don = Order.builder()
                .orderId(orderId)
                .customerName(khach.getFullName() != null ? khach.getFullName() : khoa)
                .customerPhone(khach.getPhone() != null ? khach.getPhone() : "")
                .deliveryType("LOCKER")
                .locker(locker)
                .compartment(ngan)
                // Giữ đúng ngữ nghĩa của `OverdueSchedulerService`: đơn đã nằm trong tủ từ hôm kia và
                // hạn lưu kho đã qua ⇒ chắc chắn quá hạn theo quy tắc 24h00 N+1.
                .expectedDate(LocalDate.now().minusDays(3))
                .depositedAt(now.minusDays(2))
                .expiryDeadline(now.minusDays(1))
                .status("OVERDUE")
                .totalAmount(java.math.BigDecimal.ZERO)
                .paymentMethod("ONLINE_VIETQR")
                .paymentStatus("PAID")
                .productName("Đơn quá hạn (tạo thử)")
                .build();
        // Gộp ThanhChung (review #6) — danh sách quá hạn và guard thu hồi chỉ cho shipper được phân
        // công; đơn thử do shipper tạo mà để trống thì chính người tạo không thấy/không thu hồi được.
        if (createdBy != null && !createdBy.isBlank()) {
            userRepository.findByUsername(createdBy.trim())
                    .filter(u -> "SHIPPER".equalsIgnoreCase(u.getRole()))
                    .ifPresent(don::setAssignedShipper);
        }
        orderRepository.save(don);

        // Cấp mã nhận hàng như mọi đơn đã nạp: KHÔNG dùng lại `OrderService.generateRandomQrToken`
        // (private) và KHÔNG sửa `OrderService` (ngoài phạm vi) — sinh cùng thuật toán ở đây.
        PickupCredential cred = PickupCredential.builder()
                .order(don)
                .otpCode(sinhOtp6So())
                .qrToken(sinhQrTokenDuyNhat())
                .isUsed(false)
                .failedAttempts(0)
                // Đơn đã quá hạn nên mã cũng hết hạn — khách tra sẽ thấy "quá hạn", đúng phép thử (3).
                .expiredAt(now.minusDays(1))
                .build();
        credentialRepository.save(cred);

        ngan.setStatus("OCCUPIED");
        compartmentRepository.save(ngan);

        deviceEventRepository.save(DeviceEvent.builder()
                .locker(locker)
                .compartmentId(ngan.getCompartmentId())
                .eventType("OVERDUE_ORDER_CREATED")
                .eventPayload("Đơn quá hạn tạo thử " + orderId + " (ngăn " + ngan.getCompIndex()
                        + ") — người tạo: " + (createdBy == null || createdBy.isBlank() ? "?" : createdBy))
                .build());

        return OrderDTO.OrderResponse.builder()
                .orderId(don.getOrderId())
                .customerName(don.getCustomerName())
                .customerPhone(don.getCustomerPhone())
                .deliveryType(don.getDeliveryType())
                .lockerId(locker.getLockerId())
                .lockerName(locker.getName())
                .lockerAddress(locker.getAddress())
                .compartmentIndex(ngan.getCompIndex())
                .compartmentSize(ngan.getSize())
                .expectedDate(don.getExpectedDate())
                .depositedAt(don.getDepositedAt())
                .expiryDeadline(don.getExpiryDeadline())
                .status(don.getStatus())
                .productName(don.getProductName())
                .totalAmount(don.getTotalAmount())
                .paymentMethod(don.getPaymentMethod())
                .paymentStatus(don.getPaymentStatus())
                .qrToken(cred.getQrToken())
                .otpCode(cred.getOtpCode())
                // GĐ69 — hạn RIÊNG của OTP (`otp_expired_at`), không phải hạn mã nhận hàng.
                .otpExpiresAt(cred.getOtpExpiredAt())
                .createdAt(don.getCreatedAt())
                .build();
    }

    /**
     * GĐ51 — OTP 6 số ngẫu nhiên an toàn.
     *
     * <p>KHÔNG kiểm trùng ở đây: {@code findValidByLockerAndOtp} chỉ trả credential của đơn
     * {@code DEPOSITED}, còn đơn tạo thử là {@code OVERDUE} ⇒ lọc đó luôn rỗng, kiểm cũng bằng không.
     * Trùng OTP giữa hai đơn quá hạn không phải vấn đề: cửa nhận hàng chặn đơn {@code OVERDUE}
     * trước khi so mã ({@code PickupService:388}), nên mã của đơn quá hạn không mở được tủ.
     */
    private String sinhOtp6So() {
        java.security.SecureRandom rnd = new java.security.SecureRandom();
        return String.format("%06d", rnd.nextInt(1_000_000));
    }

    /** GĐ51 — qrToken 32 byte ngẫu nhiên Base64URL, kiểm trùng như `OrderService`. */
    private String sinhQrTokenDuyNhat() {
        java.security.SecureRandom rnd = new java.security.SecureRandom();
        for (int attempt = 0; attempt < 5; attempt++) {
            byte[] bytes = new byte[32];
            rnd.nextBytes(bytes);
            String candidate = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            if (credentialRepository.findByQrToken(candidate).isEmpty()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Không sinh được qrToken duy nhất sau 5 lần thử");
    }

    /**
     * GĐ46 — MỞ CỬA NGĂN cho shipper thu hồi hàng quá hạn (nút "Mở Cửa Ngăn #N").
     *
     * <p><b>Vì sao phải là endpoint riêng:</b> trước GĐ46 nút này ở frontend chỉ
     * {@code playSolenoidSound()} + đổi state UI sang {@code DOOR_OPEN} — <b>không gọi API nào</b>,
     * nên màn hình báo "cửa đang mở" mà tủ thật vẫn khoá. Lệnh mở duy nhất của luồng thu hồi nằm ở
     * cuối {@code recallOverduePackage}, tức phải bấm "Đã Lấy Hàng & Đóng Cửa" mới mở được cửa.
     *
     * <p><b>Điều cấm #2 — KHÔNG đổi trạng thái đơn/ngăn:</b> đơn vẫn {@code OVERDUE}, ngăn vẫn
     * {@code OCCUPIED} cho tới bước "Đã Lấy Hàng & Đóng Cửa". Đây là khác biệt cốt lõi so với
     * {@code LockerService.forceUnlockCompartment} (đặt ngăn {@code EMPTY} ngay lúc mở) — dùng
     * endpoint đó cho thu hồi là báo sai "ngăn trống" khi hàng còn trong tủ.
     *
     * <p><b>Không chép lại phần kiểm danh tính:</b> dùng chung {@link #xacThucVaTimDonThuHoi}
     * với {@code recallOverduePackage} để hai đường không bao giờ lệch luật.
     *
     * @return {@code true} nếu lệnh đã được phát xuống tủ, {@code false} nếu broker chưa kết nối
     *         (vẫn ghi {@code command_logs}) — frontend phải báo lỗi thay vì giả vờ đã mở.
     */
    @Transactional
    public boolean openForRecall(String orderId, String dynamicToken, String currentUsername) {
        Order order = xacThucVaTimDonThuHoi(orderId, dynamicToken, currentUsername);

        if (mqttService == null || order.getLocker() == null || order.getCompartment() == null) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Không xác định được tủ/ngăn của đơn " + orderId + " để mở khoá.");
        }

        boolean daPhat = mqttService.publishCommand(
                order.getLocker().getLockerId(),
                order.getCompartment().getCompIndex(),
                "OPEN_DOOR",
                "SHIPPER_RECALL",
                order.getOrderId());

        deviceEventRepository.save(DeviceEvent.builder()
                .locker(order.getLocker())
                .compartmentId(order.getCompartment().getCompartmentId())
                .eventType(daPhat ? "RECALL_DOOR_OPEN_REQUESTED" : "RECALL_DOOR_OPEN_FAILED")
                .eventPayload("Shipper mở cửa ngăn #" + order.getCompartment().getCompIndex()
                        + " để thu hồi đơn " + orderId + (daPhat ? "" : " (broker chưa kết nối)"))
                .build());

        return daPhat;
    }

    /**
     * GĐ46 — PHẦN KIỂM DÙNG CHUNG của hai đường thu hồi: xác thực QR shipper rồi trả về đơn
     * {@code OVERDUE} cần thao tác.
     *
     * <p>Tách ra để {@code recallOverduePackage} (chốt nghiệp vụ) và {@code openForRecall} (mở cửa)
     * <b>không thể lệch luật</b>. Điều cấm #3 của thẻ GĐ46: không được nới bất kỳ kiểm tra QR nào
     * của GĐ41 — bốn điều kiện dưới đây giữ nguyên câu chữ và thứ tự.
     *
     * <p>Câu chữ lỗi giữ NGUYÊN như trước GĐ41 refactor để {@code ShipperRecallAuthTests} (GĐ41) và
     * hai tab shipper nói cùng một ngôn ngữ.
     */
    private Order xacThucVaTimDonThuHoi(String orderId, String dynamicToken, String currentUsername) {
        // (1)(2)(3) — cùng thứ tự và cùng câu chữ với `depositPackage`.
        if (dynamicToken == null || dynamicToken.isBlank()) {
            throw new RuntimeException("Vui lòng quét mã QR xác thực danh tính Shipper trước khi gửi hàng!");
        }

        ShipperIdentityToken token = tokenRepository.findByDynamicToken(dynamicToken.trim())
                .orElseThrow(() -> new RuntimeException("Mã QR định danh Shipper không hợp lệ!"));

        if (!Boolean.TRUE.equals(token.getIsVerified())) {
            throw new RuntimeException("Mã QR Shipper chưa được quét xác thực tại trạm tủ!");
        }

        // (4) Token phải thuộc CHÍNH người đang đăng nhập. 403 vì đây là lỗi quyền, không phải
        // dữ liệu sai — token hợp lệ nhưng không phải của bạn.
        if (currentUsername == null || token.getShipperId() == null
                || !token.getShipperId().equalsIgnoreCase(currentUsername)) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Mã QR này không thuộc tài khoản đang đăng nhập!");
        }

        // Review bảo mật #7 — khoá dòng đơn: hai lần thu hồi đồng thời thì lần sau chờ lần trước
        // commit rồi mới đọc trạng thái (đã COMPLETED → 409), không cùng lọt qua kiểm OVERDUE.
        Order order = orderRepository.findByIdForUpdate(orderId)
                .orElseThrow(() -> new com.ptit.smartlocker.exception.ResourceNotFoundException(
                        "Không tìm thấy đơn hàng: " + orderId));

        // GĐ13 — lỗi trạng thái là vi phạm nghiệp vụ → BusinessException → 409, KHÔNG phải 400.
        //
        // Lý do quan trọng: nút "Thu hồi" trên web giờ gọi API thật. Nếu bấm lần thứ hai (đơn đã
        // COMPLETED) mà server trả 400 thì client khó phân biệt "request sai" với "đơn này rồi".
        // 409 = tài nguyên đang ở trạng thái không cho phép thao tác, đúng bản chất.
        if (!"OVERDUE".equalsIgnoreCase(order.getStatus())) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Đơn " + orderId + " không ở trạng thái quá hạn lưu kho (hiện tại: "
                            + order.getStatus() + "), không thể thu hồi.");
        }

        User assignedShipper = order.getAssignedShipper();
        if (assignedShipper == null || currentUsername == null
                || !currentUsername.equalsIgnoreCase(assignedShipper.getUsername())) {
            throw new org.springframework.security.access.AccessDeniedException(
                    "Đơn hàng này chưa được phân công cho tài khoản shipper đang đăng nhập.");
        }

        return order;
    }
}
