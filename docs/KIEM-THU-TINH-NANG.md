# KẾ HOẠCH KIỂM THỬ TOÀN BỘ TÍNH NĂNG — Smart Locker (web)

> Lập 18/11/2026 bởi Chief. Đây là **danh mục tính năng + ma trận phép thử**; kết quả đo ghi vào `STATE.md`, lỗi ghi vào mục "LỖI PHÁT HIỆN".
> Quy ước: `F-xx` = tính năng, `T-xx` = phép thử. Mỗi phép thử phải có **log trong `scripts/evidence/`**.

## 0. Môi trường & luật khi đo
- App: `http://localhost:5173` · API `http://localhost:8080/api` · bật bằng `node scripts/devctl.mjs up`.
- Tài khoản: `admin/admin123` (ADMIN) · `shipper/shipper123` (SHIPPER) · `khachhang/123456` (CUSTOMER).
- Đo UI bằng `scripts/lib/cdp.mjs` (`withPage`, `loginAs`, `waitReady`, `textsOf`, `hasText`, `clickByText`, `collectErrors`, `openTab`, `watchAttr`) — **không viết lại CDP client**.
- Đọc **cấu trúc DOM** (`textsOf`/`hasText` trên phần tử), không dò chuỗi `innerText` bằng tay.
- **KHÔNG sửa code sản phẩm** trong lượt kiểm thử này. Gặp lỗi → ghi lại rồi chạy tiếp.
- Tủ thật `Tu_1`/`LOCKER_HN_01`: không ghi `compartments`, không publish bản tin mang id đó. Thử nghiệm dùng `LOCKER_HN_02`.
- Baseline trước khi đo: `orders=0`, `pickup_credentials=0`, `command_logs=63`, `shipper_identity_tokens=32`, `users=5`, `compartments 20/20 EMPTY`.
- Sau mỗi nhóm phải kiểm baseline **không đổi** (`db.mjs` → `baseline()`), và ghi lại ngay vào `STATE.md`.
- Lưu ý: `frontend/src/services/testEngine.js` chứa 32 "test case" nhưng là **mô phỏng cục bộ trong localStorage**, KHÔNG gọi backend — không dùng làm bằng chứng.

## 1. DANH MỤC TÍNH NĂNG

### A. Chung / khung ứng dụng (mọi vai trò)
| ID | Tính năng | Vị trí |
|---|---|---|
| F-01 | Đăng nhập bằng username hoặc số điện thoại | `LoginPage.jsx`, `AuthController:/auth/login` |
| F-02 | Đăng ký tài khoản khách mới | `LoginPage.jsx`, `/auth/register` |
| F-03 | Chặn đăng nhập sai (mật khẩu sai, tài khoản không tồn tại) | `AuthService` (BCrypt) |
| F-04 | Phân quyền tab theo vai trò (khách không vào được tab admin) | `App.jsx:49-63`, `SecurityConfig` |
| F-05 | Sidebar: thu gọn/mở rộng, nhãn theo vai trò, thông tin người dùng | `Sidebar.jsx` |
| F-06 | Đăng xuất, xoá phiên localStorage | `Sidebar.jsx`, `App.jsx:71` |
| F-07 | Header: breadcrumb đổi theo tab | `Header.jsx:37-52` |
| F-08 | Chuông thông báo: badge chưa đọc, bộ lọc (Tất cả / Mã OTP-Nhận / Cảnh báo quá hạn), "Đã đọc" | `Header.jsx:64-92` |
| F-09 | Sidebar badge số đơn quá hạn (ADMIN/SHIPPER; CUSTOMER ẩn) | `Sidebar.jsx:37-72` |
| F-10 | Chuyển tab có animation, không lỗi console | `App.jsx:116` |

