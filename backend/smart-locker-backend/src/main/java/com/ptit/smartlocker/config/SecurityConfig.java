package com.ptit.smartlocker.config;

import com.ptit.smartlocker.repository.AuthSessionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * W2 — Khung xác thực toàn cục.
 *
 * <p>Nguồn luật phân quyền DUY NHẤT là lớp này (không dùng @PreAuthorize rải rác —
 * xem PLAN-BAOMAT.md mục "Không làm"). Mặc định deny-all, mở từng nhóm endpoint theo
 * ma trận quyền đã chốt.
 *
 * <p>Giữ nguyên bean {@link PasswordEncoder} cũ: 2 test hiện có (testBcryptPasswordHashing
 * và contextLoads) phụ thuộc bean này, và AuthService/Login dùng nó để kiểm mật khẩu.
 */
@Configuration
@EnableWebSecurity
@Slf4j
public class SecurityConfig {

    /**
     * Đường lùi có kiểm soát: mặc định BẬT. Chỉ tắt bằng biến môi trường ở lần chạy cụ thể
     * (SECURITY_ENABLED=false) để chạy lại test cũ/chẩn đoán — xem PLAN-BAOMAT.md "Đường lùi".
     * Không có profile nào, không có endpoint, không có tham số HTTP nào tắt được bảo mật.
     */
    @Value("${app.security.enabled:true}")
    private boolean securityEnabled;

    /** Giữ nguyên bean cũ — không đổi implementation, không đổi tên. */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * Filter xác thực Bearer token.
     *
     * <p>Khai báo bằng @Bean và KHÔNG gắn @Component lên class (bắt buộc theo plan bước 1.4):
     * nếu gắn @Component, Spring Boot tự đăng ký nó thành servlet filter ở container, rồi chain
     * thêm lần nữa → chạy 2 lần mỗi request.
     */
    @Bean
    public TokenAuthFilter tokenAuthFilter(AuthSessionRepository authSessionRepository) {
        return new TokenAuthFilter(authSessionRepository);
    }

    /**
     * Chặn đăng ký tự động của TokenAuthFilter ở servlet container.
     * Filter chỉ được chạy đúng MỘT lần, bởi SecurityFilterChain bên dưới.
     * (Plan cho phép hoặc không @Component, hoặc FilterRegistrationBean.setEnabled(false); ở đây làm cả hai cho chắc.)
     */
    @Bean
    public FilterRegistrationBean<TokenAuthFilter> tokenAuthFilterRegistration(TokenAuthFilter tokenAuthFilter) {
        FilterRegistrationBean<TokenAuthFilter> registration = new FilterRegistrationBean<>(tokenAuthFilter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   TokenAuthFilter tokenAuthFilter,
                                                   RestAuthEntryPoint restAuthEntryPoint,
                                                   RestAccessDeniedHandler restAccessDeniedHandler) throws Exception {

        http
                // API thuần Bearer token, không dùng cookie session → tắt CSRF và không giữ session
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // Không bật formLogin/httpBasic để tránh sinh bean phụ và trang HTML mặc định
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout.disable())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(restAuthEntryPoint)
                        .accessDeniedHandler(restAccessDeniedHandler));

        if (!securityEnabled) {
            log.warn("!!! CẢNH BÁO: app.security.enabled=false — TOÀN BỘ API ĐANG MỞ, "
                    + "CHỈ DÙNG ĐỂ CHẠY TEST/CHẨN ĐOÁN !!!");
            http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
            return http.build();
        }

        http.authorizeHttpRequests(auth -> auth
                // Preflight CORS: cho qua để trình duyệt hỏi được trước khi gửi request thật.
                // CORS vẫn do tầng WebMvc (app.cors.allowed-origins) xử lý — một nguồn duy nhất, không trùng header.
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                // Boot forward lỗi về /error — để mở, nếu không lỗi thật bị che thành 401
                .requestMatchers("/error").permitAll()

                // --- Công khai: phải đăng nhập được mới có token ---
                .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/register").permitAll()

                // --- Chỉ ADMIN ---
                .requestMatchers("/api/auth/admin/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/auth/users").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/mqtt/command", "/api/mqtt/retained-state/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/lockers/*/compartments/*/unlock").hasRole("ADMIN")

                // --- by-phone: TÁCH RIÊNG, phải đứng TRƯỚC "/api/orders/**".
                //     Luật path chỉ chặn mức "đã đăng nhập"; kiểm tra CUSTOMER chỉ xem SĐT của chính mình
                //     nằm ở tầng service/controller (W3, khôi) vì cần đọc principal → CSDL.
                .requestMatchers(HttpMethod.GET, "/api/orders/by-phone").authenticated()

                // --- Đã đăng nhập (mọi vai trò): bản đồ + telemetry dock (IoTDock poll 6s/lần) ---
                .requestMatchers(HttpMethod.GET, "/api/lockers/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/orders/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/mqtt/recent-logs", "/api/mqtt/security-status").authenticated()

                // --- Nghiệp vụ khách hàng ---
                .requestMatchers(HttpMethod.POST, "/api/orders/checkout").hasRole("CUSTOMER")
                .requestMatchers(HttpMethod.POST, "/api/pickup/**").hasRole("CUSTOMER")

                // --- Nghiệp vụ shipper ---
                .requestMatchers(HttpMethod.POST,
                        "/api/shipper/token/generate",
                        "/api/shipper/token/verify",
                        "/api/shipper/deposit",
                        "/api/shipper/recall-overdue").hasRole("SHIPPER")
                .requestMatchers(HttpMethod.GET, "/api/shipper/overdue-orders").hasAnyRole("SHIPPER", "ADMIN")

                // --- Mặc định đóng ---
                .anyRequest().denyAll());

        http.addFilterBefore(tokenAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public RestAuthEntryPoint restAuthEntryPoint() {
        return new RestAuthEntryPoint();
    }

    @Bean
    public RestAccessDeniedHandler restAccessDeniedHandler() {
        return new RestAccessDeniedHandler();
    }
}
