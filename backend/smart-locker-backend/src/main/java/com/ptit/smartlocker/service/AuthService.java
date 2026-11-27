package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.entity.AuthSession;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.AuthSessionRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@Slf4j
public class AuthService {

    /** Nguồn ngẫu nhiên an toàn cho token phiên đăng nhập. */
    private static final SecureRandom SESSION_RANDOM = new SecureRandom();

    /** Số byte ngẫu nhiên của một session token (32 byte = 256 bit → 43 ký tự Base64URL). */
    private static final int SESSION_TOKEN_BYTES = 32;

    /** Thời gian sống của một phiên đăng nhập. */
    private static final int SESSION_TTL_HOURS = 8;
    private static final Set<String> PROTECTED_ACCOUNT_USERNAMES = Set.of("admin");
    private static final Set<String> VALID_ROLES = Set.of("CUSTOMER", "SHIPPER", "ADMIN");
    /**
     * Trạng thái đơn mà shipper được phân công còn trách nhiệm. Gồm cả OVERDUE: gỡ shipper khỏi đơn
     * quá hạn sẽ làm lệnh thu hồi mồ côi (chỉ admin còn thấy) — review gộp ThanhChung #4.
     */
    static final List<String> SHIPPER_ACTIVE_STATUSES = List.of("PENDING", "PENDING_OPENED", "OVERDUE");

    /** Review bảo mật #11 — một câu chung cho "không có tài khoản" và "sai mật khẩu". */
    static final String INVALID_CREDENTIALS_MESSAGE = "Tên đăng nhập hoặc mật khẩu không chính xác!";

    /** Hash BCrypt giả, tạo một lần, để nhánh "không có tài khoản" tốn thời gian như nhánh sai mật khẩu. */
    private volatile String dummyPasswordHash;

    private String dummyPasswordHash() {
        String hash = dummyPasswordHash;
        if (hash == null) {
            hash = passwordEncoder.encode("smart-locker-dummy-password");
            dummyPasswordHash = hash;
        }
        return hash;
    }

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthSessionRepository authSessionRepository;
    private final OrderRepository orderRepository;
    private final com.ptit.smartlocker.repository.ShipperIdentityTokenRepository shipperTokenRepository;
    private final com.ptit.smartlocker.repository.NotificationRepository notificationRepository;