### B. KHÁCH HÀNG — `CustomerPickupTab.jsx`
| ID | Tính năng | Vị trí |
|---|---|---|
| F-11 | Khối "Bưu kiện đang chờ bạn" (đơn đang chờ + trạng thái) | `:980-1130` |
| F-12 | Sơ đồ ngăn tủ của khách (hiện cả 2 ngăn khi chưa nạp, chỉ ngăn có đơn sau khi nạp) | `:1099-1145`, `LockerCabinetVisualizer` |
| F-13 | Lịch sử đơn + 5 bộ lọc (Tất cả / Hàng đã về tủ / Chờ giao / Đã nhận / Đơn đã huỷ) | `:1149-1180` |
| F-14 | Tìm kiếm đơn theo mã đơn / tên sản phẩm / trạm tủ | placeholder `:1160` |
| F-15 | Sắp xếp lịch sử đơn mới nhất trước | `:1149` |
| F-16 | Modal QR nhận hàng (phóng to, tải lại mã, đóng) | `:1579-1620` |
| F-17 | Modal OTP (đếm ngược 5 phút, sao chép, đổi mã mới, hết hạn) | `:1708-1770`, `CircularTimer` |
| F-18 | Popup "Lấy hàng thành công" + tự cập nhật danh sách | `:1624-1670` |
| F-19 | Bấm thông báo Kiosk → mở đúng modal QR/OTP | `Header.jsx:82-92` + `:835-860` |
| F-20 | Bản đồ mạng lưới tủ (tìm kiếm, lọc trạng thái, marker 3 màu) | `LockerNetworkMapTab.jsx` |

### C. SHIPPER — nạp tủ `ShipperTab.jsx`
| ID | Tính năng | Vị trí |
|---|---|---|
| F-21 | Danh sách "Hàng Chờ Nạp" (API thật `/shipper/orders/pending`), lọc theo tủ | `:330-360`, `:1200` |
| F-22 | "+ Thêm đơn" cho khách chọn từ API `/shipper/customers` | `:373`, `:1229` |
| F-23 | KPI chờ nạp / đã nạp thành công | `:1092-1102` |
| F-24 | Lấy & hiện mã QR định danh shipper (mã vĩnh viễn, không đếm ngược) | `:1713-1740`, `/shipper/token/generate` |
| F-25 | Thanh tiến trình 5 bước + bước 6 (giữ ≥4 s sau khi nạp xong) | `:40-60`, `:1150-1180` |
| F-26 | Chọn tủ giao hàng + gợi ý tủ (`/shipper/suggest-lockers`) + "Chọn tủ này" | `:656-700`, `:1349` |
| F-27 | Đặt trước ngăn (chọn ngăn trống, 1h/2h, đặt trước, huỷ đặt trước) | `:733-800`, `:1535-1660` |
| F-28 | Poll cảm biến tủ 2 s trong lúc nạp (khối lượng/trạng thái) | `:948` |
| F-29 | Poll sự kiện Kiosk 1,5 s: quét QR, quét mã vận đơn, chọn ngăn, nạp xong | `:982-1070` |
| F-30 | Dòng lỗi đỏ khi tủ báo lỗi (mã vận đơn sai…) | `:1176-1190` |
| F-31 | Đơn `PENDING_OPENED` (cửa đã mở) vẫn hiện trong danh sách chờ nạp | `:876` |

### D. SHIPPER — thu hồi `ShipperRecallTab.jsx`
| ID | Tính năng | Vị trí |
|---|---|---|
| F-32 | Danh sách đơn quá hạn (`/shipper/overdue-orders`) | `:235` |
| F-33 | "+ Thêm đơn quá hạn" (công cụ demo, chọn tủ + khách) | `:689` |
| F-34 | Mã QR định danh shipper trong tab thu hồi | `:1065` |
| F-35 | Thanh 4 bước thu hồi | `:826` |
| F-36 | Nút "Mở ngăn" **chỉ hiện sau khi xác thực** (`/shipper/recall-overdue/open`) | `:948-974` |
| F-37 | "Đã Lấy Hàng & Đóng Cửa" (`/shipper/recall-overdue`) → giải phóng ngăn | `:911` |
| F-38 | Trạng thái rỗng "Không còn đơn quá hạn" | `:777` |

