package com.ptit.smartlocker.service;

import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    /**
     * Tự động khởi tạo 3 tài khoản mặc định đại diện cho 3 vai trò nếu CSDL chưa có
     */
    @PostConstruct
    public void initDefaultAccounts() {
        if (userRepository.count() == 0) {
            log.info("Chưa có tài khoản nào trong hệ thống. Đang tạo 3 tài khoản mẫu đại diện cho 3 vai trò...");

            // 1. Quản trị viên
            userRepository.save(User.builder()
                    .username("admin")
                    .password(passwordEncoder.encode("admin123"))
                    .fullName("Quản Trị Viên Hệ Thống")
                    .phone("0900000001")
                    .role("ADMIN")
                    .build());

            // 2. Nhân viên giao hàng (Shipper)
            userRepository.save(User.builder()
                    .username("shipper")
                    .password(passwordEncoder.encode("shipper123"))
                    .fullName("Nguyễn Văn Shipper PTIT")
                    .phone("0900000002")
                    .role("SHIPPER")
                    .build());

            // 3. Khách hàng
            userRepository.save(User.builder()
                    .username("khachhang")
                    .password(passwordEncoder.encode("123456"))
                    .fullName("Đoàn Viết Hoàng")
                    .phone("0988123456")
                    .role("CUSTOMER")
                    .build());

            log.info("Khởi tạo 3 tài khoản mẫu thành công với mật khẩu BCrypt: admin/admin123, shipper/shipper123, khachhang/123456");
        }
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
        if (userRepository.existsByUsername(request.getUsername())) {
            throw new RuntimeException("Tên đăng nhập '" + request.getUsername() + "' đã được sử dụng!");
        }

        if (userRepository.existsByPhone(request.getPhone())) {
            throw new RuntimeException("Số điện thoại '" + request.getPhone() + "' đã được đăng ký!");
        }

        User user = User.builder()
                .username(request.getUsername().trim())
                .password(passwordEncoder.encode(request.getPassword()))
                .fullName(request.getFullName().trim())
                .phone(request.getPhone().trim())
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
        if (!"SHIPPER".equalsIgnoreCase(request.getRole()) && !"ADMIN".equalsIgnoreCase(request.getRole())) {
            throw new RuntimeException("Quản trị viên chỉ có thể cấp tài khoản cho vai trò 'SHIPPER' hoặc 'ADMIN'!");
        }

        if (userRepository.existsByUsername(request.getUsername())) {
            throw new RuntimeException("Tên đăng nhập '" + request.getUsername() + "' đã tồn tại!");
        }

        if (userRepository.existsByPhone(request.getPhone())) {
            throw new RuntimeException("Số điện thoại '" + request.getPhone() + "' đã tồn tại!");
        }

        User user = User.builder()
                .username(request.getUsername().trim())
                .password(passwordEncoder.encode(request.getPassword()))
                .fullName(request.getFullName().trim())
                .phone(request.getPhone().trim())
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
                .fullName(user.getFullName())
                .phone(user.getPhone())
                .role(user.getRole())
                .createdAt(user.getCreatedAt())
                .build();
    }
}
