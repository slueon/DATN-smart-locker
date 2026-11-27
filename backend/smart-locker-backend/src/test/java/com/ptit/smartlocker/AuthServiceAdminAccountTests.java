package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.AuthDTO;
import com.ptit.smartlocker.entity.AuthSession;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.AuthSessionRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.Optional;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AuthServiceAdminAccountTests {

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private AuthSessionRepository authSessionRepository;

    @Mock
    private OrderRepository orderRepository;

    @Mock
    private com.ptit.smartlocker.repository.ShipperIdentityTokenRepository shipperTokenRepository;

    @Mock
    private com.ptit.smartlocker.repository.NotificationRepository notificationRepository;

    private AuthService authService;

    @BeforeEach
    void setUp() {
        authService = new AuthService(userRepository, passwordEncoder, authSessionRepository, orderRepository,
                shipperTokenRepository, notificationRepository);
    }

    @Test
    void adminCanCreateCustomerAccountAndPersistIt() {
        when(userRepository.existsByUsername("newcustomer")).thenReturn(false);
        when(userRepository.existsByPhone("0912345678")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("encoded-password");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> invocation.getArgument(0));

        AuthDTO.CreateAccountByAdminRequest request = new AuthDTO.CreateAccountByAdminRequest(
                "newcustomer", "password123", "New Customer", "0912345678", "customer");

        AuthDTO.UserResponse response = authService.createAccountByAdmin(request);

        ArgumentCaptor<User> userCaptor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(userCaptor.capture());
        assertEquals("CUSTOMER", userCaptor.getValue().getRole());
        assertEquals("encoded-password", userCaptor.getValue().getPassword());
        assertEquals("CUSTOMER", response.getRole());
    }

    @Test
    void loginRejectsAccountWithAnActiveSession() {
        User user = User.builder()
                .id(7L)
                .username("customer7")
                .password("$2a$encoded-password")
                .fullName("Customer Seven")
                .phone("0912345687")
                .role("CUSTOMER")
                .build();
        when(userRepository.findByUsernameForUpdate("customer7")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "$2a$encoded-password")).thenReturn(true);
        when(authSessionRepository.existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                eq(7L), any(LocalDateTime.class))).thenReturn(true);

        RuntimeException error = assertThrows(RuntimeException.class,
                () -> authService.login(new AuthDTO.LoginRequest("customer7", "password123")));

        assertTrue(error.getMessage().contains("đang đăng nhập"));
        verify(authSessionRepository, never()).save(any());
    }

    @Test
    void explicitSessionReplacementDeletesOldSessionAndIssuesNewToken() {
        User user = User.builder()
                .id(10L)
                .username("customer10")
                .password("$2a$encoded-password")
                .fullName("Customer Ten")
                .phone("0912345690")
                .role("CUSTOMER")
                .build();
        when(userRepository.findByUsernameForUpdate("customer10")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "$2a$encoded-password")).thenReturn(true);
        when(authSessionRepository.existsByUser_IdAndRevokedFalseAndExpiresAtAfter(
                eq(10L), any(LocalDateTime.class))).thenReturn(true);
        when(authSessionRepository.save(any(AuthSession.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        AuthDTO.UserResponse response = authService.replaceActiveSession(
                new AuthDTO.LoginRequest("customer10", "password123"));

        assertNotNull(response.getToken());
        verify(authSessionRepository).deleteAllByUserId(10L);
        verify(authSessionRepository).save(any(AuthSession.class));
    }

    @Test
    void logoutDeletesSessionsForTheAuthenticatedUser() {
        User user = User.builder()
                .id(8L)
                .username("customer8")
                .role("CUSTOMER")
                .build();
        when(userRepository.findByUsernameForUpdate("customer8")).thenReturn(Optional.of(user));
        when(authSessionRepository.deleteAllByUserId(8L)).thenReturn(1);

        int deletedSessions = authService.logout("customer8");

        assertEquals(1, deletedSessions);
        verify(authSessionRepository).deleteAllByUserId(8L);
    }

    @Test
    void changingRoleSavesItAndInvalidatesExistingSessions() {
        User user = User.builder()
                .id(9L)
                .username("shipper9")
                .password("encoded")
                .fullName("Shipper Nine")
                .phone("0912345679")
                .role("SHIPPER")
                .build();
        when(userRepository.findByIdForUpdate(9L)).thenReturn(Optional.of(user));
        when(userRepository.save(user)).thenReturn(user);

        AuthDTO.UserResponse response = authService.updateUserRole(9L, "customer", "admin");

        assertEquals("CUSTOMER", response.getRole());
        verify(authSessionRepository).deleteByUser_Id(9L);
        verify(userRepository).save(user);
    }

    @Test
    void deletingLastAdminIsRejected() {
        User user = User.builder()
                .id(1L)
                .username("another-admin")
                .password("encoded")
                .fullName("Admin")
                .phone("0912345680")
                .role("ADMIN")
                .build();
        when(userRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(user));

        assertThrows(RuntimeException.class, () -> authService.deleteUser(1L, "admin"));

        verify(userRepository, never()).delete(user);
    }

    @Test
    void deletingDefaultShipperIsAllowed() {
        User user = User.builder()
                .id(2L)
                .username("shipper")
                .password("encoded")
                .fullName("Default Shipper")
                .phone("0900000002")
                .role("SHIPPER")
                .build();
        when(userRepository.findByIdForUpdate(2L)).thenReturn(Optional.of(user));

        authService.deleteUser(2L, "admin");

        verify(orderRepository).countByAssignedShipper_IdAndStatusIn(2L, List.of("PENDING", "PENDING_OPENED", "OVERDUE"));
        verify(orderRepository).clearAssignedShipper(2L);
        verify(authSessionRepository).deleteByUser_Id(2L);
        verify(shipperTokenRepository).deleteByShipperId("shipper");
        verify(notificationRepository).deleteByRecipientPhone("0900000002");
        verify(userRepository).delete(user);
    }

    @Test
    void deletingCustomerWithAnyOrderIsRejected() {
        User user = User.builder()
                .id(3L)
                .username("customer3")
                .phone("0912345681")
                .role("CUSTOMER")
                .build();
        when(userRepository.findByIdForUpdate(3L)).thenReturn(Optional.of(user));
        when(orderRepository.countByCustomerPhone("0912345681")).thenReturn(1L);

        assertThrows(RuntimeException.class, () -> authService.deleteUser(3L, "admin"));

        verify(userRepository, never()).delete(user);
        verify(authSessionRepository, never()).deleteByUser_Id(3L);
    }

    @Test
    void deletingCustomerWithoutOrdersIsAllowed() {
        User user = User.builder()
                .id(4L)
                .username("customer4")
                .phone("0912345682")
                .role("CUSTOMER")
                .build();
        when(userRepository.findByIdForUpdate(4L)).thenReturn(Optional.of(user));
        when(orderRepository.countByCustomerPhone("0912345682")).thenReturn(0L);

        authService.deleteUser(4L, "admin");

        verify(authSessionRepository).deleteByUser_Id(4L);
        verify(userRepository).delete(user);
    }

    @Test
    void deletingShipperWithPendingAssignmentsIsRejected() {
        User user = User.builder()
                .id(5L)
                .username("shipper5")
                .phone("0912345683")
                .role("SHIPPER")
                .build();
        when(userRepository.findByIdForUpdate(5L)).thenReturn(Optional.of(user));
        when(orderRepository.countByAssignedShipper_IdAndStatusIn(
                5L, List.of("PENDING", "PENDING_OPENED", "OVERDUE"))).thenReturn(1L);

        assertThrows(RuntimeException.class, () -> authService.deleteUser(5L, "admin"));

        verify(userRepository, never()).delete(user);
        verify(authSessionRepository, never()).deleteByUser_Id(5L);
    }

    @Test
    void changingRoleOfShipperWithPendingAssignmentsIsRejected() {
        User user = User.builder()
                .id(6L)
                .username("shipper6")
                .phone("0912345684")
                .role("SHIPPER")
                .build();
        when(userRepository.findByIdForUpdate(6L)).thenReturn(Optional.of(user));
        when(orderRepository.countByAssignedShipper_IdAndStatusIn(
                6L, List.of("PENDING", "PENDING_OPENED", "OVERDUE"))).thenReturn(1L);

        assertThrows(RuntimeException.class, () -> authService.updateUserRole(6L, "CUSTOMER", "admin"));

        verify(userRepository, never()).save(user);
    }

    @Test
    void startupDoesNotRecreateDefaultAccountsInNonEmptyDatabase() {
        when(userRepository.count()).thenReturn(1L);
        when(userRepository.findByUsername(any())).thenReturn(Optional.empty());

        authService.initDefaultAccounts();

        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void demotingDefaultAdminIsRejected() {
        User user = User.builder().id(1L).username("admin").phone("0900000001").role("ADMIN").build();
        when(userRepository.findByIdForUpdate(1L)).thenReturn(Optional.of(user));

        assertThrows(RuntimeException.class, () -> authService.updateUserRole(1L, "CUSTOMER", "other-admin"));

        verify(userRepository, never()).save(user);
    }

    @Test
    void changingRoleOfAnotherAdminIsRejected() {
        User other = User.builder().id(11L).username("admin2").phone("0900000011").role("ADMIN").build();
        when(userRepository.findByIdForUpdate(11L)).thenReturn(Optional.of(other));

        RuntimeException ex = assertThrows(RuntimeException.class,
                () -> authService.updateUserRole(11L, "SHIPPER", "admin"));

        assertTrue(ex.getMessage().contains("quản trị viên khác"));
        verify(userRepository, never()).save(other);
        verify(authSessionRepository, never()).deleteByUser_Id(11L);
    }

    @Test
    void deletingAnotherAdminIsRejected() {
        User other = User.builder().id(12L).username("admin3").phone("0900000012").role("ADMIN").build();
        when(userRepository.findByIdForUpdate(12L)).thenReturn(Optional.of(other));

        RuntimeException ex = assertThrows(RuntimeException.class, () -> authService.deleteUser(12L, "admin"));

        assertTrue(ex.getMessage().contains("quản trị viên khác"));
        verify(userRepository, never()).delete(other);
    }

    @Test
    void promotingShipperToAdminIsStillAllowed() {
        User shipper = User.builder().id(13L).username("shipper13").phone("0900000013").role("SHIPPER").build();
        when(userRepository.findByIdForUpdate(13L)).thenReturn(Optional.of(shipper));
        when(userRepository.save(shipper)).thenReturn(shipper);

        AuthDTO.UserResponse res = authService.updateUserRole(13L, "ADMIN", "admin");

        assertEquals("ADMIN", res.getRole());
    }
}
