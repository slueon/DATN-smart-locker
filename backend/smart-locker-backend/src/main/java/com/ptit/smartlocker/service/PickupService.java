package com.ptit.smartlocker.service;

import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.exception.ResourceNotFoundException;


import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class PickupService {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final long LOCKOUT_DURATION_MINUTES = 2;

    private final PickupCredentialRepository credentialRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;
    private final LockerSlotScheduleRepository slotScheduleRepository;

    /**
     * GĐ32 — bắn sự kiện cho web khách khi đơn chốt {@code COMPLETED}.
     *
     * <p>{@code required = false}: giữ nguyên khả năng khởi động khi service này không có mặt
     * (giống cách {@code mqttService} đang được inject), và các test cũ dựng service trực tiếp
     * không phải sửa constructor.
     */
    @Autowired(required = false)
    private KioskEventService kioskEventService;

    /** GĐ64a — thông báo máy chủ (tự nuốt lỗi). {@code required=false}: không đổi constructor. */
    @Autowired(required = false)
    private NotificationService notificationService;

    /** GĐ32 — chống trùng: mỗi đơn chỉ bắn 1 sự kiện, dù cả 2 đường cùng chốt. */
    private final java.util.Set<String> daBaoPickupSuccess =
            java.util.concurrent.ConcurrentHashMap.newKeySet();

    @Autowired(required = false)
    @Lazy
    private MqttService mqttService;

    public PickupService(
            PickupCredentialRepository credentialRepository,
            OrderRepository orderRepository,
            CompartmentRepository compartmentRepository,
            LockerSlotScheduleRepository slotScheduleRepository) {
        this.credentialRepository = credentialRepository;
        this.orderRepository = orderRepository;
        this.compartmentRepository = compartmentRepository;
        this.slotScheduleRepository = slotScheduleRepository;
    }

    private final SecureRandom secureRandom = new SecureRandom();

    // Bộ nhớ đệm theo dõi số lần nhập sai liên tiếp tại trạm tủ: Map<LockerId, LockerFailureTracker>
    private final Map<String, LockerFailureTracker> lockerFailureMap = new ConcurrentHashMap<>();

    private static class LockerFailureTracker {
        int failures = 0;
        LocalDateTime lockoutUntil = null;
    }

    /**
     * Khách hàng lấy đồ tại tủ (Hỗ trợ nhập OTP trên màn hình cảm ứng hoặc Quét mã QR qua GM65).
     * Tích hợp cơ chế chống Brute-force: Tạm khóa khi nhập sai quá 5 lần.
     */
    // GĐ54-L1: noRollbackFor — nhánh sai mã tăng failed_attempts rồi ném BusinessException; nếu
    // rollback thì bộ đếm không bao giờ được lưu. Mọi BusinessException trong hàm này đều ném TRƯỚC
    // khi ghi trạng thái đơn/ngăn (mục 5 chỉ chạy khi thành công), nên không giữ lại ghi dở nào.
    @Transactional(noRollbackFor = BusinessException.class)
    public PickupDTO.PickupResponse verifyAndPickup(PickupDTO.VerifyCredentialRequest request) {
        String lockerId = request.getLockerId() != null ? request.getLockerId().trim() : "";
        String code = request.getCode() != null ? request.getCode().trim() : "";

        if (lockerId.isEmpty() || code.isEmpty()) {
            throw new IllegalArgumentException("Vui lòng cung cấp mã trạm tủ và mã xác thực nhận hàng!");
        }

        // 1. Kiểm tra khóa chống tấn công Brute-force cấp trạm tủ
        LockerFailureTracker tracker = lockerFailureMap.get(lockerId);
        if (tracker != null && tracker.lockoutUntil != null && LocalDateTime.now().isBefore(tracker.lockoutUntil)) {
            long remainingSecs = Duration.between(LocalDateTime.now(), tracker.lockoutUntil).getSeconds();
            throw new BusinessException("Trạm tủ đang tạm khóa thao tác nhận đồ do phát hiện nhập sai quá nhiều lần. Vui lòng thử lại sau " 
                    + Math.max(1, remainingSecs) + " giây!");
        }

        PickupCredential credential = null;

        // GĐ69 — phương thức xác thực quyết định xét hạn nào: QR chỉ xét `expired_at` (hạn MÃ NHẬN
        // HÀNG), OTP xét CẢ `expired_at` và `otp_expired_at` (hạn riêng của OTP). Trước GĐ69 chỉ có
        // một cột hạn dùng chung nên `request-otp` ghi đè làm QR chết sau 5 phút.
        boolean isOtpMethod = "OTP".equalsIgnoreCase(request.getAuthMethod());

        // 2. Tra cứu mã xác thực (hỗ trợ có hoặc không có orderId)
        if (request.getOrderId() != null && !request.getOrderId().isBlank()) {
            credential = credentialRepository.findByOrder_OrderId(request.getOrderId().trim())
                    .orElse(null);

            if (credential == null || credential.getOrder().getLocker() == null ||
                    !credential.getOrder().getLocker().getLockerId().equalsIgnoreCase(lockerId)) {
                recordLockerFailure(lockerId);
                throw new ResourceNotFoundException("Không tìm thấy đơn hàng tại trạm tủ này!");
            }

            // Kiểm tra trạng thái khóa của đơn hàng
            if (credential.getFailedAttempts() >= MAX_FAILED_ATTEMPTS) {
                throw new BusinessException("Mã nhận hàng của đơn này đã bị tạm khóa do nhập sai quá 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
            }

            // Chỉ so khớp đúng trường tương ứng với phương thức xác thực:
            // - authMethod=OTP  -> chỉ chấp nhận otpCode
            // - ngược lại (QR)  -> chỉ chấp nhận qrToken
            // TUYỆT ĐỐI không suy ra mã hợp lệ từ orderId (không có nhánh "PKUP-" + orderId,
            // không có tiền tố "-", không nhận chính orderId làm mã mở tủ).
            boolean isMatch;
            if (isOtpMethod) {
                isMatch = credential.getOtpCode() != null
                        && !credential.getOtpCode().isEmpty()
                        && code.equals(credential.getOtpCode());
            } else {
                isMatch = credential.getQrToken() != null
                        && !credential.getQrToken().isEmpty()
                        && code.equalsIgnoreCase(credential.getQrToken());
            }

            if (!isMatch) {
                int newFailCount = credential.getFailedAttempts() + 1;
                credential.setFailedAttempts(newFailCount);
                credentialRepository.save(credential);
                recordLockerFailure(lockerId);

                int remaining = MAX_FAILED_ATTEMPTS - newFailCount;
                if (remaining <= 0) {
                    throw new BusinessException("Mã nhận hàng đã bị tạm khóa do nhập sai liên tiếp 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
                } else {
                    throw new BusinessException("Mã xác thực không chính xác! Bạn còn " + remaining + " lần thử.");
                }
            }
        } else {
            // Không truyền orderId: Tra cứu trực tiếp theo mã OTP hoặc QR của tủ
            if (isOtpMethod) {
                List<PickupCredential> list = credentialRepository.findValidByLockerAndOtp(lockerId, code);
                credential = list.stream().filter(c -> conHieuLuc(c, true)).findFirst().orElse(null);
            } else {
                // Chỉ tra cứu khớp CHÍNH XÁC qrToken trong CSDL.
                // Đã bỏ toàn bộ nhánh "đoán" mã từ orderId (bỏ tiền tố "PKUP-", bỏ hậu tố "-T",
                // không tra ngược theo orderId) vì đó chính là đường vòng bỏ qua mã bí mật.
                List<PickupCredential> list = credentialRepository.findValidByLockerAndQr(lockerId, code);
                credential = list.stream().filter(c -> conHieuLuc(c, false)).findFirst().orElse(null);
            }

            if (credential == null) {
                recordLockerFailure(lockerId);
                throw new BusinessException("Mã OTP/QR không chính xác hoặc đã hết hạn!");
            }

            if (credential.getFailedAttempts() >= MAX_FAILED_ATTEMPTS) {
                throw new BusinessException("Mã nhận hàng này đã bị tạm khóa do nhập sai quá 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
            }
        }

        // 3. Kiểm tra thời hạn hiệu lực của mã
        //
        // GĐ69 — hạn xét theo PHƯƠNG THỨC: QR chỉ xét `expired_at`; OTP xét cả `expired_at` lẫn
        // `otp_expired_at`. Đường OTP đã lọc ở nhánh tra cứu không orderId, nhưng nhánh CÓ orderId
        // không lọc được (chưa biết credential là của đơn nào) nên phải chặn ở đây — không có chốt
        // này thì đơn có `otp_expired_at` quá khứ vẫn mở được bằng OTP.
        if (!conHieuLuc(credential, isOtpMethod)) {
            // GĐ72 — quá hạn LƯU KHO thì xin OTP mới cũng vô ích (OTP bị chặn trần bằng hạn lưu
            // kho) ⇒ không được bảo khách "tạo mã OTP mới", nếu không khách lặp mãi trong khoảng
            // ≤10 phút trước khi tác vụ nền chuyển đơn sang OVERDUE.
            if (quaHanLuuKho(credential)) {
                throw new BusinessException(MSG_QUA_HAN_LUU_KHO);
            }
            throw new BusinessException("Mã OTP/QR nhận hàng đã hết hiệu lực. Vui lòng tạo mã OTP mới trên ứng dụng!");
        }

        // 4. Kiểm tra trạng thái đơn hàng
        //
        // GĐ31a — `PICKUP_OPENED` là trạng thái TRUNG GIAN: khách đã xác thực mã và cửa đang/đã
        // mở nhưng CHƯA chốt là hàng đã ra. Phải cho đi tiếp (và cho phép mở lại bằng chính mã cũ)
        // — nếu chặn như trước thì đúng ca lỗi user hỏi: quên lấy hàng, đóng cửa, và không còn
        // đường nào mở lại.
        Order order = credential.getOrder();
        boolean dangMoNhan = "PICKUP_OPENED".equalsIgnoreCase(order.getStatus());
        if (!"DEPOSITED".equalsIgnoreCase(order.getStatus()) && !dangMoNhan) {
            if ("PENDING".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Kiện hàng chưa được nhân viên giao nạp vào tủ! Vui lòng chờ thông báo.");
            }
            if ("COMPLETED".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Đơn hàng này đã được lấy thành công trước đó!");
            }
            if ("OVERDUE".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Đơn hàng này đã quá hạn lưu kho, hệ thống đã khóa mã lấy đồ!");
            }
            throw new BusinessException("Đơn hàng không ở trạng thái sẵn sàng để lấy đồ (Trạng thái: " + order.getStatus() + ")!");
        }

        // 5. Xác thực thành công.
        //
        // GĐ31a — ĐÂY LÀ CHỖ SỬA CHÍNH CỦA TH2 (khách quên lấy hàng).
        //
        // Trước GĐ31a, hàm này chốt dứt điểm ngay khi mã khớp: `isUsed = true` (mã cũ vô hiệu VĨNH
        // VIỄN), đơn `COMPLETED`, ngăn `EMPTY` — KHÔNG đọc cảm biến. Nếu khách quên hàng:
        //   1. ngăn thành EMPTY ⇒ hệ thống cấp cho đơn khác ⇒ hai đơn một ngăn;
        //   2. mã cũ không dùng lại được;
        //   3. đơn COMPLETED nên `generateNewOtp` cũng chặn ⇒ khách MẤT HÀNG, không đường tự lấy lại.
        //
        // Nay chỉ mở phiên nhận: đơn sang `PICKUP_OPENED`, ngăn VẪN `OCCUPIED`, `isUsed` VẪN 0,
        // và chỉ ghi `usedAt` để biết lần mở gần nhất. Trạng thái cuối do luồng chốt theo cảm biến
        // quyết định (xem `MqttService.chotPhienLayHang`): hàng đã ra thật thì mới COMPLETED +
        // isUsed=true; còn hàng thì quay về DEPOSITED và mã cũ dùng lại được.
        credential.setFailedAttempts(0);
        credential.setUsedAt(LocalDateTime.now());
        credentialRepository.save(credential);

        clearLockerFailure(lockerId);

        // `dangMoNhan` = đang mở lại bằng chính mã cũ ⇒ giữ nguyên phiên, chỉ gia hạn `usedAt`.
        if (!dangMoNhan) {
            order.setStatus("PICKUP_OPENED");
            orderRepository.save(order);
        }

        Compartment compartment = order.getCompartment();

        // GĐ31a — KHÔNG chốt `COMPLETED` / không đặt ngăn `EMPTY` / không `isUsed = true` ở đây.
        //
        // Trạng thái cuối do luồng CẢM BIẾN quyết định (`MqttService.chotPhienLayHang`), vì chỉ
        // cảm biến mới biết khách có thật sự lấy hàng hay không:
        //   • cửa đóng + weight ≈ 0 + ir = 0  → COMPLETED + ngăn EMPTY + isUsed = true;
        //   • cửa đóng mà CÒN HÀNG             → về DEPOSITED + mã cũ dùng lại được.
        // Đây chính là điều cấm #1/#2 của thẻ.

        // GĐ32 — BẮN SỰ KIỆN "ĐÃ MỞ NGĂN ĐỂ LẤY HÀNG".
        //
        // Lưu ý: đây là sự kiện "đã mở cửa", KHÔNG phải "lấy hàng thành công". Sự kiện
        // `PICKUP_SUCCESS` chỉ được bắn ở chỗ CHỐT (khi cảm biến xác nhận hàng đã ra) — xem
        // `MqttService.chotPhienLayHang`. Nếu bắn PICKUP_SUCCESS ở đây thì khách thấy popup
        // "thành công" trong khi hàng còn trong tủ (đúng ràng buộc của thẻ GĐ32).
        log.info("Mở phiên nhận hàng cho đơn {} tại tủ {} ngăn {} — chờ cảm biến xác nhận",
                order.getOrderId(), lockerId, compartment != null ? compartment.getCompIndex() : "N/A");

        // GĐ72 (#5) — KHÔNG hoàn slot ở đây. Mở cửa chưa có nghĩa là hàng đã ra (ngăn vẫn
        // OCCUPIED, khách có thể quên hàng hoặc mở lại). Trước GĐ72 mỗi lần mở đều +1 slot hôm nay
        // ⇒ tủ báo thừa chỗ trống. Slot được hoàn ở `chotPhienLayHang` khi chốt COMPLETED.

        log.info("Xác thực nhận hàng thành công cho đơn {} tại tủ {} ngăn {}", 
                order.getOrderId(), lockerId, compartment != null ? compartment.getCompIndex() : "N/A");

        // Phát lệnh MQTT kích Solenoid 12V mở ngăn tủ cho khách lấy hàng và thông báo về MQTTX
        if (mqttService != null && compartment != null) {
            mqttService.publishCommand(lockerId, compartment.getCompIndex(), "OPEN_DOOR", "CUSTOMER_PICKUP", order.getOrderId());
        }

        return PickupDTO.PickupResponse.builder()
                .success(true)
                .message("Xác thực thành công! Ngăn tủ số " + (compartment != null ? compartment.getCompIndex() : "N/A") + " đang được mở.")
                .orderId(order.getOrderId())
                .compartmentIndex(compartment != null ? compartment.getCompIndex() : null)
                .relayPin(compartment != null ? compartment.getRelayPin() : null)
                .customerName(order.getCustomerName())
                .build();
    }

    /**
     * GĐ31a — CHỐT PHIÊN LẤY HÀNG THEO CẢM BIẾN.
     *
     * <p>Gọi từ {@code MqttService} khi cửa ngăn ĐÓNG và ngăn đang thuộc một đơn ở trạng thái
     * {@code PICKUP_OPENED}. Đây là chỗ DUY NHẤT được chốt {@code COMPLETED} — thay cho việc chốt
     * ngay lúc mã khớp (lỗi TH2: khách quên hàng thì mất hàng).
     *
     * <p><b>Luật chốt:</b>
     * <ul>
     *   <li>Còn hàng ({@code conHang == true}) → đơn quay về {@code DEPOSITED}, ngăn vẫn
     *       {@code OCCUPIED}; GĐ67: cấp qrToken MỚI, xoá OTP ⇒ mã cũ hết hiệu lực, khách lấy lần 2
     *       bằng mã mới như lần 1.</li>
     *   <li>Hết hàng → {@code COMPLETED}, ngăn {@code EMPTY}, {@code isUsed = true}.</li>
     * </ul>
     *
     * @return {@code true} nếu đã chốt hết hàng (COMPLETED), {@code false} nếu còn hàng (quay về
     *         DEPOSITED) hoặc không có đơn nào đang mở phiên.
     */
    @Transactional
    public boolean chotPhienLayHang(Order order, Compartment compartment, boolean conHang) {
        if (order == null || !"PICKUP_OPENED".equalsIgnoreCase(order.getStatus())) {
            return false;
        }

        credentialRepository.findByOrder_OrderId(order.getOrderId()).ifPresent(cred -> {
            if (!conHang) {
                cred.setIsUsed(true);
                cred.setUsedAt(LocalDateTime.now());
            } else {
                // GĐ67 — còn hàng ⇒ mã cũ (QR + OTP) HẾT hiệu lực; lấy lần 2 đi lại quy trình như
                // lần 1 bằng MÃ MỚI: QR mới ngẫu nhiên (cùng hàm sinh với OrderService), OTP xoá
                // (khách xin OTP mới qua request-otp). Giữ nguyên hạn lưu kho (`expiredAt`).
                // GĐ69 — xoá luôn hạn riêng của OTP ⇒ OTP cũ chết thật, không chỉ chết vì mã rỗng.
                cred.setQrToken(OrderService.generateRandomQrToken(credentialRepository));
                cred.setOtpCode("");
                cred.setOtpExpiredAt(null);
                cred.setIsUsed(false);
                cred.setFailedAttempts(0);
                cred.setUsedAt(null);
            }
            credentialRepository.save(cred);
        });

        if (conHang) {
            order.setStatus("DEPOSITED");
            orderRepository.save(order);
            if (compartment != null) {
                compartment.setStatus("OCCUPIED");
                compartmentRepository.save(compartment);
            }
            log.info("Khách CHƯA lấy hết hàng ở đơn {} — đơn về DEPOSITED, đã cấp mã mới (mã cũ hết hiệu lực)",
                    order.getOrderId());
            if (kioskEventService != null && order.getLocker() != null) {
                kioskEventService.record(order.getLocker().getLockerId(), "PICKUP_LEFT_BEHIND",
                        order.getOrderId(), order.getTrackingCode(),
                        compartment != null ? compartment.getCompIndex() : null, null,
                        "Bạn chưa lấy kiện hàng — cửa đã đóng nhưng hàng vẫn trong tủ. Mã cũ đã hết hiệu lực, dùng mã mới để lấy lại.");
            }
            if (notificationService != null) {
                notificationService.pickupLeftBehind(order,
                        "Cửa đã đóng nhưng kiện hàng vẫn trong tủ"
                                + (compartment != null ? " ngăn #" + compartment.getCompIndex() : "")
                                + ". Mã cũ đã hết hiệu lực — dùng mã QR mới hoặc xin OTP mới để lấy lại.");
            }
            return false;
        }

        order.setStatus("COMPLETED");
        orderRepository.save(order);
        if (compartment != null) {
            compartment.setStatus("EMPTY");
            compartmentRepository.save(compartment);
        }
        // GĐ72 (#5) — hoàn slot hôm nay đúng lúc ngăn thật sự trống (trước: lúc mở cửa).
        hoanSlotHomNay(order);
        log.info("Khách đã lấy hàng xong đơn {} — COMPLETED, ngăn EMPTY", order.getOrderId());

        // GĐ32 — sự kiện "lấy hàng thành công" bắn ở ĐÂY (chỗ chốt thật), không phải lúc mở cửa.
        if (kioskEventService != null && order.getLocker() != null
                && daBaoPickupSuccess.add(order.getOrderId())) {
            kioskEventService.record(order.getLocker().getLockerId(), KioskEventService.PICKUP_SUCCESS,
                    order.getOrderId(), order.getTrackingCode(),
                    compartment != null ? compartment.getCompIndex() : null, null,
                    "Lấy hàng thành công" + (compartment != null ? " ngăn #" + compartment.getCompIndex() : ""));
        }
        // GĐ64a — ngoài khối chống trùng `daBaoPickupSuccess` (bộ nhớ, mất khi restart); chống
        // trùng 60 s của NotificationService lo trường hợp MQTT + API cùng chốt.
        if (notificationService != null) {
            notificationService.pickupSuccess(order);
        }
        return true;
    }

    /**
     * GĐ32 — chống trùng khi cả API lẫn firmware cùng chốt một đơn: mỗi đơn chỉ bắn MỘT sự kiện
     * {@code PICKUP_SUCCESS}. Đặt ở đây để {@code MqttService} gọi được khi nó tự chốt.
     */
    public boolean danhDauDaBaoPickupSuccess(String orderId) {
        return orderId != null && daBaoPickupSuccess.add(orderId);
    }

    /**
     * Khách hàng ấn "Mã OTP" trên app: Sinh mã OTP mới (Hiệu lực đúng 5 phút).
     * Ràng buộc chặt chẽ:
     * - Chỉ cho phép tạo khi đơn hàng đang ở trạng thái DEPOSITED (đã vào tủ).
     * - Kiểm tra số điện thoại sở hữu đơn (Chống IDOR).
     * - Reset failedAttempts = 0.
     */
    @Transactional
    public String generateNewOtp(String orderId, String customerPhone) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy đơn hàng: " + orderId));

        // Ràng buộc chống IDOR: Bắt buộc phải cung cấp số điện thoại và phải trùng khớp với người nhận
        if (customerPhone == null || customerPhone.isBlank()) {
            throw new BusinessException("Vui lòng cung cấp số điện thoại để xác thực quyền sở hữu đơn hàng!");
        }
        if (!order.getCustomerPhone().equalsIgnoreCase(customerPhone.trim())) {
            throw new BusinessException("Số điện thoại không khớp với người nhận của đơn hàng này!");
        }

        // Ràng buộc trạng thái đơn hàng
        //
        // GĐ31a — `PICKUP_OPENED` vẫn phải TẠO ĐƯỢC mã mới: đơn đang trong phiên nhận (khách quên
        // hàng rồi đóng cửa) nên khách cần mã mới nếu mã cũ hết hạn. `COMPLETED` vẫn chặn như cũ.
        if (!"DEPOSITED".equalsIgnoreCase(order.getStatus())
                && !"PICKUP_OPENED".equalsIgnoreCase(order.getStatus())) {
            if ("PENDING".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Kiện hàng chưa được nhân viên nạp vào tủ! Vui lòng chờ sau khi nạp hàng để nhận mã OTP.");
            }
            if ("COMPLETED".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Đơn hàng này đã được nhận thành công trước đó!");
            }
            if ("OVERDUE".equalsIgnoreCase(order.getStatus())) {
                throw new BusinessException("Đơn hàng đã quá hạn lưu kho tại tủ. Vui lòng liên hệ quản trị viên để được hỗ trợ!");
            }
            throw new BusinessException("Không thể tạo mã OTP cho đơn hàng đang ở trạng thái: " + order.getStatus());
        }

        PickupCredential credential = credentialRepository.findByOrder_OrderId(orderId)
                .orElseThrow(() -> new ResourceNotFoundException("Không tìm thấy thông tin nhận hàng của đơn: " + orderId));

        // GĐ72 — đã qua hạn lưu kho nhưng tác vụ nền (10 phút/lần) chưa chuyển OVERDUE: không cấp
        // OTP. Trước GĐ72 vẫn trả 200 + mã mới, nhưng hạn OTP bị chặn trần bằng `expired_at` đã
        // qua ⇒ mã chết ngay khi sinh, web hiện "Hết hạn (quá 5p)" và khách bấm đổi mã mãi.
        if (quaHanLuuKho(credential)) {
            throw new BusinessException(MSG_QUA_HAN_LUU_KHO);
        }

        // Sinh mã OTP 6 số ngẫu nhiên an toàn bảo mật, chống trùng lặp tại trạm tủ
        String newOtp;
        int attempts = 0;
        String lockerId = (order.getLocker() != null) ? order.getLocker().getLockerId() : "";
        do {
            newOtp = String.format("%06d", secureRandom.nextInt(1_000_000));
            attempts++;
        } while (attempts < 10 && !lockerId.isEmpty() && !credentialRepository.findValidByLockerAndOtp(lockerId, newOtp).isEmpty());

        credential.setOtpCode(newOtp);
        // GĐ69 — CHỈ đặt hạn riêng của OTP, KHÔNG đụng `expired_at` (hạn mã nhận hàng / hạn lưu
        // kho). Trước GĐ69 dòng này là `setExpiredAt(now + 5 phút)` ⇒ xin OTP làm QR cũng chết sau
        // 5 phút. Lấy `min(now + 5 phút, expired_at)`: OTP không bao giờ sống lâu hơn hạn lưu kho.
        LocalDateTime hanOtp = LocalDateTime.now().plusMinutes(5);
        if (credential.getExpiredAt() != null && hanOtp.isAfter(credential.getExpiredAt())) {
            hanOtp = credential.getExpiredAt();
        }
        credential.setOtpExpiredAt(hanOtp);
        credential.setFailedAttempts(0); // Mở khóa và reset số lần thử sai
        credential.setIsUsed(false);
        credentialRepository.save(credential);

        log.info("Đã tạo mã OTP mới cho đơn hàng {}: hạn OTP {} (hạn lưu kho {}), reset failedAttempts về 0",
                orderId, hanOtp, credential.getExpiredAt());
        return newOtp;
    }

    @Transactional
    public String generateNewOtp(String orderId) {
        return generateNewOtp(orderId, null);
    }

    /**
     * GĐ69 — mã còn hiệu lực không, xét hạn THEO PHƯƠNG THỨC xác thực.
     *
     * <ul>
     *   <li>{@code expired_at} là hạn của MÃ NHẬN HÀNG (hạn lưu kho) — áp cho CẢ QR lẫn OTP.</li>
     *   <li>{@code otp_expired_at} là hạn riêng của OTP — CHỈ xét khi {@code isOtp == true};
     *       {@code NULL} = chưa từng cấp OTP ⇒ OTP bị từ chối, QR không bị ảnh hưởng.</li>
     * </ul>
     *
     * <p>Biên: {@code now == hạn} vẫn còn hiệu lực (giữ nguyên luật cũ {@code !now.isAfter(...)}).
     */
    /**
     * GĐ72 (#5) — cộng lại 1 slot vào lịch HÔM NAY của tủ (không vượt tổng số ngăn). Cùng quy ước
     * "hoàn vào hôm nay" với huỷ đặt trước và thu hồi quá hạn ({@code ShipperService}).
     */
    private void hoanSlotHomNay(Order order) {
        if (order.getLocker() == null) {
            return;
        }
        slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(order.getLocker().getLockerId(), LocalDate.now())
                .ifPresent(schedule -> {
                    int total = order.getLocker().getTotalCompartments();
                    int currentAvail = schedule.getAvailableSlots() != null ? schedule.getAvailableSlots() : 0;
                    if (currentAvail < total) {
                        schedule.setAvailableSlots(currentAvail + 1);
                        slotScheduleRepository.save(schedule);
                    }
                });
    }

    /** GĐ72 — lời báo chung khi đơn đã qua hạn lưu kho (dù trạng thái còn là DEPOSITED). */
    static final String MSG_QUA_HAN_LUU_KHO =
            "Đơn hàng đã quá hạn lưu kho tại tủ, mã nhận hàng đã hết hiệu lực. Vui lòng liên hệ quản trị viên để được hỗ trợ!";

    /**
     * GĐ72 — đơn đã qua hạn lưu kho chưa: xét {@code expired_at} của mã (hạn mã nhận hàng) và
     * {@code expiry_deadline} của đơn. Hai giá trị lẽ ra bằng nhau; xét cả hai để dữ liệu cũ đã lệch
     * (trước GĐ72 nhánh MQTT {@code deposit_success} không đồng bộ) vẫn được nhận ra.
     */
    private boolean quaHanLuuKho(PickupCredential credential) {
        LocalDateTime now = LocalDateTime.now();
        if (credential.getExpiredAt() != null && now.isAfter(credential.getExpiredAt())) {
            return true;
        }
        Order order = credential.getOrder();
        return order != null && order.getExpiryDeadline() != null && now.isAfter(order.getExpiryDeadline());
    }

    private boolean conHieuLuc(PickupCredential credential, boolean isOtp) {
        LocalDateTime now = LocalDateTime.now();
        if (credential.getExpiredAt() == null || now.isAfter(credential.getExpiredAt())) {
            return false;
        }
        if (!isOtp) {
            return true;
        }
        LocalDateTime otpHan = credential.getOtpExpiredAt();
        return otpHan != null && !now.isAfter(otpHan);
    }

    private void recordLockerFailure(String lockerId) {
        if (lockerId == null || lockerId.isBlank()) return;
        lockerFailureMap.compute(lockerId, (id, tracker) -> {
            // GĐ75 (#16) — đợt khoá trước đã hết hạn ⇒ đếm lại từ 0. Trước đây `failures` vẫn ≥ 5
            // nên chỉ 1 lần sai sau khi hết khoá là trạm bị khoá tiếp 2 phút.
            if (tracker == null || (tracker.lockoutUntil != null
                    && !LocalDateTime.now().isBefore(tracker.lockoutUntil))) {
                tracker = new LockerFailureTracker();
            }
            tracker.failures++;
            if (tracker.failures >= MAX_FAILED_ATTEMPTS) {
                tracker.lockoutUntil = LocalDateTime.now().plusMinutes(LOCKOUT_DURATION_MINUTES);
                log.warn("Trạm tủ {} bị tạm khóa thao tác nhận đồ trong {} phút do có {} lần nhập sai liên tiếp!",
                        lockerId, LOCKOUT_DURATION_MINUTES, tracker.failures);
            }
            return tracker;
        });
    }

    private void clearLockerFailure(String lockerId) {
        if (lockerId == null) return;
        lockerFailureMap.remove(lockerId);
    }
}
