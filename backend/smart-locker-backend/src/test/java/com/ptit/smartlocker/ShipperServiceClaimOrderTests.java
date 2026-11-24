package com.ptit.smartlocker;

import com.ptit.smartlocker.entity.Order;
import com.ptit.smartlocker.entity.User;
import com.ptit.smartlocker.repository.CompartmentRepository;
import com.ptit.smartlocker.repository.DeviceEventRepository;
import com.ptit.smartlocker.repository.LockerRepository;
import com.ptit.smartlocker.repository.LockerSlotScheduleRepository;
import com.ptit.smartlocker.repository.OrderRepository;
import com.ptit.smartlocker.repository.PickupCredentialRepository;
import com.ptit.smartlocker.repository.ShipperIdentityTokenRepository;
import com.ptit.smartlocker.repository.UserRepository;
import com.ptit.smartlocker.service.ShipperService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ShipperServiceClaimOrderTests {

    @Mock
    private ShipperIdentityTokenRepository tokenRepository;
    @Mock
    private OrderRepository orderRepository;
    @Mock
    private CompartmentRepository compartmentRepository;
    @Mock
    private PickupCredentialRepository credentialRepository;
    @Mock
    private DeviceEventRepository deviceEventRepository;
    @Mock
    private LockerSlotScheduleRepository slotScheduleRepository;
    @Mock
    private LockerRepository lockerRepository;
    @Mock
    private UserRepository userRepository;

    private ShipperService shipperService;

    @BeforeEach
    void setUp() {
        shipperService = new ShipperService(
                tokenRepository,
                orderRepository,
                compartmentRepository,
                credentialRepository,
                deviceEventRepository,
                slotScheduleRepository,
                lockerRepository,
                userRepository);
    }

    @Test
    void claimAssignsPendingOrderToAuthenticatedShipper() {
        User shipper = User.builder().id(7L).username("shipper7").role("SHIPPER").build();
        Order order = Order.builder().orderId("order-1").status("PENDING").build();
        when(userRepository.findByUsernameForUpdate("shipper7")).thenReturn(Optional.of(shipper));
        when(orderRepository.findByIdForShipperClaim("order-1")).thenReturn(Optional.of(order));

        shipperService.claimPendingOrder("order-1", "shipper7");

        assertEquals(shipper, order.getAssignedShipper());
        verify(orderRepository).save(order);
    }

    @Test
    void anotherShipperCannotClaimAnAlreadyAssignedOrder() {
        User requestingShipper = User.builder().id(7L).username("shipper7").role("SHIPPER").build();
        User currentShipper = User.builder().id(8L).username("shipper8").role("SHIPPER").build();
        Order order = Order.builder()
                .orderId("order-1")
                .status("PENDING")
                .assignedShipper(currentShipper)
                .build();
        when(userRepository.findByUsernameForUpdate("shipper7")).thenReturn(Optional.of(requestingShipper));
        when(orderRepository.findByIdForShipperClaim("order-1")).thenReturn(Optional.of(order));

        assertThrows(IllegalArgumentException.class,
                () -> shipperService.claimPendingOrder("order-1", "shipper7"));

        verify(orderRepository, never()).save(order);
    }
}
