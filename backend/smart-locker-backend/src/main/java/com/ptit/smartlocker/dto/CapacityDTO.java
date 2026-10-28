package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.List;

public class CapacityDTO {

    @Getter
    @Setter
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

        public CapacityCheckResponse() {
        }

        public CapacityCheckResponse(String lockerId, String lockerName, LocalDate requestedDate, boolean isAvailable, int remainingSlots, int totalSlots, boolean allowHomeDeliveryFallback, List<LocalDate> alternativeAvailableDates) {
            this.lockerId = lockerId;
            this.lockerName = lockerName;
            this.requestedDate = requestedDate;
            this.isAvailable = isAvailable;
            this.remainingSlots = remainingSlots;
            this.totalSlots = totalSlots;
            this.allowHomeDeliveryFallback = allowHomeDeliveryFallback;
            this.alternativeAvailableDates = alternativeAvailableDates;
        }
    }
}
