package com.ptit.smartlocker.config;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.exception.BusinessException;
import com.ptit.smartlocker.exception.ResourceNotFoundException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Ánh xạ ngoại lệ → HTTP status, dùng CHUNG một shape {@link ApiResponse}.
 *
 * <h2>Vấn đề trước đây</h2>
 * Không có {@code @ControllerAdvice} nào, và 41 chỗ {@code throw new RuntimeException} rải ở
 * 4 service. Mỗi controller lại tự {@code catch (Exception e)} rồi trả {@code badRequest}, nên
 * <b>mọi</b> lỗi đều ra 400 giống nhau: client không phân biệt được "không tìm thấy đơn" với
 * "vi phạm nghiệp vụ" hay "hệ thống lỗi".
 *
 * <h2>Ràng buộc KHÔNG được phá (đã đếm trước khi làm)</h2>
 * <ul>
 *   <li><b>Shape {@code ApiResponse} giữ nguyên</b> ({@code success}, {@code message}, {@code data}) —
 *       10 chỗ frontend đọc {@code err.response.data.message}.</li>
 *   <li><b>Câu message tiếng Việt giữ NGUYÊN VĂN</b> — 12 chỗ trong test phụ thuộc câu chữ.
 *       Advice này chỉ đổi HTTP status, tuyệt đối không viết lại message.</li>
 * </ul>
 *
 * <h2>Bảng ánh xạ</h2>
 * <table border="1">
 *   <tr><th>Ngoại lệ</th><th>HTTP</th></tr>
 *   <tr><td>{@link ResourceNotFoundException}</td><td>404</td></tr>
 *   <tr><td>{@link BusinessException}</td><td>409 Conflict (vi phạm nghiệp vụ vì trạng thái hiện tại)</td></tr>
 *   <tr><td>{@link IllegalArgumentException}</td><td>400</td></tr>
 *   <tr><td>{@code RuntimeException} trần (41 chỗ chưa gắn nhãn)</td><td>400 — <b>giữ đúng hành vi cũ</b></td></tr>
 *   <tr><td>Mọi {@code Exception} khác</td><td>500</td></tr>
 * </table>
 */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    /** Không tìm thấy đơn/tủ/ngăn/người dùng. */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleNotFound(ResourceNotFoundException ex) {
        log.warn("[API 404] {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ApiResponse.error(ex.getMessage()));
    }

    /**
     * Vi phạm nghiệp vụ: hết chỗ, sai trạng thái, đã đặt trước, mã đã khoá…
     *
     * <p>409 Conflict vì các lỗi này xảy ra khi trạng thái hiện tại của tài nguyên không cho phép
     * thao tác — khác hẳn 400 "request sai cú pháp".
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
        log.warn("[API 409] {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.error(ex.getMessage()));
    }

    /** Tham số/đối số sai. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgument(IllegalArgumentException ex) {
        log.warn("[API 400] {}", ex.getMessage());
        return ResponseEntity.badRequest().body(ApiResponse.error(ex.getMessage()));
    }

    /**
     * {@code RuntimeException} trần — 41 chỗ chưa được gắn nhãn cụ thể.
     *
     * <p>Cố tình giữ <b>400</b> giống hành vi cũ để không phá client đang chạy: mọi thứ
     * {@code catch (Exception e) → badRequest} trước đây vẫn cho ra đúng mã đó.
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<ApiResponse<Void>> handleRuntime(RuntimeException ex) {
        log.warn("[API 400] RuntimeException: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(ApiResponse.error(ex.getMessage()));
    }

    /** Lỗi không lường trước — 500, và ghi log kèm stack để còn điều tra. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
        log.error("[API 500] Lỗi không xử lý được: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("Hệ thống gặp lỗi không mong muốn. Vui lòng thử lại sau!"));
    }
}
