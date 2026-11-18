# Memory

- Từ 14/11/2026 team Tinh Gọn chỉ còn 3 bot: Chief (vai Lead — phân tích yêu cầu + điều phối, tự viết thẻ trong STATE.md), sóc(dev) code, minh(verifier) nghiệm thu. Vai architect đã bỏ.
- The user wants the whole team to understand the project through shared documentation, with one person coordinating how the work is handed out.
- The user decides who gets which role on the team and asks whether new members are needed for a role.
- The user's project already exists with code in place; it sits outside the team workspace and the team must be pointed at the project's absolute path before any work starts.
- Team Tinh Gọn works in D:\DATN-smart-locker, a clone of github.com/slueon/DATN-smart-locker on branch develop; the clone at C:\Users\ShinraX\Desktop\DATN-smart-locker holds the same branch.
- Security round (11-2026) is closed with 8 holes fixed and each verified by a real run (API auth, open create-user, MQTT shipper bypass, token/generate, QR_send lazy-init, by-phone qrToken, client-forged QR); the public broker emqx.io was left for a later round.
- The user wants plans kept but capped at one page with exactly one approval round (at most 3 reasons); after code, review the actual diff and real run output, and bots must not block on wording mismatches — SPEC wins, said once, then move on.
- The user forbids changing work_dir when setting up bots: drop that parameter and install the rest.
- The user's rules for the team's project work: every member finds code locations only from MAP.md at the project root and never scans the whole folder; all assignments, progress and loop counters are written directly into STATE.md; nobody may read ARCHIVE.md.
- Fuse rule for the team: a task card may be reworked at most 2 rounds (Loop 2/2); if minh still returns FAIL at round 2 or the two sides cannot agree, the team stops immediately, writes a short reason in STATE.md and reports to the user for a decision.
- The user's FAIL criteria: only compile errors, failing tests, wrong business requirements, or security/data bugs — no nitpicking over variable names, formatting, or code style.
- Nguyên tắc topic MQTT của dự án Smart Locker: uplink (tủ→backend) dùng topic CHUNG không chứa id, locker_id nằm trong payload JSON; downlink (backend→tủ) dùng topic RIÊNG có {id} để chỉ tủ đó nhận lệnh.
- Kiểm cổng server trên máy user PHẢI dùng HTTP thật hoặc `netstat -ano` — `Get-NetTCPConnection` bỏ sót IPv6 nên báo "port free" dù server đang chạy.

## Index
