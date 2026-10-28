package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@Slf4j
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Tự động khởi tạo hoặc đồng bộ sửa lỗi phông chữ tiếng Việt cho 3 tài khoản mặc định
     */
    @PostConstruct
    public void initDefaultAccounts() {
        try {
            syncDefaultAccount("admin", "admin123", "Quản Trị Viên Hệ Thống", "0900000001", "ADMIN");
            syncDefaultAccount("shipper", "shipper123", "Nguyễn Văn Shipper PTIT", "0900000002", "SHIPPER");
            syncDefaultAccount("khachhang", "123456", "Đoàn Viết Hoàng", "0988123456", "CUSTOMER");
            log.info("Đã đồng bộ và chuẩn hóa phông chữ tiếng Việt UTF-8 cho 3 tài khoản mặc định.");
        } catch (Exception e) {
            log.warn("Không thể đồng bộ tài khoản mặc định lúc khởi động: {}", e.getMessage());
        }
    }

    private void syncDefaultAccount(String username, String rawPassword, String properFullName, String phone, String role) {
        User user = userRepository.findByUsername(username).orElse(null);
        if (user == null) {
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
        String loginKey = request.getUsername().trim();
        User user = userRepository.findByUsername(loginKey)
                .or(() -> userRepository.findByPhone(loginKey))
                .orElseThrow(() -> new RuntimeException("Tài khoản hoặc số điện thoại không tồn tại!"));

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

        if (!matches) {
            throw new RuntimeException("Mật khẩu không chính xác!");
        }

        return mapToResponse(user);
    }

    /**
     * Đăng ký tài khoản: CHỈ DÀNH RIÊNG CHO KHÁCH HÀNG (CUSTOMER)
     */
    @Transactional
    public AuthDTO.UserResponse registerCustomer(AuthDTO.RegisterRequest request) {
        if (request.getUsername() == null || request.getUsername().isBlank() ||
            request.getPassword() == null || request.getPassword().isBlank() ||
            request.getFullName() == null || request.getFullName().isBlank() ||
            request.getPhone() == null || request.getPhone().isBlank()) {
            throw new RuntimeException("Vui lòng điền đầy đủ tất cả thông tin đăng ký!");
        }

        String cleanPhone = request.getPhone().trim();
        if (!cleanPhone.matches("^(0|84)[3|5|7|8|9][0-9]{8}$")) {
            throw new RuntimeException("Số điện thoại không đúng định dạng Việt Nam (10 chữ số)!");
        }

        if (userRepository.existsByUsername(request.getUsername().trim())) {
            throw new RuntimeException("Tên đăng nhập '" + request.getUsername() + "' đã được sử dụng!");
        }

        if (userRepository.existsByPhone(cleanPhone)) {
            throw new RuntimeException("Số điện thoại '" + request.getPhone() + "' đã được đăng ký!");
        }

        User user = User.builder()
                .username(request.getUsername().trim())
                .password(passwordEncoder.encode(request.getPassword()))
                .fullName(request.getFullName().trim())
                .phone(cleanPhone)
                .role("CUSTOMER") // Bắt buộc là CUSTOMER
                .build();

        user = userRepository.save(user);
        return mapToResponse(user);
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

        if (!"SHIPPER".equalsIgnoreCase(request.getRole()) && !"ADMIN".equalsIgnoreCase(request.getRole())) {
            throw new RuntimeException("Quản trị viên chỉ có thể cấp tài khoản cho vai trò 'SHIPPER' hoặc 'ADMIN'!");
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
                .role(request.getRole().toUpperCase())
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
