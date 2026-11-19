# BÁO CÁO KIỂM THỬ TÍNH NĂNG — Smart Locker web (18/11/2026)

Tổng hợp từ `docs/KIEM-THU-TINH-NANG.md` (61 tính năng / 47 phép thử). Log & ảnh trong `scripts/evidence/test-plan/`.

## 0. LƯỢT CHẠY LẠI 19/11/2026 (sau GĐ64–GĐ69)

Chạy lại toàn bộ trên code `d7a4f90` (GĐ69). Lượt bị tạm dừng một lần giữa `nhom-FG-fix2` theo yêu cầu, sau đó chạy tiếp từ `nhom-FG-fix2`, không chạy lại nhóm đã xong.
Log: `scripts/evidence/test-plan/luot-19-11-phan1.log`, `luot-19-11-phan2.log`, `luot-19-11-mvn-test.log`.

**Kết luận: 0 lỗi sản phẩm.** Mọi FAIL ở lượt đo đầu là lỗi script đã biết (bảng mục 2), lượt đo lại đều PASS.

| Phần | Kết quả | Ghi chú |
|---|---|---|
| Backend `mvnw test` (DB `smart_locker_tester`, MQTT tắt) | 151/152 PASS | 1 test chập chờn, xem LỖI-T01 |
| Frontend `vite build` | PASS | Cảnh báo chunk > 500 kB |
| Frontend `npm run lint` (oxlint) | 0 lỗi, 108 cảnh báo | Chủ yếu import thừa, thiếu dependency hook |
| A+H — API/auth | 23/23 | |
| B — UI khách hàng | 14/14 | |
| C/D/E — UI shipper | 19/23 → đo lại `nhom-C-fix` 8/8 | FAIL = lỗi script #2, #3 |
| F/G — UI admin | 18/20 → `nhom-FG-fix` 3/5 → `nhom-FG-fix2` 5/5 | FAIL = lỗi script #4, #5, #6 |
| E2E qua MQTT tủ ảo | 9/16 → `fix` 12/15 → `fix2` 4/5 → `fix3` 4/4 | FAIL = lỗi script #7–#12 |
| Nhóm còn lại | 14/18 → `nhom-con-lai-fix` 6/7 | FAIL = lỗi script #13, #14, #15 |
| Đặt trước ngăn `nhom-dattruoc` | 4/4 | |

**LỖI-T01** | backend test | `ReservationTimeoutServiceTests.donMotGioQua65PhutThiNha` | Lần chạy đầu FAIL (`expected <null> but was <…16:11:35.470>`), chạy lại riêng 2 lần đều PASS 13/13 | Nguyên nhân: test đặt `reserveExpiresAt = now + 0 phút` đúng ranh giới, truy vấn so `reserveExpiresAt < :now` (`OrderRepository.java:92`) và MySQL `DATETIME` làm tròn phần lẻ giây lên ⇒ đôi khi giá trị lưu > `now` | Lỗi **test**, không phải sản phẩm | Đề xuất: đổi tham số `0L` thành `-1L` (đã quá hạn 1 phút) | LOW — **chưa sửa**.

**Dữ liệu sau lượt 19/11:** `orders=4`, `pickup_credentials=4`, `users=5`, `compartments 20/20 EMPTY`, `shipper_identity_tokens=32` — giữ nguyên so với đầu lượt. `command_logs` 80 → 82 (lệnh MQTT của chính bài đo). `token142` đầu lượt `1/LOCKER_HN_02`, giữa lượt bị đặt về `0/NULL` (khi UI shipper lấy mã QR), cuối lượt về lại `1/LOCKER_HN_02`. `LOCKER_HN_01.last_heartbeat` giữ nguyên — tủ thật không bị đụng.

### 0.1 ĐO ĐỘ ỔN ĐỊNH (19/11/2026)

Script: `scripts/evidence/test-plan/on-dinh.mjs` (chỉ ĐỌC, không publish MQTT). Log: `on-dinh.log`, `on-dinh.json`, `on-dinh.stdout.log`.
Tham số lượt này: giữ trang `SOAK_MIN=5` phút/vai trò, chuyển tab `CYCLES=10` vòng, tải lại `RELOADS=10` lần, cửa sổ đo poll `POLL_SEC=60`. Tổng thời gian 24 phút.

**Kết quả: 28/28 PASS, 0 lỗi sản phẩm.**

