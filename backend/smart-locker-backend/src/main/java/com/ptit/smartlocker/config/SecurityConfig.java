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

    /**
     * Bật/tắt tài liệu Swagger. Mặc định TẮT.
     *
     * <p>Vì sao cần cờ này: Swagger UI là trang HTML tĩnh mở bằng TRÌNH DUYỆT. Trình duyệt
     * KHÔNG gửi header {@code Authorization: Bearer ...} khi ta gõ URL, token của dự án nằm
     * trong localStorage chứ không phải cookie — nên nếu bắt {@code authenticated()} thì
     * trang luôn 401 và Swagger thành vô dụng. Đặt {@code permitAll} vô điều kiện thì lại
     * phơi toàn bộ danh sách endpoint ra ngoài.
     *
     * <p>Cách chọn: chỉ mở ở profile dev/local ({@code application-local.properties} đặt
     * {@code app.swagger.enabled=true}); bản chạy thường để mặc định false → nhánh
     * {@code anyRequest().denyAll()} đóng luôn, không lộ tài liệu.
     */
    @Value("${app.swagger.enabled:false}")
    private boolean swaggerEnabled;

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

                // --- Swagger / OpenAPI ---
                // Mặc định TẮT (app.swagger.enabled=false) → CHẶN HẲN, kể cả khi có token.
                // Chỉ profile dev/local mới bật cờ để mở bằng trình duyệt.
                //
                // Lưu ý đã kiểm thật: KHÔNG dùng `authentication.get().isAuthenticated()` làm
                // điều kiện — request chưa đăng nhập vẫn có `AnonymousAuthenticationToken` với
                // isAuthenticated() == true, nên điều kiện đó luôn đúng và Swagger vẫn mở (đã
                // chứng minh bằng Invoke-WebRequest: profile mặc định vẫn trả 200).
                .requestMatchers("/swagger-ui.html", "/swagger-ui/**",
                        "/v3/api-docs", "/v3/api-docs/**",
                        "/swagger-resources/**", "/webjars/**")
                        .access((authentication, context) ->
                                new org.springframework.security.authorization.AuthorizationDecision(swaggerEnabled))

                // --- Chỉ ADMIN ---
                .requestMatchers("/api/auth/admin/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.GET, "/api/auth/users").hasRole("ADMIN")
                // GĐ7 — danh sách đơn cho dashboard quản trị. CHỈ ADMIN: endpoint trả đơn của
                // MỌI khách, nếu mở cho vai trò khác là rò rỉ toàn bộ đơn hàng của hệ thống.
                //
                // GĐ13 — bỏ giới hạn GET: `POST /api/admin/scan-overdue` cũng thuộc nhóm quản trị
                // này. Nếu để `HttpMethod.GET` thì POST rơi xuống `.anyRequest().denyAll()` và
                // luôn 403 kể cả với ADMIN — đúng loại lỗi im lặng đã làm AdminTab phải dùng
                // localStorage suốt GĐ5–GĐ12. Khoá theo PREFIX là đủ vì cả cây `/api/admin/**`
                // chỉ dành cho quản trị viên.
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                // GĐ7 — lịch sử mở tủ: ADMIN xem toàn hệ thống, SHIPPER xem lệnh của mình.
                // Phải đặt TRƯỚC luật "/api/mqtt/recent-logs, security-status" bên dưới để không
                // bị luật chung `.authenticated()` nuốt mất (matcher khớp theo thứ tự khai báo).
                .requestMatchers(HttpMethod.GET, "/api/mqtt/command-logs").hasAnyRole("ADMIN", "SHIPPER")
                .requestMatchers(HttpMethod.POST, "/api/mqtt/command", "/api/mqtt/retained-state/**").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/lockers/*/compartments/*/unlock").hasRole("ADMIN")
                // GĐ10 — bảo trì tủ/ngăn. BẮT BUỘC đặt ở đây, TRƯỚC luật
                // `.requestMatchers(HttpMethod.GET, "/api/lockers/**").authenticated()` bên dưới:
                // matcher khớp theo thứ tự khai báo, đặt sau thì CUSTOMER gọi được endpoint
                // khoá tủ (chỉ cần đăng nhập là đủ) — đúng loại lỗi phân quyền im lặng.
                .requestMatchers(HttpMethod.POST,
                        "/api/lockers/*/compartments/*/maintenance").hasRole("ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/lockers/*/maintenance").hasRole("ADMIN")

                // --- by-phone: TÁCH RIÊNG, phải đứng TRƯỚC "/api/orders/**".
                //     Luật path chỉ chặn mức "đã đăng nhập"; kiểm tra CUSTOMER chỉ xem SĐT của chính mình
                //     nằm ở tầng service/controller (W3, khôi) vì cần đọc principal → CSDL.
                .requestMatchers(HttpMethod.GET, "/api/orders/by-phone").authenticated()

                // --- Đã đăng nhập (mọi vai trò): bản đồ + telemetry dock (IoTDock poll 6s/lần) ---
                .requestMatchers(HttpMethod.GET, "/api/lockers/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/orders/**").authenticated()
                .requestMatchers(HttpMethod.GET, "/api/mqtt/recent-logs", "/api/mqtt/security-status").authenticated()

                // --- Nghiệp vụ khách hàng & tạo đơn ---
                // GĐ11 — khách KHÔNG còn checkout: mô hình mới là khách chỉ NHẬN hàng, shipper
                // chọn tủ rồi nạp hàng. Mở lại cho CUSTOMER là quay về mô hình thương mại điện tử.
                .requestMatchers(HttpMethod.POST, "/api/orders/checkout").hasAnyRole("SHIPPER", "ADMIN")
                .requestMatchers(HttpMethod.POST, "/api/pickup/**").hasRole("CUSTOMER")

                // --- Nghiệp vụ shipper ---
                .requestMatchers(HttpMethod.POST,
                        "/api/shipper/token/generate",
                        "/api/shipper/token/verify",
                        "/api/shipper/deposit").hasRole("SHIPPER")
                // GĐ13 — thu hồi hàng quá hạn mở thêm cho ADMIN.
                //
                // Trước đây chỉ `hasRole("SHIPPER")` nên AdminTab gọi bị 403 và code cũ "chữa
                // cháy" bằng cách ghi localStorage: web báo "đã thu hồi" trong khi kiện hàng vẫn
                // nằm trong tủ và DB vẫn OVERDUE. Thu hồi là cùng một nghiệp vụ, ai trực ca cũng
                // phải làm được; quyền được kiểm ở đây chứ không phải bằng cách bỏ qua backend.
                .requestMatchers(HttpMethod.POST, "/api/shipper/recall-overdue")
                        .hasAnyRole("SHIPPER", "ADMIN")
                // T3: đặt trước ngăn. Thiếu 3 dòng này là 403 vì anyRequest().denyAll() ở dưới.
                .requestMatchers(HttpMethod.GET, "/api/shipper/orders/pending").hasRole("SHIPPER")
                .requestMatchers(HttpMethod.POST, "/api/shipper/orders/*/reserve").hasRole("SHIPPER")
                .requestMatchers(HttpMethod.DELETE, "/api/shipper/orders/*/reserve").hasRole("SHIPPER")
                // GĐ11 — shipper tự chọn tủ. CHỈ SHIPPER: ADMIN đã có công cụ bảo trì riêng, còn
                // mở cho CUSTOMER thì khách tự chốt tủ hộ shipper (trái mô hình mới).
                .requestMatchers(HttpMethod.GET, "/api/shipper/suggest-lockers").hasRole("SHIPPER")
                .requestMatchers(HttpMethod.POST, "/api/shipper/orders/*/assign-locker").hasRole("SHIPPER")
                .requestMatchers(HttpMethod.GET, "/api/shipper/overdue-orders").hasAnyRole("SHIPPER", "ADMIN")
                // Sự kiện Kiosk của tủ thật (nguồn popup ở tab shipper). ADMIN đọc được vì cùng
                // màn hình được dùng khi trực ca; thiếu dòng này là 403 vì denyAll() ở dưới.
                .requestMatchers(HttpMethod.GET, "/api/shipper/kiosk-events")
                        .hasAnyRole("SHIPPER", "ADMIN")

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
