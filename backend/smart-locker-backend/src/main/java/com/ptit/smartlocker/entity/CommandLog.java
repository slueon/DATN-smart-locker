package com.ptit.smartlocker.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "command_logs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CommandLog {

    @Id
    @Column(name = "command_id", length = 50)
    private String commandId;

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