    public AuthService(UserRepository userRepository,
                       PasswordEncoder passwordEncoder,
                       AuthSessionRepository authSessionRepository,
                       OrderRepository orderRepository,
                       com.ptit.smartlocker.repository.ShipperIdentityTokenRepository shipperTokenRepository,
                       com.ptit.smartlocker.repository.NotificationRepository notificationRepository) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.authSessionRepository = authSessionRepository;
        this.orderRepository = orderRepository;
        this.shipperTokenRepository = shipperTokenRepository;
        this.notificationRepository = notificationRepository;
    }

    /**
     * Sinh token phiên mới (opaque, ngẫu nhiên — KHÔNG suy ra từ username/hay dữ liệu nào).
     */
    private AuthSession issueSession(User user) {
        byte[] randomBytes = new byte[SESSION_TOKEN_BYTES];
        SESSION_RANDOM.nextBytes(randomBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);

        AuthSession session = AuthSession.builder()
                .token(token)
                .user(user)
                .role(user.getRole())
                .expiresAt(LocalDateTime.now().plusHours(SESSION_TTL_HOURS))
                .revoked(false)
                .build();
        return authSessionRepository.save(session);
    }

    /** Khởi tạo tài khoản mẫu trên database mới; không tự tạo lại tài khoản đã bị admin xóa. */
    @PostConstruct
    public void initDefaultAccounts() {
        try {
            boolean createMissingAccounts = userRepository.count() == 0;
            syncDefaultAccount("admin", "admin123", "Quản Trị Viên Hệ Thống", "0900000001", "ADMIN", createMissingAccounts);
            syncDefaultAccount("shipper", "shipper123", "Nguyễn Văn Shipper PTIT", "0900000002", "SHIPPER", createMissingAccounts);
            syncDefaultAccount("khachhang", "123456", "Đoàn Viết Hoàng", "0988123456", "CUSTOMER", createMissingAccounts);
            log.info("Đã kiểm tra tài khoản mặc định; chỉ tạo tài khoản thiếu khi database chưa có người dùng.");
        } catch (Exception e) {
            log.warn("Không thể đồng bộ tài khoản mặc định lúc khởi động: {}", e.getMessage());
        }
    }

    private void syncDefaultAccount(String username, String rawPassword, String properFullName,
                                    String phone, String role, boolean createIfMissing) {
        User user = userRepository.findByUsername(username).orElse(null);
        if (user == null) {
            if (!createIfMissing) {
                return;
            }
            userRepository.save(User.builder()
                    .username(username)
                    .password(passwordEncoder.encode(rawPassword))
                    .fullName(properFullName)
                    .phone(phone)
                    .role(role)
                    .build());
        } else {
            // Sửa lại tên đầy đủ nếu bị lỗi phông chữ / mojibake
            if (user.getFullName() == null || isCorruptedText(user.getFullName())) {
                user.setFullName(properFullName);
                userRepository.save(user);
            }
        }
    }

    /**
     * Nhận diện chuỗi tiếng Việt bị lỗi phông chữ (Mojibake)
     */
    private static boolean isCorruptedText(String text) {
        if (text == null) return false;
        return text.contains("|") || text.contains("¬") || text.contains("¡") || 
               text.contains("—") || text.contains("¿") || text.contains("") ||
               text.contains("HB") || text.contains("ViB");
    }

    public static String sanitizeFullName(String username, String rawName) {
        if ("admin".equalsIgnoreCase(username)) return "Quản Trị Viên Hệ Thống";
        if ("shipper".equalsIgnoreCase(username)) return "Nguyễn Văn Shipper PTIT";
        if ("khachhang".equalsIgnoreCase(username)) return "Đoàn Viết Hoàng";
        if (rawName == null || isCorruptedText(rawName)) {
            if ("admin".equalsIgnoreCase(username)) return "Quản Trị Viên Hệ Thống";
            if ("shipper".equalsIgnoreCase(username)) return "Nguyễn Văn Shipper PTIT";
            if ("khachhang".equalsIgnoreCase(username)) return "Đoàn Viết Hoàng";
        }
        return rawName;
    }

    /**
     * Đăng nhập dùng chung cho cả 3 vai trò (CUSTOMER, SHIPPER, ADMIN)
     * Cho phép đăng nhập bằng tên đăng nhập (username) hoặc số điện thoại (phone).
     * Hỗ trợ BCrypt và cơ chế tự động băm lại mật khẩu cũ (transparent migration).
     */
    @Transactional
    public AuthDTO.UserResponse login(AuthDTO.LoginRequest request) {
        return authenticateAndIssueSession(request, false);
    }

    @Transactional
    public AuthDTO.UserResponse replaceActiveSession(AuthDTO.LoginRequest request) {
        return authenticateAndIssueSession(request, true);
    }

    private AuthDTO.UserResponse authenticateAndIssueSession(
            AuthDTO.LoginRequest request, boolean replaceActiveSession) {
        // GĐ75 (#13) — thiếu username/password thì báo lỗi nghiệp vụ, không để NullPointerException
        // rò rỉ tên lớp nội bộ ra client. Áp dụng cho cả login thường lẫn replace-session.
        if (request == null || request.getUsername() == null || request.getUsername().isBlank()
                || request.getPassword() == null || request.getPassword().isBlank()) {
            throw new IllegalArgumentException("Vui lòng nhập tên đăng nhập và mật khẩu!");
        }
        String loginKey = request.getUsername().trim();
        User user = userRepository.findByUsernameForUpdate(loginKey)
                .or(() -> userRepository.findByPhoneForUpdate(loginKey))
                .orElse(null);
        if (user == null) {
            // Review bảo mật #11 — cùng một câu với "sai mật khẩu" để không dò được tài khoản nào
            // tồn tại. Vẫn chạy một lần BCrypt giả để thời gian phản hồi không lộ điều đó.
            passwordEncoder.matches(request.getPassword(), dummyPasswordHash());
            throw new RuntimeException(INVALID_CREDENTIALS_MESSAGE);
        }

        String rawPassword = request.getPassword();
        String storedPassword = user.getPassword();

        boolean matches = false;
        // Kiểm tra nếu mật khẩu trong DB đã được băm chuẩn BCrypt ($2a$, $2b$, $2y$)
        if (storedPassword != null && (storedPassword.startsWith("$2a$") || storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2y$"))) {
            matches = passwordEncoder.matches(rawPassword, storedPassword);
        } else {
            // Hỗ trợ kiểm tra mật khẩu plaintext cũ, tự động băm lại và lưu vào DB
            if (rawPassword != null && rawPassword.equals(storedPassword)) {
                matches = true;
                user.setPassword(passwordEncoder.encode(rawPassword));
                userRepository.save(user);
                log.info("Tự động nâng cấp mật khẩu sang BCrypt cho tài khoản: {}", user.getUsername());
            }
        }

        // Kiểm mật khẩu TRƯỚC khi kiểm phiên đang mở: người không biết mật khẩu không được biết
        // tài khoản đang đăng nhập ở nơi khác.
        if (!matches) {
            throw new RuntimeException(INVALID_CREDENTIALS_MESSAGE);
        }

        boolean hasActiveSession = authSessionRepository.existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                user.getId(), LocalDateTime.now());
        if (hasActiveSession && !replaceActiveSession) {
            throw new RuntimeException(
                    "Tài khoản này đang đăng nhập trên một phiên khác. Vui lòng đăng xuất phiên hiện tại trước khi đăng nhập lại.");
        }

        authSessionRepository.deleteAllByUserId(user.getId());

        // W2/W3: cấp token phiên — đây là thứ duy nhất cho phép gọi API sau khi bật xác thực.
        AuthSession session = issueSession(user);

        AuthDTO.UserResponse response = mapToResponse(user);
        response.setToken(session.getToken());
        return response;
    }

    @Transactional
    public int logout(String username) {
        User user = userRepository.findByUsernameForUpdate(username)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tài khoản đăng xuất."));
        int deletedSessions = authSessionRepository.deleteAllByUserId(user.getId());
        log.info("Logout revoked {} auth session(s).", deletedSessions);
        return deletedSessions;
    }

    /**
     * Cấp tài khoản mới: DO QUẢN TRỊ VIÊN (ADMIN) THỰC HIỆN
     * Dùng để cấp tài khoản cho SHIPPER hoặc ADMIN phụ
     */
    @Transactional
    public AuthDTO.UserResponse createAccountByAdmin(AuthDTO.CreateAccountByAdminRequest request) {
        if (request.getUsername() == null || request.getUsername().isBlank() ||
            request.getPassword() == null || request.getPassword().isBlank() ||
            request.getFullName() == null || request.getFullName().isBlank() ||
            request.getPhone() == null || request.getPhone().isBlank() ||
            request.getRole() == null || request.getRole().isBlank()) {
            throw new RuntimeException("Vui lòng điền đầy đủ tất cả thông tin tài khoản!");
        }

        String cleanPhone = request.getPhone().trim();
        if (!cleanPhone.matches("^(0|84)[3|5|7|8|9][0-9]{8}$")) {
            throw new RuntimeException("Số điện thoại không đúng định dạng Việt Nam (10 chữ số)!");
        }

        String role = request.getRole().trim().toUpperCase();
        if (!List.of("CUSTOMER", "SHIPPER", "ADMIN").contains(role)) {
            throw new RuntimeException("Vai trò tài khoản không hợp lệ. Chọn CUSTOMER, SHIPPER hoặc ADMIN.");
        }

        if (userRepository.existsByUsername(request.getUsername().trim())) {
            throw new RuntimeException("Tên đăng nhập '" + request.getUsername() + "' đã tồn tại!");
        }

        if (userRepository.existsByPhone(cleanPhone)) {
            throw new RuntimeException("Số điện thoại '" + request.getPhone() + "' đã tồn tại!");
        }

        User user = User.builder()
                .username(request.getUsername().trim())
                .password(passwordEncoder.encode(request.getPassword()))
                .fullName(request.getFullName().trim())
                .phone(cleanPhone)
                .role(role)
                .build();

        user = userRepository.save(user);
        return mapToResponse(user);
    }

    public List<AuthDTO.UserResponse> getAllUsers() {
        return userRepository.findAll().stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    public List<AuthDTO.UserResponse> getUsersByRole(String role) {
        return userRepository.findByRole(role.toUpperCase()).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public AuthDTO.UserResponse updateUserRole(Long userId, String requestedRole, String actorUsername) {
        if (requestedRole == null || requestedRole.isBlank()) {
            throw new RuntimeException("Vai trò không được để trống.");
        }
        String role = requestedRole.trim().toUpperCase();
        if (!VALID_ROLES.contains(role)) {
            throw new RuntimeException("Vai trò không hợp lệ. Chọn CUSTOMER, SHIPPER hoặc ADMIN.");
        }

        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tài khoản."));
        if (sameUsername(user.getUsername(), actorUsername) && !role.equals(user.getRole())) {
            throw new RuntimeException("Không thể tự thay đổi vai trò tài khoản đang đăng nhập.");
        }
        // Admin không được đổi vai trò của một quản trị viên KHÁC (chỉ được nâng người khác lên ADMIN).
        if ("ADMIN".equals(user.getRole()) && !role.equals(user.getRole())
                && !sameUsername(user.getUsername(), actorUsername)) {
            throw new RuntimeException("Không thể thay đổi vai trò của quản trị viên khác.");
        }
        if ("ADMIN".equals(user.getRole()) && !"ADMIN".equals(role)
                && PROTECTED_ACCOUNT_USERNAMES.contains(user.getUsername().toLowerCase())) {
            throw new RuntimeException("Không thể hạ vai trò tài khoản quản trị mặc định.");
        }
        if ("ADMIN".equals(user.getRole()) && !"ADMIN".equals(role) && isLastAdmin()) {
            throw new RuntimeException("Không thể hạ vai trò của quản trị viên cuối cùng.");
        }
        if ("SHIPPER".equals(user.getRole()) && !"SHIPPER".equals(role)
                && orderRepository.countByAssignedShipper_IdAndStatusIn(
                        userId, SHIPPER_ACTIVE_STATUSES) > 0) {
            throw new RuntimeException("Không thể đổi vai trò: shipper vẫn còn đơn hàng đang chờ giao.");
        }

        if (!role.equals(user.getRole())) {
            authSessionRepository.deleteByUser_Id(userId);
            user.setRole(role);
            user = userRepository.save(user);
        }
        return mapToResponse(user);
    }

    @Transactional
    public void deleteUser(Long userId, String actorUsername) {
        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() -> new RuntimeException("Không tìm thấy tài khoản."));
        if (sameUsername(user.getUsername(), actorUsername)) {
            throw new RuntimeException("Không thể xóa tài khoản đang đăng nhập.");
        }
        // Cùng quy tắc với đổi vai trò: admin không được xoá tài khoản của quản trị viên khác.
        if ("ADMIN".equals(user.getRole())) {
            throw new RuntimeException("Không thể xóa tài khoản của quản trị viên khác.");
        }
        if (PROTECTED_ACCOUNT_USERNAMES.contains(user.getUsername().toLowerCase())) {
            throw new RuntimeException("Không thể xóa tài khoản quản trị mặc định.");
        }
        if ("ADMIN".equals(user.getRole()) && isLastAdmin()) {
            throw new RuntimeException("Không thể xóa quản trị viên cuối cùng.");
        }
        if (orderRepository.countByCustomerPhone(user.getPhone()) > 0) {
            throw new RuntimeException("Không thể xóa tài khoản vì số điện thoại vẫn còn đơn hàng.");
        }
        if ("SHIPPER".equals(user.getRole())
                && orderRepository.countByAssignedShipper_IdAndStatusIn(
                        userId, SHIPPER_ACTIVE_STATUSES) > 0) {
            throw new RuntimeException("Không thể xóa shipper vì vẫn còn đơn hàng đang chờ giao.");
        }

        authSessionRepository.deleteByUser_Id(userId);
        orderRepository.clearAssignedShipper(userId);
        // Review gộp ThanhChung #5 — token QR khoá theo username, thông báo khoá theo SĐT: không dọn
        // thì tài khoản mới trùng username/SĐT sẽ thừa hưởng token/thông báo của người cũ.
        if (shipperTokenRepository != null) shipperTokenRepository.deleteByShipperId(user.getUsername());
        if (notificationRepository != null && user.getPhone() != null) {
            notificationRepository.deleteByRecipientPhone(user.getPhone());
        }
        userRepository.delete(user);
    }

    /** Khoá mọi dòng ADMIN rồi mới đếm, để 2 giao dịch hạ/xoá admin song song không cùng lọt qua. */
    private boolean isLastAdmin() {
        return userRepository.findByRoleForUpdate("ADMIN").size() <= 1;
    }

    private boolean sameUsername(String username, String otherUsername) {
        return username != null && otherUsername != null && username.equalsIgnoreCase(otherUsername);
    }

    private AuthDTO.UserResponse mapToResponse(User user) {
        return AuthDTO.UserResponse.builder()
                .id(user.getId())
                .username(user.getUsername())
                .fullName(sanitizeFullName(user.getUsername(), user.getFullName()))
                .phone(user.getPhone())
                .role(user.getRole())
                .createdAt(user.getCreatedAt())
                .build();
    }
}
