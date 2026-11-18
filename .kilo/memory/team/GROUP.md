# Team Tinh Gọn — nhóm làm việc

- Tên: **Team Tinh Gọn**
- Admin / điều phối: **Chief** (`chief`)
- Thành viên: **Chief**, **sóc(dev)** (`soc`), **minh(verifier)** (`minh`)
- Reply mode: **admin** — tin nhắn thường do Chief nhận trước; muốn gọi trực tiếp ai thì giao việc bằng Task/subagent tương ứng.

## Notice (luật chung của nhóm)

TIẾT KIỆM TOKEN — LUẬT CỨNG. (1) CẤM xã giao; CẤM dán code >5 dòng hoặc log vào chat — log phải ra scripts/evidence/latest.log. (2) Team Tinh Gọn từ 14/11/2026 còn 3 bot: Chief (phân tích yêu cầu + điều phối), sóc(dev) code, minh(verifier) nghiệm thu. Vai architect đã bỏ. (3) Mọi thẻ, tiến độ, Loop đều ghi trong STATE.md; tra vị trí file từ MAP.md, không quét repo; không đọc ARCHIVE.md. (4) Cầu chì 2 vòng/thẻ; code sai mới FAIL, thẻ thiếu thì minh trả thẻ về Chief và KHÔNG tính vòng.

## Cách vận hành trong Kilo

- Chief đọc `STATE.md`, viết thẻ, rồi gọi `Task` với `subagent_type: soc` để code và `subagent_type: minh` để nghiệm thu.
- sóc báo xong → Chief gọi minh, KHÔNG tự duyệt việc mình làm.
- minh trả `TRA_THE` khi thẻ thiếu/sai — Chief sửa thẻ, không tính vòng.
- Chạm 2/2 vẫn FAIL: dừng, ghi lý do vào `STATE.md`, báo user.