### E. SHIPPER — lộ trình `ShipperRouteMap.jsx`
| ID | Tính năng | Vị trí |
|---|---|---|
| F-39 | Tải lộ trình tự động khi mở tab | `:318` |
| F-40 | Thứ tự tủ cần giao (greedy) + khoảng cách thật (OSRM, có fallback) | `routingApi.js` |
| F-41 | Cảnh báo tủ mất kết nối theo heartbeat (<5 / 5-60 / >60 phút) | `utils/lockerHealth.js` |
| F-42 | Nút "Tải lại" (chống race, có spinner) | `:165-200` |
| F-43 | Chỉ đường / xem đường đi | `:954` |

### F. ADMIN — `AdminTab.jsx` (5 subtab)
| ID | Tính năng | Vị trí |
|---|---|---|
| F-44 | Tổng quan: KPI tủ/ngăn/đơn, tỷ lệ lấp đầy = OCCUPIED/tổng (RESERVED không tính) | `:546`, `store.calculateKpi` |
| F-45 | Tỷ lệ lấp đầy theo trạm | `:546` |
| F-46 | Sơ đồ ngăn: ma trận 10 tủ × 2 ngăn, làm mới | `:627` |
| F-47 | Mở khoá khẩn cấp 2 bước ngay tại ngăn (`/lockers/{id}/compartments/{n}/unlock`) | `:299`, `:764` |
| F-48 | Đơn quá hạn: danh sách + "Quét quá hạn" (`/admin/scan-overdue`); ADMIN chỉ đọc, không thu hồi | `:814-880` |
| F-49 | Người dùng: danh sách + cấp tài khoản (`/auth/admin/create-user`) | `:895` |
| F-50 | Lịch sử mở tủ (`/mqtt/command-logs`), tải lại | `:1031-1064` |

### G. ADMIN — bản đồ trạm `LockerNetworkMapTab.jsx`
| ID | Tính năng | Vị trí |
|---|---|---|
| F-51 | Bản đồ GIS 10 tủ, marker theo sức khoẻ trạm | `:626` |
| F-52 | Tìm kiếm trạm tủ, lọc trạng thái | `:954` |
| F-53 | Chi tiết trạm + danh sách ngăn + mở khoá khẩn cấp 2 bước | `:1057`, `:478` |
| F-54 | Bảo trì từng ngăn (lý do, chặn ngăn OCCUPIED) | `:1137` |
| F-55 | Bảo trì toàn tủ (công tắc + xác nhận 2 bước) | `:1195` |
| F-56 | Nhật ký bảo trì gần nhất (`/admin/maintenance-logs`) | `:1195`, `:1361` |
| F-57 | MAINTENANCE hiển thị khác "mất kết nối" | `lockerHealth.js` |

### H. Backend / tích hợp (đo qua API + qua UI ở trên)
| ID | Tính năng |
|---|---|
| F-58 | `POST /lockers/{id}/compartments/{n}/unlock` gửi OPEN_DOOR qua MQTT |
| F-59 | `POST /pickup/verify` (OTP/QR) + `POST /pickup/request-otp` chống dò mã |
| F-60 | `GET /pickup/kiosk-events`, `GET /shipper/kiosk-events` (poll sự kiện) |
| F-61 | `POST /orders/checkout` khoá bi quan chống overbooking |
| F-62 | `GET /orders/by-phone`, `GET /orders/{id}` (che thông tin theo quyền) |
| F-63 | `POST /shipper/deposit` chặn nạp khi tủ MAINTENANCE / heartbeat >5 phút (tủ thật) |
| F-64 | `ReservationTimeoutService` tự nhả ngăn đặt trước quá hạn |
| F-65 | `OverdueSchedulerService` quét đơn DEPOSITED quá hạn → OVERDUE |
| F-66 | 401/403 đúng vai trò trên toàn bộ endpoint |

