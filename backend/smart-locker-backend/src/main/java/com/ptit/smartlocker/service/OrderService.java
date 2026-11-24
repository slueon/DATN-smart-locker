package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.*;
import com.ptit.smartlocker.repository.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service
@Slf4j
public class OrderService {

    /** Nguồn ngẫu nhiên an toàn bảo mật dùng riêng cho việc sinh mã QR nhận hàng. */
    private static final SecureRandom QR_TOKEN_RANDOM = new SecureRandom();

    /** Số byte ngẫu nhiên của một qrToken (32 byte = 256 bit, mã hóa Base64URL ra 43 ký tự). */
    private static final int QR_TOKEN_BYTES = 32;

    private final OrderRepository orderRepository;
    private final LockerRepository lockerRepository;
    private final PickupCredentialRepository pickupCredentialRepository;

    public OrderService(
            OrderRepository orderRepository,
            LockerRepository lockerRepository,
            PickupCredentialRepository pickupCredentialRepository) {
        this.orderRepository = orderRepository;
        this.lockerRepository = lockerRepository;
        this.pickupCredentialRepository = pickupCredentialRepository;
    }

    /**
     * GĐ53 — tên tủ để ghép vào câu báo lỗi, KHÔNG lặp chữ "Tủ".
     *
     * <p>Tên trong CSDL đã là {@code "Tủ Giao Nhận KTX A1 (Trụ Sở PTIT)"}, nên câu cũ
     * {@code "Tủ " + locker.getName()} in ra {@code "Tủ Tủ Giao Nhận…"}. Hàm này bỏ tiền tố khi tên
     * đã bắt đầu bằng "Tủ", và luôn trả về một chuỗi bắt đầu bằng "Tủ".
     */
    private static String tenTu(com.ptit.smartlocker.entity.Locker locker) {
        String ten = locker == null ? null : locker.getName();
        if (ten == null || ten.isBlank()) {
            return "Tủ";
        }
        String t = ten.trim();
        // "Tủ Giao Nhận…" / "tủ giao nhận…" / "TỦ …" đều đã có tiền tố ⇒ giữ nguyên.
        if (t.regionMatches(true, 0, "Tủ", 0, 2)) {
            return t;
        }
        return "Tủ " + t;
    }

