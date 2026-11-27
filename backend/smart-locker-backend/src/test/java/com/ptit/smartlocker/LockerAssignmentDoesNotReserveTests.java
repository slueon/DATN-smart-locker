package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.Locker;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@Transactional
class LockerAssignmentDoesNotReserveTests {

    @Autowired private ShipperService shipperService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private LockerRepository lockerRepository;
    @Autowired private CompartmentRepository compartmentRepository;

    private Locker locker;

    @BeforeEach
    void setUp() {
        locker = lockerRepository.findById("LOCKER_HN_01").orElseThrow();
    }

    @Test
    @DisplayName("Chọn tủ chỉ gán trạm, không giữ ngăn dù tủ đã hết chỗ")
    void assignLockerDoesNotReserveCompartment() {
        List<Compartment> compartments = compartmentRepository.findByLocker_LockerId(locker.getLockerId());
        compartments.forEach(compartment -> {
            compartment.setStatus("OCCUPIED");
            compartmentRepository.save(compartment);
        });

        Order order = orderRepository.save(Order.builder()
                .orderId("ORD-AS-NO-RESERVE")
                .customerName("Khách Assign Test")
                .customerPhone("0912000111")
                .deliveryType("LOCKER")
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(10000))
                .productName("Kiện test assign")
                .build());

        OrderDTO.OrderResponse response = shipperService.assignLocker(order.getOrderId(), locker.getLockerId());

        Order savedOrder = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertEquals(locker.getLockerId(), savedOrder.getLocker().getLockerId());
        assertNull(savedOrder.getCompartment());
        assertNull(savedOrder.getShipperReservedAt());
        assertNull(savedOrder.getReserveExpiresAt());
        assertFalse(response.getIsShipperReserved());
        assertNull(response.getCompartmentIndex());
        assertTrue(compartments.stream().allMatch(c -> "OCCUPIED".equals(c.getStatus())));
    }

    @Test
    @DisplayName("Chỉ thao tác đặt trước mới chuyển ngăn trống sang RESERVED")
    void explicitReservationHoldsCompartment() {
        List<Compartment> compartments = compartmentRepository.findByLocker_LockerId(locker.getLockerId());
        Compartment target = compartments.get(0);
        target.setStatus("EMPTY");
        compartmentRepository.save(target);

        Order order = orderRepository.save(Order.builder()
                .orderId("ORD-AS-EXPLICIT-RESERVE")
                .customerName("Khách Assign Test")
                .customerPhone("0912000112")
                .deliveryType("LOCKER")
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(10000))
                .productName("Kiện test reservation")
                .locker(locker)
                .build());

        OrderDTO.OrderResponse response = shipperService.reserveCompartment(
                order.getOrderId(), order.getOrderId(), target.getCompIndex(), 1);

        Order savedOrder = orderRepository.findById(order.getOrderId()).orElseThrow();
        assertEquals(target.getCompartmentId(), savedOrder.getCompartment().getCompartmentId());
        assertNotNull(savedOrder.getShipperReservedAt());
        assertTrue(response.getIsShipperReserved());
        assertEquals("RESERVED",
                compartmentRepository.findById(target.getCompartmentId()).orElseThrow().getStatus());
    }

    @Test
    @DisplayName("Không cho đơn khác đặt ngăn đã được đơn PENDING giữ trước")
    void cannotReserveCompartmentHeldByAnotherOrder() {
        Compartment target = compartmentRepository.findByLocker_LockerId(locker.getLockerId()).get(0);
        target.setStatus("EMPTY");
        compartmentRepository.save(target);

        Order owner = orderRepository.save(Order.builder()
                .orderId("ORD-AS-RESERVE-OWNER")
                .customerName("Khách giữ ngăn")
                .customerPhone("0912000113")
                .deliveryType("LOCKER")
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(10000))
                .productName("Kiện giữ ngăn")
                .locker(locker)
                .build());
        shipperService.reserveCompartment(owner.getOrderId(), owner.getOrderId(), target.getCompIndex(), 1);

        Order otherOrder = orderRepository.save(Order.builder()
                .orderId("ORD-AS-RESERVE-OTHER")
                .customerName("Khách khác")
                .customerPhone("0912000114")
                .deliveryType("LOCKER")
                .expectedDate(LocalDate.now())
                .status("PENDING")
                .totalAmount(BigDecimal.valueOf(10000))
                .productName("Kiện khác")
                .locker(locker)
                // Tái hiện đơn cũ đang trỏ tới ngăn này: không được dùng quan hệ cũ để
                // bỏ qua trạng thái RESERVED của một đơn khác.
                .compartment(target)
                .build());

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> shipperService.reserveCompartment(
                        otherOrder.getOrderId(), otherOrder.getOrderId(), target.getCompIndex(), 1));

        assertTrue(error.getMessage().contains("đã có đơn khác giữ chỗ"));
        assertEquals("RESERVED",
                compartmentRepository.findById(target.getCompartmentId()).orElseThrow().getStatus());
        assertNotNull(orderRepository.findById(owner.getOrderId()).orElseThrow().getShipperReservedAt());
        assertNull(orderRepository.findById(otherOrder.getOrderId()).orElseThrow().getShipperReservedAt());
    }
}
