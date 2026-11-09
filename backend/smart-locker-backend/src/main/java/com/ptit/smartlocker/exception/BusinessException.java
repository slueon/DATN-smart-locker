package com.ptit.smartlocker.exception;

/**
 * Lỗi nghiệp vụ có thể giải thích cho người dùng — ánh xạ HTTP **400/409** tuỳ advice.
 *
 * <p><b>Vì sao cần lớp này:</b> trước đây mọi lỗi đều là {@code RuntimeException} trần và mọi
 * controller {@code catch (Exception e)} trả {@code 400 badRequest} giống nhau, nên client không
 * phân biệt được "không tìm thấy đơn" với "vi phạm nghiệp vụ" hay "hệ thống lỗi".
 *
 * <p><b>KHÔNG đổi câu chữ:</b> message truyền vào phải giữ NGUYÊN VĂN câu tiếng Việt cũ —
 * frontend (10 chỗ đọc {@code err.response.data.message}) và test (12 chỗ) phụ thuộc câu đó.
 */
public class BusinessException extends RuntimeException {

    public BusinessException(String message) {
        super(message);
    }

    public BusinessException(String message, Throwable cause) {
        super(message, cause);
    }
}
