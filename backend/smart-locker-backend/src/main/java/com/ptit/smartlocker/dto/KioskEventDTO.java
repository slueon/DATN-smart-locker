package com.ptit.smartlocker.dto;

import lombok.Builder;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * Phản hồi của {@code GET /api/shipper/kiosk-events}.
 *
 * <p><b>Luôn trả {@code latestSeq}</b> kể cả khi {@code events} rỗng: client gọi lần đầu
 * KHÔNG kèm {@code after} để lấy mốc hiện tại, nhờ vậy không phát lại popup của lần test
 * trước (đúng yêu cầu "không phát lại popup cũ").
 *
 * <p>Không trả thẳng {@code KioskEventService}'s buffer vì client cần cả mốc seq trong
 * cùng một payload — hai request riêng sẽ có khe hở giữa lúc đọc mốc và lúc đọc sự kiện.
 */
@Getter
@Setter
@Builder
public class KioskEventDTO {

    /** Số thứ tự lớn nhất hiện có; client dùng làm {@code after} cho lần poll kế tiếp. */
    private long latestSeq;

    private List<KioskEvent> events;
}