| Bài | ADMIN | SHIPPER | CUSTOMER | Ngưỡng ĐẠT |
|---|---|---|---|---|
| S1 — chuyển tab liên tục, vùng `main` render | 70/70 | 30/30 | 20/20 | Mọi lần render ≤ 8 s, không màn lỗi |
| S2 — tốc độ poll trước → sau S1 | 12 → 12 req/phút | 18 → 18 | 12 → 12 | Không tăng quá 30% (interval không bị nhân bản) |
| S3a — heap JS sau GC, giữ trang 5 phút | 9,30 → 9,33 MB | 8,88 → 9,00 | 8,90 → 9,11 | Tăng < 5 MB và < 25% |
| S3b — DOM node / listener khi đứng yên | 2615 / 240 không đổi | 517 / 181 không đổi | 396 / 179 không đổi | Tăng < 20% |
| S4 — tải lại trang 10 lần | 10/10, p50 354 ms, max 726 | 10/10, 524 / 982 | 10/10, 491 / 918 | Vẫn đăng nhập, render < 15 s |
| E1 — lỗi console / exception | 0 | 0 | 0 | 0 |
| E2 — HTTP 4xx/5xx | 0 | 0 | 0 | 0 lỗi 5xx |

| Bài API (10 endpoint đọc, 3 vai trò) | Kết quả | Ngưỡng ĐẠT |
|---|---|---|
| S5 — 300 request tuần tự | 0 lỗi, p50 4 ms, p95 6 ms, max 9 ms | 0 lỗi 5xx, p95 < 500 ms |
| S6 — 500 request, 50 song song/đợt | 0 lỗi, p50 24 ms, p95 41 ms, max 44 ms | 0 lỗi 5xx, p95 < 2000 ms |
| S7 — phản hồi ngay sau khi dồn tải | 200, 4 ms | 200, < 1 s |
| T-BASE — baseline DB | không đổi | không đổi |

**Nhận xét:**
- Poll đo được: `/api/notifications` 12 lần/phút (mọi vai trò), `/api/shipper/orders/pending` 6 lần/phút (shipper). Sau 70 lần chuyển tab vẫn giữ đúng nhịp ⇒ không rò `setInterval`.
- ADMIN: DOM node 605 (lúc đầu) → 2615 sau khi chuyển tab, rồi đứng yên suốt 5 phút. Nhiều khả năng do subtab cuối được giữ lại có nhiều dòng hơn subtab "Tổng quan" (chưa kiểm xác nhận). Không tăng thêm ⇒ không phải rò.

**Giới hạn:** soak 5 phút/vai trò, chưa chạy nhiều giờ (chạy lâu hơn bằng `SOAK_MIN=60`). Chrome headless, một máy. Dồn tải chỉ trên API đọc; luồng ghi (nạp tủ, xác thực OTP) và MQTT chưa đo dưới tải.

## 1. KẾT QUẢ THEO NHÓM (lượt 18/11)

| Nhóm | Phạm vi | Phép | ĐẠT | Lỗi sản phẩm |
|---|---|---|---|---|
| A + H | API/auth: đăng nhập 3 vai trò, 401/403, endpoint đọc, chống IDOR OTP | 23 | **23** | 0 |
| B | UI khách hàng: sidebar, breadcrumb, 5 bộ lọc, tìm kiếm, modal QR/OTP, chuông, bản đồ | 14 | **13** (+1 lỗi script, đo lại ĐẠT) | 0 |
| C/D/E | UI shipper: nạp tủ, thanh 5 bước, QR định danh, đặt trước ngăn, thu hồi, lộ trình | 23 (+8 đo lại) | **23** | 0 |
| F/G | UI admin: 5 subtab, sơ đồ ngăn 10 tủ, mở khoá 2 bước, quá hạn chỉ đọc, người dùng, lịch sử, bản đồ GIS, bảo trì | 20 (+5 đo lại) | **20** | 0 |
| E2E | Luồng thật qua MQTT tủ ảo: kiosk 4 chặng, OVERDUE → thu hồi, OTP đúng/sai, MAINTENANCE chặn deposit | 16 (+15+5+4 đo lại) | **16** | 0 |
| Cuối | Đặt trước/huỷ ngăn, tạo đơn thật, modal QR/OTP với đơn thật, chuông, thanh bước, scheduler | 18 (+7+4 đo lại) | **18** | 0 |

**Tổng: 114 lượt kiểm (gồm cả lượt đo lại), 0 lỗi sản phẩm.**

## 2. LỖI SẢN PHẨM PHÁT HIỆN

**Chưa phát hiện lỗi sản phẩm nào.** Toàn bộ 12 "FAIL" ở các lượt đầu đều do **script đo của tôi sai**, đã xác minh bằng cách đọc source và đo lại:

