package com.ptit.smartlocker;

import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.entity.Compartment;
import com.ptit.smartlocker.entity.LockerSlotSchedule;
import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.service.OrderService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@Transactional
class OrderCheckoutDoesNotReserveTests {

    private static final String LOCKER_ID = "LOCKER_HN_08";

    @Autowired private OrderService orderService;
    @Autowired private OrderRepository orderRepository;
    @Autowired private CompartmentRepository compartmentRepository;
    @Autowired private LockerSlotScheduleRepository slotScheduleRepository;

    @Test
    @DisplayName("Tạo đơn khi tủ đầy không chiếm ngăn vật lý; suất lịch theo ngày trừ đúng 1 (Q4)")
    void checkoutLeavesCompartmentsUnchanged() {
        List<Compartment> before = compartmentRepository.findByLocker_LockerId(LOCKER_ID);
        assertFalse(before.isEmpty(), "Test cần tủ có ngăn");
        before.forEach(compartment -> {
            compartment.setStatus("RESERVED");
            compartmentRepository.save(compartment);
        });
        Optional<LockerSlotSchedule> scheduleBefore =
                slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER_ID, LocalDate.now());
        Integer availableBefore = scheduleBefore.map(LockerSlotSchedule::getAvailableSlots).orElse(null);

        OrderDTO.OrderResponse response = orderService.createOrder(OrderDTO.CheckoutRequest.builder()
                .customerName("Khách test checkout")
                .customerPhone("0912345678")
                .deliveryType("LOCKER")
                .lockerId(LOCKER_ID)
                .deliveryDate(LocalDate.now())
                .paymentMethod("COD")
                .productName("Kiện test checkout")
                .totalAmount(BigDecimal.valueOf(10000))
                .build());

        Order savedOrder = orderRepository.findById(response.getOrderId()).orElseThrow();
        assertEquals(LOCKER_ID, savedOrder.getLocker().getLockerId());
        assertNull(savedOrder.getCompartment());
        assertNull(savedOrder.getShipperReservedAt());
        assertNull(response.getCompartmentIndex());
        assertFalse(response.getIsShipperReserved());
        assertTrue(compartmentRepository.findByLocker_LockerId(LOCKER_ID).stream()
                .allMatch(compartment -> "RESERVED".equals(compartment.getStatus())));
        Optional<LockerSlotSchedule> scheduleAfter =
                slotScheduleRepository.findByLocker_LockerIdAndScheduleDate(LOCKER_ID, LocalDate.now());
        // Gộp ThanhChung, quyết định Q4: GIỮ cơ chế trừ suất lịch theo ngày của GĐ65 (bản ThanhChung
        // bỏ hẳn). Suất lịch là "chỗ nhận hàng theo ngày", không phải khoá ngăn vật lý.
        assertTrue(scheduleAfter.isPresent(), "Tạo đơn hôm nay phải có lịch biểu của tủ");
        if (availableBefore != null) {
            assertEquals(availableBefore - 1, scheduleAfter.get().getAvailableSlots(),
                    "Suất lịch phải trừ đúng 1");
        }
    }
}