    /** Tạo đơn chờ nạp, không giữ lịch suất hoặc ngăn vật lý. */
    @Transactional
    public OrderDTO.OrderResponse createOrder(OrderDTO.CheckoutRequest request) {
        String orderId = "ORD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();

        BigDecimal totalAmount = request.getTotalAmount() != null ? request.getTotalAmount() : BigDecimal.ZERO;
        String productName = request.getProductName() != null && !request.getProductName().isBlank()
                ? request.getProductName().trim() : "Bưu kiện Smart Locker";

        LocalDate deliveryDate = request.getDeliveryDate() != null ? request.getDeliveryDate() : LocalDate.now().plusDays(2);
        if (deliveryDate.isBefore(LocalDate.now())) {
            throw new IllegalArgumentException("Ngày nhận hàng không thể là ngày trong quá khứ!");
        }
        String payMethod = request.getPaymentMethod() != null ? request.getPaymentMethod() : "ONLINE_VIETQR";
        String payStatus = request.getPaymentStatus() != null ? request.getPaymentStatus() :
                ("COD".equalsIgnoreCase(payMethod) ? "UNPAID" : "PAID");

        Order order = Order.builder()
                .orderId(orderId)
                .customerName(request.getCustomerName())
                .customerPhone(request.getCustomerPhone())
                .deliveryType(request.getDeliveryType())
                .expectedDate(deliveryDate)
                .paymentMethod(payMethod)
                .paymentStatus(payStatus)
                .status("PENDING")
                .totalAmount(totalAmount)
                .productName(productName)
                .build();

        // Gán tủ đích nếu người tạo đã chọn, nhưng không giữ lịch/ngăn tại bước tạo đơn.
        // Shipper có thể đặt trước ngăn riêng; nếu không, kiosk cho shipper chọn ngăn khi nạp.
        String requestedLockerId = request.getLockerId();
        boolean hasRequestedLocker = requestedLockerId != null && !requestedLockerId.isBlank();

        // Xử lý giao tại tủ thông minh (Smart Locker)
        if ("LOCKER".equalsIgnoreCase(request.getDeliveryType()) && hasRequestedLocker) {
            Locker locker = lockerRepository.findById(requestedLockerId)
                    .orElseThrow(() -> new RuntimeException("Tủ không tồn tại: " + requestedLockerId));
            order.setLocker(locker);

            // Không nhận đơn giao đến tủ đang bảo trì.
            if ("MAINTENANCE".equalsIgnoreCase(locker.getConnectionStatus())) {
                throw new com.ptit.smartlocker.exception.BusinessException(
                        tenTu(locker) + " đang bảo trì, vui lòng chọn tủ khác hoặc giao tận nhà.");
            }

        }

        orderRepository.save(order);

        // 3. Tạo mã nhận hàng (QR Token ngẫu nhiên an toàn bảo mật, KHÔNG suy ra từ dữ liệu đơn)
        String qrToken = generateRandomQrToken();

        PickupCredential credential = PickupCredential.builder()
                .order(order)
                .otpCode("") // Sẽ được cấp khi hàng đã nạp vào tủ (DEPOSITED)
                .qrToken(qrToken)
                .isUsed(false)
                .failedAttempts(0)
                .expiredAt(LocalDateTime.now().plusDays(2))
                .build();
        pickupCredentialRepository.save(credential);

        return mapToOrderResponse(order, qrToken, null, true);
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId, String phone) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));

        boolean isAuthorized = phone != null && !phone.isBlank() && order.getCustomerPhone().equalsIgnoreCase(phone.trim());

        // Ràng buộc chống IDOR: Nếu có cung cấp số điện thoại, bắt buộc phải khớp với đơn
        if (phone != null && !phone.isBlank() && !isAuthorized) {
            throw new RuntimeException("Bạn không có quyền truy cập thông tin đơn hàng này!");
        }

        // Chỉ tiết lộ mã mở tủ khi đã xác thực đúng số điện thoại và đơn hàng đã ở trong tủ (DEPOSITED)
        boolean revealSecrets = isAuthorized && "DEPOSITED".equalsIgnoreCase(order.getStatus());
        OrderDTO.OrderResponse response = mapToOrderResponse(order, null, null, revealSecrets);

        // Che giấu dữ liệu định danh PII nếu người truy vấn chưa xác thực khớp SĐT
        if (!isAuthorized) {
            if (response.getCustomerPhone() != null && response.getCustomerPhone().length() >= 7) {
                String rawPhone = response.getCustomerPhone();
                response.setCustomerPhone(rawPhone.substring(0, 3) + "****" + rawPhone.substring(rawPhone.length() - 3));
            }
            if (response.getCustomerName() != null && response.getCustomerName().length() > 2) {
                response.setCustomerName(response.getCustomerName().charAt(0) + "***" + response.getCustomerName().charAt(response.getCustomerName().length() - 1));
            }
        }

        return response;
    }

    @Transactional(readOnly = true)
    public OrderDTO.OrderResponse getOrderById(String orderId) {
        return getOrderById(orderId, null);
    }

    /**
     * Tra cứu danh sách đơn theo SĐT khách hàng.
     *
     * <p>W3: danh sách KHÔNG BAO GIỜ chứa qrToken/otpCode, kể cả đơn DEPOSITED. Trước đây
     * nhánh này truyền includeSecrets=true cho mọi đơn DEPOSITED, nên chỉ cần biết SĐT của
     * người khác là đọc được mã mở tủ. Muốn lấy mã mở tủ phải đi qua GET /api/orders/{id}
     * với SĐT khớp chủ phiên (đã siết ở controller).
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOrdersByCustomerPhone(String phone) {
        if (phone == null || phone.isBlank()) {
            return List.of();
        }
        List<Order> orders = orderRepository.findByCustomerPhone(phone.trim());
        return orders.stream()
                .map(o -> mapToOrderResponse(o, null, null, false))
                .toList();
    }

    /**
     * GĐ7 — danh sách đơn cho ADMIN (tuỳ chọn lọc theo trạng thái / tủ).
     *
     * <p><b>KHÔNG BAO GIỜ lộ {@code qrToken}/{@code otpCode}:</b> luôn gọi
     * {@code mapToOrderResponse(o, null, null, false)}. Đây là endpoint trả DANH SÁCH — nếu lộ
     * mã mở tủ trong danh sách thì chỉ cần đọc một API là mở được mọi tủ đã nạp hàng. Quy tắc
     * này giống {@link #getOrdersByCustomerPhone} (W3).
     *
     * <p>{@code status} nhận {@code null}/{@code 'ALL'} = mọi trạng thái. Giá trị không hợp lệ
     * được coi như {@code null} thay vì ném lỗi — admin gõ sai bộ lọc không nên làm hỏng trang,
     * và endpoint chỉ đọc nên không có rủi ro dữ liệu.
     */
    @Transactional(readOnly = true)
    public List<OrderDTO.OrderResponse> getOrdersForAdmin(String status, String lockerId) {
        String statusFilter = (status == null || status.isBlank() || "ALL".equalsIgnoreCase(status.trim()))
                ? null
                : status.trim().toUpperCase();
        String lockerFilter = (lockerId == null || lockerId.isBlank() || "ALL".equalsIgnoreCase(lockerId.trim()))
                ? null
                : lockerId.trim();

        return orderRepository.findForAdmin(statusFilter, lockerFilter).stream()
                .map(o -> mapToOrderResponse(o, null, null, false))
                .toList();
    }

    public OrderDTO.OrderResponse mapToOrderResponse(Order order, String preloadedQr, String preloadedOtp) {
        return mapToOrderResponse(order, preloadedQr, preloadedOtp, true);
    }

    public OrderDTO.OrderResponse mapToOrderResponse(Order order, String preloadedQr, String preloadedOtp, boolean includeSecrets) {
        String qrToken = null;
        String otpCode = null;
        // GĐ27 — hạn OTP đi kèm mã. Response trước đây chỉ có `otpCode`, nên client cần cả hai để
        // biết mã còn hiệu lực lại luôn nhận `null` cho hạn và kết luận "đã hết hạn" — modal OTP
        // hiện sai ngay sau khi tạo mã. Giá trị lấy từ `pickup_credentials.expired_at`, KHÔNG tự
        // cộng 5 phút ở client.
        LocalDateTime otpExpiresAt = null;

        if (includeSecrets) {
            qrToken = preloadedQr;
            otpCode = preloadedOtp;
            if (qrToken == null || otpCode == null) {
                var credOpt = pickupCredentialRepository.findByOrder_OrderId(order.getOrderId());
                if (credOpt.isPresent()) {
                    qrToken = credOpt.get().getQrToken();
                    otpCode = credOpt.get().getOtpCode();
                    otpExpiresAt = credOpt.get().getExpiredAt();
                }
            }
        }

        String productName = order.getProductName() != null ? order.getProductName() : "Bưu kiện Smart Locker";

        return OrderDTO.OrderResponse.builder()
                .orderId(order.getOrderId())
                .customerName(order.getCustomerName())
                .customerPhone(order.getCustomerPhone())
                .deliveryType(order.getDeliveryType())
                .lockerId(order.getLocker() != null ? order.getLocker().getLockerId() : null)
                .lockerName(order.getLocker() != null ? order.getLocker().getName() : null)
                // GĐ36 — địa chỉ trạm để màn khách hiện "đi tới đâu". Trước đây DTO thiếu field
                // này nên dòng địa chỉ trong "Vị Trí Trạm Tủ" luôn trống (minh phát hiện ở GĐ35).
                .lockerAddress(order.getLocker() != null ? order.getLocker().getAddress() : null)
                .compartmentIndex(order.getCompartment() != null ? order.getCompartment().getCompIndex() : null)
                .expectedDate(order.getExpectedDate())
                .depositedAt(order.getDepositedAt())
                .expiryDeadline(order.getExpiryDeadline())
                .status(order.getStatus())
                .productName(productName)
                .totalAmount(order.getTotalAmount())
                .paymentMethod(order.getPaymentMethod())
                .paymentStatus(order.getPaymentStatus())
                .qrToken(qrToken)
                .otpCode(otpCode)
                .otpExpiresAt(otpExpiresAt)
                .createdAt(order.getCreatedAt())
                .trackingCode(order.getTrackingCode() != null && !order.getTrackingCode().isBlank()
                        ? order.getTrackingCode() : order.getOrderId())
                .assignedShipperUsername(order.getAssignedShipper() != null
                        ? order.getAssignedShipper().getUsername() : null)
                .build();
    }

    /**
     * Sinh qrToken nhận hàng bằng nguồn ngẫu nhiên an toàn bảo mật (SecureRandom).
     * - 32 byte ngẫu nhiên mã hóa Base64URL (không padding) -> chuỗi 43 ký tự.
     * - KHÔNG chứa, KHÔNG suy ra được từ orderId hay bất kỳ dữ liệu đơn hàng nào.
     * - Có kiểm tra trùng trong CSDL để tôn trọng ràng buộc UNIQUE của cột qr_token.
     */
    private String generateRandomQrToken() {
        for (int attempt = 0; attempt < 5; attempt++) {
            byte[] randomBytes = new byte[QR_TOKEN_BYTES];
            QR_TOKEN_RANDOM.nextBytes(randomBytes);
            String candidate = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
            if (pickupCredentialRepository.findByQrToken(candidate).isEmpty()) {
                return candidate;
            }
            log.warn("Phát hiện trùng qrToken ngẫu nhiên (lần thử {}), sinh lại mã khác.", attempt + 1);
        }
        throw new IllegalStateException("Không thể sinh qrToken duy nhất sau 5 lần thử!");
    }

}
