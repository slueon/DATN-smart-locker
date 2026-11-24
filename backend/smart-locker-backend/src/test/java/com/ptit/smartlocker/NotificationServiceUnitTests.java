package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Notification;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.NotificationRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.NotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * GĐ64a — unit (Mockito, không DB) cho {@link NotificationService#notify}: chống trùng và
 * "lỗi không lan ra giao dịch chính".
 */
class NotificationServiceUnitTests {

    private NotificationRepository repo;
    private NotificationService service;

    @BeforeEach
    void setUp() {
        repo = mock(NotificationRepository.class);
        // Mock transaction manager: TransactionTemplate vẫn gọi callback, commit/rollback là no-op.
        service = new NotificationService(repo, mock(UserRepository.class),
                mock(LockerRepository.class), mock(PlatformTransactionManager.class));
    }

    @Test
    @DisplayName("GĐ64a: chưa có dòng trùng ⇒ ghi 1 dòng, trả true")
    void ghiKhiKhongTrung() {
        when(repo.existsRecent(anyString(), anyString(), anyString(), isNull(), anyString(), any()))
                .thenReturn(false);

        assertTrue(service.notify("DEPOSIT_SUCCESS", "0911000001", null, "ORD-1", "qr", "t", "m"));
        verify(repo, times(1)).save(any(Notification.class));
    }

    @Test
    @DisplayName("GĐ64a: đã có dòng cùng type+đơn+người nhận trong 60 s ⇒ bỏ qua, KHÔNG save")
    void boQuaKhiTrung() {
        when(repo.existsRecent(anyString(), anyString(), anyString(), isNull(), anyString(), any()))
                .thenReturn(true);

        assertFalse(service.notify("DEPOSIT_SUCCESS", "0911000001", null, "ORD-1", "qr", "t", "m"));
        verify(repo, never()).save(any(Notification.class));
    }

    @Test
    @DisplayName("GĐ64a: repository ném lỗi ⇒ notify KHÔNG ném, trả false")
    void loiKhongLan() {
        when(repo.existsRecent(any(), any(), any(), any(), any(), any())).thenReturn(false);
        when(repo.save(any(Notification.class))).thenThrow(new RuntimeException("DB chết"));

        assertDoesNotThrow(() ->
                assertFalse(service.notify("PICKUP_SUCCESS", "0911000001", null, "ORD-2", null, "t", "m")));
    }

    @Test
    @DisplayName("GĐ64a: không có người nhận (phone và role đều trống) ⇒ không truy vấn, không ghi")
    void khongCoNguoiNhan() {
        assertFalse(service.notify("PICKUP_SUCCESS", "  ", null, "ORD-3", null, "t", "m"));
        verifyNoInteractions(repo);
    }

    @Test
    @DisplayName("GĐ64a: helper nghiệp vụ với Order null / lỗi ⇒ không ném")
    void helperKhongNem() {
        assertDoesNotThrow(() -> {
            service.depositSuccess(null, 1);
            service.depositFailed(null, 1);
            service.pickupSuccess(null);
            service.overdue(null);
            service.recalled(null);
            service.kioskMethodChosen("LOCKER_HN_02", "qr", null);
        });
    }

    @Test
    @DisplayName("Nạp thất bại: thông báo gửi riêng tới shipper được phân công")
    void depositFailedTargetsAssignedShipper() {
        User assignedShipper = User.builder().phone("0911000002").build();
        Order order = Order.builder()
                .orderId("ORD-DEPOSIT-FAILED")
                .assignedShipper(assignedShipper)
                .build();
        ArgumentCaptor<Notification> notification = ArgumentCaptor.forClass(Notification.class);

        service.depositFailed(order, 2);

        verify(repo).save(notification.capture());
        assertEquals("DEPOSIT_FAILED", notification.getValue().getType());
        assertEquals("0911000002", notification.getValue().getRecipientPhone());
        assertNull(notification.getValue().getRecipientRole());
        assertEquals("ORD-DEPOSIT-FAILED", notification.getValue().getOrderId());
    }

    @Test
    @DisplayName("Nạp thất bại khi chưa phân công: không phát thông báo chung cho shipper")
    void depositFailedWithoutAssignmentDoesNotBroadcast() {
        service.depositFailed(Order.builder().orderId("ORD-UNASSIGNED").build(), 2);

        verifyNoInteractions(repo);
    }
}
