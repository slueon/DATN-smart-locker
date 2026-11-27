package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.AuthSessionRepository;
import com.ptit.smartlocker.repository.NotificationRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review bảo mật #11 — đăng nhập không được để lộ tài khoản nào tồn tại.
 *
 * <p>Trước đây "không có tài khoản" và "sai mật khẩu" là hai câu khác nhau, nên thử tên đăng nhập
 * là biết tên nào có thật. Nay chung một câu, và mật khẩu được kiểm TRƯỚC phiên đang mở.
 */
@ExtendWith(MockitoExtension.class)
class AuthLoginEnumerationTests {

    private static final String MSG = "Tên đăng nhập hoặc mật khẩu không chính xác!";

    @Mock private UserRepository userRepository;
    @Mock private AuthSessionRepository authSessionRepository;
    @Mock private OrderRepository orderRepository;
    @Mock private ShipperIdentityTokenRepository shipperTokenRepository;
    @Mock private NotificationRepository notificationRepository;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);
    private AuthService authService;
    private User user;

    @BeforeEach
    void setUp() {
        authService = new AuthService(userRepository, passwordEncoder, authSessionRepository,
                orderRepository, shipperTokenRepository, notificationRepository);
        user = User.builder().id(9L).username("khach9").password(passwordEncoder.encode("dung-mat-khau"))
                .fullName("Khách 9").phone("0912345609").role("CUSTOMER").build();
        lenient().when(userRepository.findByUsernameForUpdate(anyString())).thenReturn(Optional.empty());
        lenient().when(userRepository.findByPhoneForUpdate(anyString())).thenReturn(Optional.empty());
        lenient().when(userRepository.findByUsernameForUpdate("khach9")).thenReturn(Optional.of(user));
    }

    @Test
    @DisplayName("Tài khoản không tồn tại và sai mật khẩu trả CÙNG một câu")
    void cungMotCauChoHaiTruongHop() {
        RuntimeException khongCo = assertThrows(RuntimeException.class,
                () -> authService.login(new AuthDTO.LoginRequest("khong-ai-ca", "bat-ky")));
        RuntimeException saiMatKhau = assertThrows(RuntimeException.class,
                () -> authService.login(new AuthDTO.LoginRequest("khach9", "sai-mat-khau")));

        assertEquals(MSG, khongCo.getMessage());
        assertEquals(khongCo.getMessage(), saiMatKhau.getMessage());
    }

    @Test
    @DisplayName("Sai mật khẩu khi tài khoản đang có phiên mở → vẫn câu chung, KHÔNG lộ 'đang đăng nhập'")
    void kiemMatKhauTruocPhienDangMo() {
        lenient().when(authSessionRepository.existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                anyLong(), any(LocalDateTime.class))).thenReturn(true);

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.login(new AuthDTO.LoginRequest("khach9", "sai-mat-khau")));

        assertEquals(MSG, ex.getMessage());
        verify(authSessionRepository, never()).existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                anyLong(), any(LocalDateTime.class));
    }

    @Test
    @DisplayName("Đúng mật khẩu nhưng đang có phiên mở → vẫn báo phiên đang mở như cũ")
    void dungMatKhauVanBaoPhienDangMo() {
        when(authSessionRepository.existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                anyLong(), any(LocalDateTime.class))).thenReturn(true);

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.login(new AuthDTO.LoginRequest("khach9", "dung-mat-khau")));

        assertEquals(true, ex.getMessage().contains("đang đăng nhập"), ex.getMessage());
    }
}