| # | Phép | Nguyên nhân SAI của script | Xác minh |
|---|---|---|---|
| 1 | F-08c | Nút "Đã đọc" chỉ render khi `unreadCount > 0` | `Header.jsx:141` |
| 2 | F-23a/b | CSS `uppercase` ⇒ `innerText` là chữ HOA | `ShipperTab.jsx:1092,1102` |
| 3 | F-26a/F-27a | 2 khối chỉ render khi `activeOrder` tồn tại | `ShipperTab.jsx:1349,1530` |
| 4 | F-46b | Nhãn nút nằm ở **thuộc tính `title`**, không trong innerText | `AdminTab.jsx:637` |
| 5 | F-55a | Là **nút** "Bảo trì toàn tủ", không phải checkbox | `LockerNetworkMapTab.jsx:1205-1217` |
| 6 | F-56b | CSS `uppercase` | `LockerNetworkMapTab.jsx:1292` |
| 7 | E2E-03 | Payload `select_compartment` **0-based**, DB lưu `comp_index` **1-based** | `fixture.mjs:122-137` |
| 8 | F-32a/F-36b/F-37a | Đọc đơn **sau** khi `withOrder` đã xoá trong `finally` | `fixture.mjs:70-79` |
| 9 | F-59b | DTO verify dùng `authMethod` + `code`, không phải `credentialType` + `credential` | `PickupDTO.java:18-24` |
| 10 | F-36b (lần 2) | Quên quét QR shipper trước khi recall (GĐ44 bắt buộc) | `ShipperService.java:259` |
| 11 | F-36b (lần 3) | Fixture tạo đơn **không gán ngăn** ⇒ 409 "Không xác định được tủ/ngăn"; đơn OVERDUE thật luôn có `compartment_id` | `ShipperService.java` nhánh mở ngăn |
| 12 | T-47b | `cmd` +1 do chính lệnh bảo trì/mở cửa của bài đo ghi `command_logs` | `command_logs` tăng đúng bằng số lệnh test |
| 13 | T-20a | `assign-locker` (nút "Chọn tủ này") **đã** đặt ngăn thành RESERVED; gọi `reserve` thêm lần nữa bị từ chối là ĐÚNG | `ShipperService` "Đơn … đã được đặt trước" |
| 14 | T-12a | Nút thật là **"Tạo Mã OTP (5 phút)"**, không có chữ "Nhận" | `CustomerPickupTab.jsx` |
| 15 | T-20a (lần 1) | `GET /lockers/{id}/compartments` trả `compIndex` **1-based**, gửi `0` là sai | `LockerController` + API thật trả `compIndex: 1,2` |
| 16 | Nhóm cuối (T-47c) | 2 đơn `ORD-LIB-*` sót do script bị **kill giữa chừng khi server restart**, `finally` không chạy | Đã kiểm tham chiếu rồi dọn, baseline về 0 |

## 3. HÀNH VI ĐÚNG ĐÁNG CHÚ Ý (không phải lỗi)

- **Chống dò mã OTP hoạt động:** OTP sai ⇒ 409 "Mã xác thực không chính xác! Bạn còn 4 lần thử."
- **ADMIN không có quyền thu hồi** (đúng quyết định 16/11): nút thu hồi = 0.
- **`recall-overdue/open` chặn khi chưa xác thực**: 400 "Mã QR Shipper chưa được quét xác thực tại trạm tủ!"
- **Mã QR shipper vĩnh viễn:** gọi `token/generate` lần 2 trả **cùng** mã (đúng GĐ15).
- **`/shipper/customers` không trả `password`/`role`** (chống lộ danh bạ).
- **`request-otp` với đơn không tồn tại ⇒ 404**, không lộ mã.
- **Tủ MAINTENANCE chặn deposit** đúng như yêu cầu của user.
- **Đặt trước ngăn không cho ghi đè:** gọi `reserve` lần 2 ⇒ 400 "Đơn … đã được đặt trước. Huỷ đặt trước trước".
- **Thanh 5 bước nạp tủ** đi đúng trình tự `2 → 3 → 4 → 5 → 6` theo sự kiện MQTT thật.
- **Modal OTP** có đủ mã 6 số + đếm ngược 5 phút + "Sao chép" + "Đổi mã mới".

## 4. DỮ LIỆU SAU KIỂM THỬ

- `orders=0`, `pickup_credentials=0`, `users=5`, `compartments 20/20 EMPTY`, `shipper_identity_tokens=32`.
- `command_logs` 63 → 65 (2 lệnh bảo trì toàn tủ của bài đo, đã mở khoá lại).
- `LOCKER_HN_01.last_heartbeat` giữ nguyên `2026-11-17 22:19:09` — tủ thật không bị đụng.
- Mọi thử nghiệm MQTT chỉ trên tủ ảo `LOCKER_HN_02`.

## 5. PHẠM VI KHÔNG KIỂM

- Phần cứng thật (ESP32, GM65, HX711): chỉ giả lập MQTT.
- Load test / nhiều người dùng đồng thời.
- `frontend/src/services/testEngine.js` (32 "test case") là mô phỏng localStorage, **không gọi backend** — không dùng làm bằng chứng.
