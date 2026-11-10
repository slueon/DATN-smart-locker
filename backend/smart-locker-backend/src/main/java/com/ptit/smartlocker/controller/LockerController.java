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
     * Mở khóa khẩn cấp và giải phóng ngăn tủ về EMPTY từ Admin từ xa
     */
    @PostMapping("/{lockerId}/compartments/{compIndex}/unlock")
    public ResponseEntity<ApiResponse<Compartment>> forceUnlockCompartment(
            @PathVariable String lockerId,
            @PathVariable Integer compIndex) {
        Compartment comp = lockerService.forceUnlockCompartment(lockerId, compIndex);
        return ResponseEntity.ok(ApiResponse.ok("Mở khóa khẩn cấp và giải phóng ngăn thành công!", comp));
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