## 2. MA TRẬN PHÉP THỬ (thứ tự chạy)

| Nhóm | Phép thử | Cách đo | Kỳ vọng |
|---|---|---|---|
| A | T-01 | Mở `http://localhost:5173`, đọc tiêu đề trang đăng nhập | Có ô đăng nhập + "Đăng nhập"/"Đăng ký khách" |
| A | T-02 | Đăng nhập sai mật khẩu | Báo lỗi, **không** vào app |
| A | T-03 | Đăng nhập `admin` | Vào tab `admin`, sidebar nhóm "QUẢN TRỊ HỆ THỐNG" |
| A | T-04 | Đăng nhập `shipper` | Vào tab `shipper`, sidebar "VẬN HÀNH GIAO NHẬN" |
| A | T-05 | Đăng nhập `khachhang` | Vào tab `customer`, sidebar "DỊCH VỤ KHÁCH HÀNG" |
| A | T-06 | CUSTOMER gọi thẳng API admin (`GET /api/admin/orders` bằng token khách) | **403** |
| A | T-07 | Đăng xuất rồi F5 | Về trang đăng nhập, localStorage sạch |
| B | T-08 | Khách: khối "Bưu kiện đang chờ bạn" hiện đúng số đơn | Khớp `GET /api/orders/by-phone` |
| B | T-09 | Khách: 5 bộ lọc lịch sử đơn, mỗi bộ lọc đổi danh sách đúng | Số dòng khớp dữ liệu |
| B | T-10 | Khách: gõ từ khoá tìm kiếm | Danh sách lọc đúng |
| B | T-11 | Khách: mở modal QR (không có đơn → thông báo đúng) | Không crash, có hướng dẫn |
| B | T-12 | Khách: mở modal OTP, bấm "Đổi mã mới" | Mã đổi, không lỗi console |
| B | T-13 | Khách: sơ đồ ngăn tủ hiện đúng số ngăn | 2 ngăn/tủ, nhãn trạng thái đúng |
| B | T-14 | Khách: chuông thông báo — badge, 3 bộ lọc, "Đã đọc" | Badge về 0 sau khi đọc |
| B | T-15 | Khách: bản đồ mạng lưới tủ — marker, tìm kiếm, lọc | Đủ 10 tủ, lọc đổi kết quả |
| C | T-16 | Shipper: danh sách chờ nạp khớp API | Số đơn = `orders/pending` |
| C | T-17 | Shipper: "+ Thêm đơn" tạo được đơn cho khách chọn | Đơn mới xuất hiện, API 200 |
| C | T-18 | Shipper: "Xem mã QR định danh" | Có mã, **không** đếm ngược |
| C | T-19 | Shipper: chọn đơn → chọn tủ gợi ý → "Chọn tủ này" | Danh sách gợi ý khác rỗng, chọn được |
| C | T-20 | Shipper: đặt trước ngăn (1h) → huỷ đặt trước | `compartments` chuyển RESERVED rồi về EMPTY |
| C | T-21 | Shipper: thanh 5 bước đổi trạng thái theo sự kiện Kiosk (giả lập qua MQTT `LOCKER_HN_02`) | Bước 2→3→4→5→6, giữ bước 6 ≥4 s |
| C | T-22 | Shipper: tủ báo mã vận đơn sai → dòng lỗi đỏ | Có dòng lỗi, không crash |
| D | T-23 | Shipper: danh sách đơn quá hạn khớp API | Số đơn = `overdue-orders` |
| D | T-24 | Shipper: "Mở ngăn" **ẩn** khi chưa xác thực | Không render nút |
| D | T-25 | Shipper: sau khi xác thực QR → nút "Mở ngăn" hiện | Nút xuất hiện |
| D | T-26 | Shipper: "Đã Lấy Hàng & Đóng Cửa" → ngăn về EMPTY, đơn COMPLETED | DB đúng, baseline +0 rác |
| D | T-27 | Shipper: trạng thái rỗng khi không có đơn quá hạn | Hiện "Không còn đơn quá hạn" |
| E | T-28 | Shipper: lộ trình tự tải, có thứ tự tủ + khoảng cách | Danh sách ≥1 tủ, km > 0 |
| E | T-29 | Shipper: "Tải lại" không nhân đôi request, không lỗi | 1 lượt tải |
| E | T-30 | Shipper: cảnh báo tủ mất kết nối theo heartbeat | Tủ >60 phút bị đánh dấu |
| F | T-31 | Admin: tổng quan KPI khớp DB | Lấp đầy = OCCUPIED/20 |
| F | T-32 | Admin: sơ đồ ngăn hiện 10 tủ × 2 ngăn | 20 ô, nhãn trạng thái đúng |
| F | T-33 | Admin: mở khoá khẩn cấp 2 bước — bước 1 chưa gửi lệnh | Chưa có command_log mới |
| F | T-34 | Admin: quá hạn — danh sách + "Quét quá hạn" | API 200, **không** có nút thu hồi |
| F | T-35 | Admin: người dùng — danh sách + cấp tài khoản (rollback sau đo) | Tạo được, xoá sau đo |
| F | T-36 | Admin: lịch sử mở tủ hiện log, "Tải lại" thêm dòng mới | Số dòng tăng |
| G | T-37 | Admin: bản đồ GIS 10 marker | 10 marker |
| G | T-38 | Admin: tìm kiếm trạm + lọc trạng thái | Lọc đúng |
| G | T-39 | Admin: chi tiết trạm → danh sách ngăn | 2 ngăn |
| G | T-40 | Admin: bảo trì ngăn (ngăn trống) → ngăn MAINTENANCE | DB đổi, **khôi phục ngay** |
| G | T-41 | Admin: bảo trì ngăn OCCUPIED bị chặn | Nút disable + tooltip |
| G | T-42 | Admin: bảo trì toàn tủ 2 bước + nhật ký | Có dòng nhật ký, khôi phục sau đo |
| G | T-43 | MAINTENANCE hiển thị khác mất kết nối | Nhãn/màu khác |
| H | T-44 | Mọi endpoint: 401 khi thiếu token, 403 khi sai vai trò | Đúng mã |
| H | T-45 | `POST /pickup/request-otp` sai số điện thoại | Không lộ mã, 400/404 |
| H | T-46 | `POST /shipper/deposit` vào tủ MAINTENANCE (tủ ảo) | Bị chặn (409) |
| H | T-47 | Baseline sau toàn bộ lượt đo | Không đổi (trừ dữ liệu test đã khôi phục) |

## 3. Cách chạy
1. `node scripts/devctl.mjs status` → nếu tắt: `node scripts/devctl.mjs up`.
2. `node scripts/evidence/test-plan/<nhom>.mjs` (mỗi nhóm 1 script, log ra `<nhom>.log`).
3. Ghi từng kết quả vào `STATE.md` **ngay khi có số đo**.
4. Cuối lượt: kiểm baseline + ghi bảng tổng hợp lỗi.

## 4. Mẫu ghi lỗi (bắt buộc)
```
LỖI-xx | phép thử T-yy | vai trò | bước tái hiện | hiện tại | mong đợi | bằng chứng (log/ảnh) | mức (CRITICAL/HIGH/MEDIUM/LOW)
```

## 5. Ghi chú phạm vi
- Không test phần cứng thật (ESP32, GM65, HX711) — chỉ giả lập qua MQTT trên tủ ảo `LOCKER_HN_02`.
- Không test load/performance, không test đa người dùng đồng thời.
- Không sửa lỗi trong lượt này: user yêu cầu **chỉ báo lỗi**.
