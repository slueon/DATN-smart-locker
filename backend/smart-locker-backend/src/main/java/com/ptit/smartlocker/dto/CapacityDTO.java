package com.ptit.smartlocker.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

public class CapacityDTO {

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CapacityCheckResponse {
        private String lockerId;
        private String lockerName;
        private LocalDate requestedDate;
        private boolean isAvailable;
        private int remainingSlots;
        private int totalSlots;
        // Graceful Degradation options:
        private boolean allowHomeDeliveryFallback;
        private List<LocalDate> alternativeAvailableDates;
    }
}
