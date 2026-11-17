package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.CapacityDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.service.LockerService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping("/api/lockers")
public class LockerController {

    private final LockerService lockerService;

    public LockerController(LockerService lockerService) {
        this.lockerService = lockerService;
    }

    /**
     * Lấy danh sách toàn bộ các tủ để hiển thị lên bản đồ số Leaflet
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<Locker>>> getAllLockers() {
        return ResponseEntity.ok(ApiResponse.ok(lockerService.getAllLockers()));
    }

    /**
     * Xem thông tin chi tiết một tủ
     */
    @GetMapping("/{lockerId}")
    public ResponseEntity<ApiResponse<Locker>> getLockerById(@PathVariable String lockerId) {
        return ResponseEntity.ok(ApiResponse.ok(lockerService.getLockerById(lockerId)));
    }

    /**
     * Lấy danh sách các ngăn tủ của tủ
     */
    @GetMapping("/{lockerId}/compartments")
    public ResponseEntity<ApiResponse<List<Compartment>>> getCompartments(@PathVariable String lockerId) {
        return ResponseEntity.ok(ApiResponse.ok(lockerService.getCompartmentsByLocker(lockerId)));
    }

    /**
     * Kiểm tra sức chứa theo ngày với cơ chế Graceful Degradation (Gợi ý ngày thay thế / Giao tận nhà)
     */
    @GetMapping("/{lockerId}/capacity")
    public ResponseEntity<ApiResponse<CapacityDTO.CapacityCheckResponse>> checkCapacity(
            @PathVariable String lockerId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        CapacityDTO.CapacityCheckResponse response = lockerService.checkCapacity(lockerId, date);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /**
     * Mở khóa khẩn cấp ngăn tủ từ Admin từ xa.
     *
     * <h2>GĐ53 — MỞ CỬA KHÔNG ĐỒNG NGHĨA VỚI GIẢI PHÓNG NGĂN</h2>
     *
     * <p>Trước GĐ53 endpoint này luôn trả "…và giải phóng ngăn thành công!" trong khi service đặt
     * {@code EMPTY} vô điều kiện — kể cả khi ngăn còn đơn {@code DEPOSITED}. Đo thật: {@code ORD-DCCA6036}
     * vẫn {@code DEPOSITED} trỏ ngăn 1 mà ngăn 1 thành {@code EMPTY}, rồi GĐ51 cấp ngăn đó cho
     * {@code ORD-99A2C56E} ⇒ hai đơn một ngăn. Message giờ phản ánh <b>đúng việc đã xảy ra</b>.
     */
    @PostMapping("/{lockerId}/compartments/{compIndex}/unlock")
    public ResponseEntity<ApiResponse<Compartment>> forceUnlockCompartment(
            @PathVariable String lockerId,
            @PathVariable Integer compIndex) {
        // Đọc TRƯỚC khi mở: sau khi service chạy, trạng thái có thể đã đổi nên không còn biết
        // "trước đó ngăn có đơn hay không".
        java.util.List<String> donDangGiu = lockerService.findOrdersHoldingCompartment(lockerId, compIndex);

        Compartment comp = lockerService.forceUnlockCompartment(lockerId, compIndex);

        String message;
        if (!donDangGiu.isEmpty()) {
            // Nói rõ: cửa ĐÃ mở, nhưng ngăn vẫn thuộc đơn — để admin không tưởng ngăn đã trống mà
            // cấp cho đơn khác (đúng sự cố GĐ53).
            message = "Đã mở khoá khẩn cấp ngăn #" + compIndex + " của " + lockerId
                    + ". Ngăn VẪN GIỮ trạng thái " + comp.getStatus()
                    + " cho đơn " + String.join(", ", donDangGiu)
                    + " — chưa giải phóng ngăn vì đơn còn trong tủ.";
        } else {
            message = "Mở khóa khẩn cấp và giải phóng ngăn thành công!";
        }
        return ResponseEntity.ok(ApiResponse.ok(message, comp));
    }

    /**
     * GĐ10 ý 1 — khoá / mở khoá MỘT NGĂN để bảo trì.
     *
     * <p>{@code byUsername} lấy từ {@link java.security.Principal} (đã xác thực ADMIN ở
     * {@code SecurityConfig}) chứ KHÔNG nhận từ body — nhận từ body là để client tự khai mình
     * là ai, làm nhật ký bảo trì mất giá trị.
     */
    @PostMapping("/{lockerId}/compartments/{compIndex}/maintenance")
    public ResponseEntity<ApiResponse<Compartment>> setCompartmentMaintenance(
            @PathVariable String lockerId,
            @PathVariable Integer compIndex,
            @RequestBody(required = false) MaintenanceRequest request,
            java.security.Principal principal) {
        boolean lock = request == null || request.getLock() == null || request.getLock();
        String reasonCode = request != null ? request.getReasonCode() : null;
        String note = request != null ? request.getNote() : null;
        String byUsername = principal != null ? principal.getName() : "unknown";

        Compartment comp = lockerService.setCompartmentMaintenance(
                lockerId, compIndex, lock, reasonCode, note, byUsername);
        return ResponseEntity.ok(ApiResponse.ok(
                (lock ? "Đã khoá ngăn #" : "Đã mở khoá ngăn #") + compIndex + " để bảo trì.", comp));
    }

    /**
     * GĐ10 ý 2 — khoá / mở khoá TOÀN TỦ.
     *
     * <p>Khoá khi còn đơn `PENDING` sẽ bị {@code BusinessException} → 409 kèm danh sách mã đơn.
     */
    @PostMapping("/{lockerId}/maintenance")
    public ResponseEntity<ApiResponse<Locker>> setLockerMaintenance(
            @PathVariable String lockerId,
            @RequestBody(required = false) MaintenanceRequest request,
            java.security.Principal principal) {
        boolean lock = request == null || request.getLock() == null || request.getLock();
        String reasonCode = request != null ? request.getReasonCode() : null;
        String note = request != null ? request.getNote() : null;
        String byUsername = principal != null ? principal.getName() : "unknown";

        Locker locker = lockerService.setLockerMaintenance(lockerId, lock, reasonCode, note, byUsername);
        return ResponseEntity.ok(ApiResponse.ok(
                (lock ? "Đã khoá toàn tủ " : "Đã mở khoá toàn tủ ") + lockerId + ".", locker));
    }

    /** Body của 2 endpoint bảo trì — gói trong controller cho gọn, chỉ dùng ở đây. */
    @lombok.Getter
    @lombok.Setter
    public static class MaintenanceRequest {
        /** true = khoá (mặc định khi bỏ trống), false = mở khoá. */
        private Boolean lock;
        private String reasonCode;
        private String note;
    }
}
