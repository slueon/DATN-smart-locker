package com.ptit.smartlocker.config;

import com.ptit.smartlocker.entity.AuthSession;
import com.ptit.smartlocker.repository.AuthSessionRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * W2 — Đọc "Authorization: Bearer &lt;token&gt;", tra bảng auth_sessions,
 * nạp ROLE_&lt;role&gt; vào SecurityContext.
 *
 * BẮT BUỘC về cách đăng ký (PLAN-BAOMAT.md bước 1.4): class này KHÔNG có
 * {@code @Component}. Nó được khai báo bằng {@code @Bean} trong SecurityConfig,
 * kèm {@code FilterRegistrationBean.setEnabled(false)} để Spring Boot không tự
 * đăng ký nó thành servlet filter ở container — nếu không nó sẽ chạy 2 lần mỗi request.
 *
 * Token sai / hết hạn / bị thu hồi: KHÔNG set context, KHÔNG ném exception —
 * để AuthenticationEntryPoint trả 401 JSON thống nhất.
 */
@Slf4j
public class TokenAuthFilter extends OncePerRequestFilter {

    private static final String AUTH_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String ROLE_PREFIX = "ROLE_";

    private final AuthSessionRepository authSessionRepository;

    public TokenAuthFilter(AuthSessionRepository authSessionRepository) {
        this.authSessionRepository = authSessionRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        // Chỉ xử lý khi request chưa có xác thực nào (không ghi đè context của filter khác)
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            String token = extractBearerToken(request);
            if (token != null) {
                authenticate(token);
            }
        }

        filterChain.doFilter(request, response);
    }

    private String extractBearerToken(HttpServletRequest request) {
        String header = request.getHeader(AUTH_HEADER);
        if (header == null || header.isBlank()) {
            return null;
        }
        String value = header.trim();
        if (!value.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return null;
        }
        String token = value.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    private void authenticate(String token) {
        try {
            Optional<AuthSession> found =
                    authSessionRepository.findActiveByToken(token, LocalDateTime.now());
            if (found.isEmpty()) {
                // Token rác / hết hạn / đã thu hồi: im lặng, để entry point quyết định 401.
                return;
            }

            AuthSession session = found.get();
            String username = session.getUser() != null ? session.getUser().getUsername() : null;
            String role = session.getRole();
            if (username == null || role == null || role.isBlank()) {
                return;
            }

            List<SimpleGrantedAuthority> authorities =
                    List.of(new SimpleGrantedAuthority(ROLE_PREFIX + role.toUpperCase()));

            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(username, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);

        } catch (Exception e) {
            // Lỗi CSDL không được làm vỡ request: coi như chưa xác thực.
            log.warn("Không tra được phiên xác thực cho token Bearer: {}", e.getMessage());
            SecurityContextHolder.clearContext();
        }
    }
}
