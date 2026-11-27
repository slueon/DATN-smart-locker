package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.OrderService;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Các điểm nối khi gộp nhánh của ThanhChung vào develop (không thuộc riêng bên nào).
 */
@SpringBootTest
@Transactional
class MergeThanhChungTests {

    @Autowired private ShipperService shipperService;
    @Autowired private OrderService orderService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;

    @Test
    @DisplayName("Admin tạo đơn số tiền âm ⇒ bị chặn như checkout (GĐ75 #3)")
    void adminTaoDonTienAmBiChan() {
        ShipperDTO.CreateOrderByAdminRequest req = new ShipperDTO.CreateOrderByAdminRequest();
        req.setCustomerUsername("khachhang");
        req.setLockerId("LOCKER_HN_01");
        req.setShipperUsername("shipper");
        req.setProductName("Kiện âm");
        req.setTotalAmount(BigDecimal.valueOf(-5));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> shipperService.createOrderByAdmin(req));
        assertTrue(ex.getMessage().contains("số âm"));
    }

    @Test
    @DisplayName("Q1: đơn SHIPPER tự tạo được gán cho chính shipper đó; ADMIN tạo qua checkout thì để trống")
    void donShipperTuTaoDuocGanChoNguoiTao() {
        String lockerId = lockerRepository.findAll().stream()
                .filter(l -> !"MAINTENANCE".equalsIgnoreCase(l.getConnectionStatus()))
                .findFirst().orElseThrow().getLockerId();
        OrderDTO.CheckoutRequest req = OrderDTO.CheckoutRequest.builder()
                .customerName("Khách gộp")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .lockerId(lockerId)
                .deliveryDate(LocalDate.now())
                .productName("Kiện gộp")
                .totalAmount(BigDecimal.valueOf(1000))
                .build();

        OrderDTO.OrderResponse cuaShipper = orderService.createOrder(req, "shipper");
        Order luu = orderRepository.findById(cuaShipper.getOrderId()).orElseThrow();
        assertNotNull(luu.getAssignedShipper());
        assertEquals("shipper", luu.getAssignedShipper().getUsername());
        assertEquals("shipper", cuaShipper.getAssignedShipperUsername());

        OrderDTO.OrderResponse cuaAdmin = orderService.createOrder(req, "admin");
        assertNull(orderRepository.findById(cuaAdmin.getOrderId()).orElseThrow().getAssignedShipper());
    }
}
