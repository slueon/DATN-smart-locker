package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.PickupDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.PickupCredential;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class PickupService {

    private final PickupCredentialRepository credentialRepository;
    private final OrderRepository orderRepository;
    private final CompartmentRepository compartmentRepository;

    /**
     * Khách hàng lấy đồ tại tủ (Hỗ trợ 2 phương thức: Nhập OTP trên màn hình cảm ứng hoặc Quét mã QR qua GM65)
     */
    @Transactional
    public PickupDTO.PickupResponse verifyAndPickup(PickupDTO.VerifyCredentialRequest request) {
        PickupCredential credential;

        if ("OTP".equalsIgnoreCase(request.getAuthMethod())) {
            credential = credentialRepository.findValidByLockerAndOtp(request.getLockerId(), request.getCode())
                    .orElseThrow(() -> new RuntimeException("Mã OTP không chính xác hoặc đã được sử dụng!"));
        } else {
            // Xác thực qua mã QR
            credential = credentialRepository.findValidByLockerAndQr(request.getLockerId(), request.getCode())
                    .orElseThrow(() -> new RuntimeException("Mã QR không hợp lệ hoặc đã được sử dụng!"));
        }

        // Kiểm tra thời hạn hiệu lực (24h00 của ngày N+1)
        if (LocalDateTime.now().isAfter(credential.getExpiredAt())) {
            throw new RuntimeException("Mã nhận hàng đã quá hạn lưu trữ (Sau 24h00 ngày hôm sau). Vui lòng liên hệ quản trị viên!");
        }

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

        // Đánh dấu mã đã sử dụng
        credential.setIsUsed(true);
        credential.setUsedAt(LocalDateTime.now());
        credentialRepository.save(credential);

        // Cập nhật trạng thái đơn hàng sang HOÀN THÀNH
        order.setStatus("COMPLETED");
        orderRepository.save(order);

        // Giải phóng ngăn tủ về trạng thái EMPTY
        Compartment compartment = order.getCompartment();
        if (compartment != null) {
            compartment.setStatus("EMPTY");
            compartment.setCurrentWeight(0.0);
            compartmentRepository.save(compartment);
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
}
