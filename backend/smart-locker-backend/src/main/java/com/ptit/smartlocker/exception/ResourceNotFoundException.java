package com.ptit.smartlocker.exception;

/**
 * Không tìm thấy tài nguyên (đơn hàng, tủ, ngăn, người dùng…) — ánh xạ HTTP **404**.
 *
 * <p><b>Message giữ NGUYÊN VĂN</b> câu tiếng Việt cũ, ví dụ
 * "Không tìm thấy đơn hàng tại trạm tủ này!". Client và test đang phụ thuộc câu chữ này.
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }

    public ResourceNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }
}
