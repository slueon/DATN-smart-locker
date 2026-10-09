package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
@Slf4j
public class PickupService {

    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final long LOCKOUT_DURATION_MINUTES = 2;

    private final PickupCredentialRepository credentialRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;

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
    @Transactional
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
            throw new RuntimeException("Trạm tủ đang tạm khóa thao tác nhận đồ do phát hiện nhập sai quá nhiều lần. Vui lòng thử lại sau " 
                    + Math.max(1, remainingSecs) + " giây!");
        }

        PickupCredential credential = null;

        // 2. Tra cứu mã xác thực (hỗ trợ có hoặc không có orderId)
        if (request.getOrderId() != null && !request.getOrderId().isBlank()) {
            credential = credentialRepository.findByOrder_OrderId(request.getOrderId().trim())
                    .orElse(null);

            if (credential == null || credential.getOrder().getLocker() == null ||
                    !credential.getOrder().getLocker().getLockerId().equalsIgnoreCase(lockerId)) {
                recordLockerFailure(lockerId);
                throw new RuntimeException("Không tìm thấy đơn hàng tại trạm tủ này!");
            }

            // Kiểm tra trạng thái khóa của đơn hàng
            if (credential.getFailedAttempts() >= MAX_FAILED_ATTEMPTS) {
                throw new RuntimeException("Mã nhận hàng của đơn này đã bị tạm khóa do nhập sai quá 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
            }

            boolean isMatch = "OTP".equalsIgnoreCase(request.getAuthMethod()) ?
                    code.equals(credential.getOtpCode()) :
                    code.equals(credential.getQrToken());

            if (!isMatch) {
                int newFailCount = credential.getFailedAttempts() + 1;
                credential.setFailedAttempts(newFailCount);
                credentialRepository.save(credential);
                recordLockerFailure(lockerId);

                int remaining = MAX_FAILED_ATTEMPTS - newFailCount;
                if (remaining <= 0) {
                    throw new RuntimeException("Mã nhận hàng đã bị tạm khóa do nhập sai liên tiếp 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
                } else {
                    throw new RuntimeException("Mã xác thực không chính xác! Bạn còn " + remaining + " lần thử.");
                }
            }
        } else {
            // Không truyền orderId: Tra cứu trực tiếp theo mã OTP hoặc QR của tủ
            if ("OTP".equalsIgnoreCase(request.getAuthMethod())) {
                credential = credentialRepository.findValidByLockerAndOtp(lockerId, code)
                        .orElse(null);
            } else {
                credential = credentialRepository.findValidByLockerAndQr(lockerId, code)
                        .orElse(null);
            }

            if (credential == null) {
                recordLockerFailure(lockerId);
                throw new RuntimeException("Mã OTP/QR không chính xác hoặc đã hết hạn!");
            }

            if (credential.getFailedAttempts() >= MAX_FAILED_ATTEMPTS) {
                throw new RuntimeException("Mã nhận hàng này đã bị tạm khóa do nhập sai quá 5 lần! Vui lòng tạo mã OTP mới trên ứng dụng.");
            }
        }

        // 3. Kiểm tra thời hạn hiệu lực của mã
        if (LocalDateTime.now().isAfter(credential.getExpiredAt())) {
            throw new RuntimeException("Mã OTP/QR nhận hàng đã hết hiệu lực. Vui lòng tạo mã OTP mới trên ứng dụng!");
        }

        // 4. Kiểm tra trạng thái đơn hàng
        Order order = credential.getOrder();
        if (!"DEPOSITED".equalsIgnoreCase(order.getStatus())) {
            if ("PENDING".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Kiện hàng chưa được nhân viên giao nạp vào tủ! Vui lòng chờ thông báo.");
            }
            if ("COMPLETED".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Đơn hàng này đã được lấy thành công trước đó!");
            }
            if ("OVERDUE".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Đơn hàng này đã quá hạn lưu kho, hệ thống đã khóa mã lấy đồ!");
            }
            throw new RuntimeException("Đơn hàng không ở trạng thái sẵn sàng để lấy đồ (Trạng thái: " + order.getStatus() + ")!");
        }

        // 5. Xác thực thành công: Reset số lần thử sai, cập nhật trạng thái đơn và giải phóng ngăn tủ
        credential.setFailedAttempts(0);
        credential.setIsUsed(true);
        credential.setUsedAt(LocalDateTime.now());
        credentialRepository.save(credential);

        clearLockerFailure(lockerId);

        order.setStatus("COMPLETED");
        orderRepository.save(order);

        Compartment compartment = order.getCompartment();
        if (compartment != null) {
            compartment.setStatus("EMPTY");
            compartment.setCurrentWeight(0.0);
            compartmentRepository.save(compartment);
        }

        log.info("Xác thực nhận hàng thành công cho đơn {} tại tủ {} ngăn {}", 
                order.getOrderId(), lockerId, compartment != null ? compartment.getCompIndex() : "N/A");

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
     * Khách hàng ấn "Mã OTP" trên app: Sinh mã OTP mới (Hiệu lực đúng 5 phút).
     * Ràng buộc chặt chẽ:
     * - Chỉ cho phép tạo khi đơn hàng đang ở trạng thái DEPOSITED (đã vào tủ).
     * - Kiểm tra số điện thoại sở hữu đơn (Chống IDOR).
     * - Reset failedAttempts = 0.
     */
    @Transactional
    public String generateNewOtp(String orderId, String customerPhone) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy đơn hàng: " + orderId));

        // Ràng buộc chống IDOR: Nếu có cung cấp số điện thoại, bắt buộc phải trùng khớp
        if (customerPhone != null && !customerPhone.isBlank() &&
                !order.getCustomerPhone().equalsIgnoreCase(customerPhone.trim())) {
            throw new RuntimeException("Số điện thoại không khớp với người nhận của đơn hàng này!");
        }

        // Ràng buộc trạng thái đơn hàng
        if (!"DEPOSITED".equalsIgnoreCase(order.getStatus())) {
            if ("PENDING".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Kiện hàng chưa được nhân viên nạp vào tủ! Vui lòng chờ sau khi nạp hàng để nhận mã OTP.");
            }
            if ("COMPLETED".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Đơn hàng này đã được nhận thành công trước đó!");
            }
            if ("OVERDUE".equalsIgnoreCase(order.getStatus())) {
                throw new RuntimeException("Đơn hàng đã quá hạn lưu kho tại tủ. Vui lòng liên hệ quản trị viên để được hỗ trợ!");
            }
            throw new RuntimeException("Không thể tạo mã OTP cho đơn hàng đang ở trạng thái: " + order.getStatus());
        }

        PickupCredential credential = credentialRepository.findByOrder_OrderId(orderId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy thông tin nhận hàng của đơn: " + orderId));

        // Sinh mã OTP 6 số ngẫu nhiên an toàn bảo mật
        String newOtp = String.format("%06d", secureRandom.nextInt(1_000_000));
        credential.setOtpCode(newOtp);
        credential.setExpiredAt(LocalDateTime.now().plusMinutes(5)); // Hiệu lực 5 phút
        credential.setFailedAttempts(0); // Mở khóa và reset số lần thử sai
        credential.setIsUsed(false);
        credentialRepository.save(credential);

        log.info("Đã tạo mã OTP mới cho đơn hàng {}: hết hạn sau 5 phút, reset failedAttempts về 0", orderId);
        return newOtp;
    }

    @Transactional
    public String generateNewOtp(String orderId) {
        return generateNewOtp(orderId, null);
    }

    private void recordLockerFailure(String lockerId) {
        if (lockerId == null || lockerId.isBlank()) return;
        lockerFailureMap.compute(lockerId, (id, tracker) -> {
            if (tracker == null) {
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
