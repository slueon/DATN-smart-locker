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
}
