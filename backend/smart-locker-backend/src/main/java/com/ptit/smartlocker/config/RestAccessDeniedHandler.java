package com.ptit.smartlocker.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * W2 — 403 trả JSON đúng hình ApiResponse, không trả trang HTML mặc định của Spring Security.
 * Hình: {"success":false,"message":"...","data":null}
 */
public class RestAccessDeniedHandler implements AccessDeniedHandler {

    private static final String MESSAGE = "Không có quyền thực hiện thao tác này!";

    @Override
    public void handle(HttpServletRequest request,
                       HttpServletResponse response,
                       AccessDeniedException accessDeniedException) throws IOException {

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(body(MESSAGE));
    }

    /** Dựng body đúng hình ApiResponse.error(message). Message là hằng nội bộ nên chỉ cần escape tối thiểu. */
    static String body(String message) {
        return "{\"success\":false,\"message\":\"" + escape(message) + "\",\"data\":null}";
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
