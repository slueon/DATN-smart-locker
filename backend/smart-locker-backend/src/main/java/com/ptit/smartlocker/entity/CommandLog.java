package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.Builder;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "command_logs")
@Getter
@Setter
@Builder
public class CommandLog {

    @Id
    @Column(name = "command_id", length = 50)
    private String commandId;

    public CommandLog() {}

    public CommandLog(String commandId, Locker locker, Integer compartmentId, String commandType, LocalDateTime sentAt, LocalDateTime ackReceivedAt, String status) {
        this.commandId = commandId;
        this.locker = locker;
        this.compartmentId = compartmentId;
        this.commandType = commandType != null ? commandType : "OPEN_DOOR";
        this.sentAt = sentAt;
        this.ackReceivedAt = ackReceivedAt;
        this.status = status != null ? status : "SENT";
    }

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "locker_id", nullable = false)
    private Locker locker;

    @Column(name = "compartment_id", nullable = false)
    private Integer compartmentId;

    @Column(name = "command_type", nullable = false, length = 30)
    @Builder.Default
    private String commandType = "OPEN_DOOR";

    @CreationTimestamp
    @Column(name = "sent_at", updatable = false)
    private LocalDateTime sentAt;

    @Column(name = "ack_received_at")
    private LocalDateTime ackReceivedAt;

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "SENT"; // SENT, SUCCESS, TIMEOUT
}
