# TEAM BRIEF — Smart Locker (DATN PTIT)
> Bản tóm tắt nhập môn cho nhóm Lập trình (Kiến · Code · Soát · Vận). Viết ngày 2026-11-13 bởi Kiến.
> Đọc file này TRƯỚC, sau đó dùng `MAP.md` để tra vị trí file. Không quét toàn repo.
> `MAP.md` cập nhật lần cuối 2026-11-10 — mục 6 dưới đây liệt kê những gì MAP.md còn thiếu.

---

## 1. Dự án là gì (1 phút)

Đồ án tốt nghiệp PTIT: **mạng lưới tủ giao nhận hàng thông minh (IoT)** ở Hà Nội.
- **Shipper** chọn tủ, đặt trước ngăn, quét QR để mở tủ và nạp hàng.
- **Khách** chỉ **nhận hàng** (không mua, không checkout): mở tủ bằng OTP hoặc QR.
- **Admin** giám sát: KPI, bản đồ GIS sức khoẻ trạm, lịch sử mở tủ, bảo trì tủ/ngăn, thu hồi đơn quá hạn.
- **Phần cứng thật chỉ có 1 tủ**: thiết bị ESP32 `Tu_1` → `LOCKER_HN_01` (KTX A1, PTIT). 9 tủ còn lại là **tủ ảo** (`lockers.is_virtual = 1`), luôn hiện "có kết nối".

> Hướng sản phẩm do người dùng chốt ở GĐ11: **web giao hàng, KHÔNG phải web thương mại điện tử**. Đừng thêm giỏ hàng, sản phẩm, thanh toán.

## 2. Kiến trúc

```
ESP32 (Tu_1) ──MQTT/TLS 8883──► broker.emqx.io ◄──Paho── Spring Boot :8080 ──JPA──► MySQL 8
                                                              ▲  REST /api/**  (token opaque, 3 vai trò)
                                                              │
                                     React 19 + Vite :5173 ───┘   + OSRM (lộ trình) + Leaflet (bản đồ)
```

| Tầng | Vị trí | Ghi chú |
|---|---|---|
| Backend | `backend/smart-locker-backend` | Java 21, Spring Boot 4.0.8, 7 controller / 33 endpoint, 8 service, 11 entity |
| Frontend | `frontend/src` | 15 component, `services/api.js` chứa MỌI lời gọi REST, `services/routingApi.js` gọi OSRM |
| CSDL | `schema.sql` (DDL, chạy lại an toàn) + `seed.sql` | DB thật `smart_locker_db`, DB test `smart_locker_tester` |
| MQTT | `service/MqttService.java` (1249 dòng, file khó nhất) | Hợp đồng topic: `MQTT_GUIDE.md` |
| Hạ tầng | `docker/emqx/acl.conf`, `test-all.bat`, `scripts/mqtt-probe.mjs` | **Chưa có Dockerfile / compose / CI** |

**Nhóm endpoint:** `/api/auth` · `/api/lockers` (danh sách, ngăn, capacity, unlock, bảo trì) · `/api/orders` · `/api/pickup` (OTP/QR khách) · `/api/shipper` (QR token, deposit, pending, suggest-lockers, assign-locker, reserve, overdue, recall) · `/api/admin` (orders, maintenance-logs) · `/api/mqtt` (logs, command, command-logs, security-status, retained-state).

**Vòng đời đơn (đã đối chiếu code, 13/11):**
- Đơn: `PENDING` → `DEPOSITED` → `COMPLETED`. Quá hạn: `DEPOSITED` → `OVERDUE` → thu hồi đặt lại **`COMPLETED`** (không có trạng thái `RECALLED`). `PENDING` quá `expectedDate` → `CANCELLED` (lazy, chỉ khi có người đọc ngăn — `LockerService.java:80`).
- `RESERVED`/`OCCUPIED`/`EMPTY`/`OUT_OF_SERVICE` là trạng thái **ngăn**, không phải trạng thái đơn.
- Trạng thái đơn là **chuỗi literal rải ở ~25 chỗ, không có enum**; comment `Order.java:113` thiếu `CANCELLED`.
- **Hai nguồn cùng ghi trạng thái**: `DEPOSITED` ghi ở `ShipperService` (REST) và `MqttService` (`deposit_success`); `COMPLETED` ghi ở `PickupService` và `MqttService` (`pickup_success`). Không có optimistic lock.
- Web khách **chỉ xin OTP** (`CustomerPickupTab` gọi `requestOtp`); `pickupApi.verifyPickup` (`api.js:168`) không component nào gọi. Đơn `COMPLETED` đến từ kiosk/thiết bị.
Scheduler: `OverdueSchedulerService` (10 phút/lần), `ReservationTimeoutService` (nhả ngăn đặt trước, 5 phút/lần, hạn 120 phút).

**7 quyết định thiết kế kèm đánh đổi:** `docs/KIEN-TRUC.md` (token opaque thay JWT, uplink không có id / downlink có id, khoá bi quan khi reserve, tách transaction theo đơn, DB test riêng...). Đọc trước khi đề xuất đổi kiến trúc.

## 3. Lệnh chuẩn (từ gốc repo, PowerShell)

```powershell
# Backend test — CHỈ MỘT tiến trình mvnw tại một thời điểm, kiểm java = 0 trước
(Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -match 'smart-locker' } | Measure-Object).Count
cd backend\smart-locker-backend; .\mvnw.cmd -o clean test      # baseline: 39/39 PASS
.\mvnw.cmd spring-boot:run                                      # :8080, Swagger /swagger-ui/index.html

cd frontend; npm.cmd run build     # baseline: exit 0
npm.cmd run lint                   # baseline: 0 error / ~105 warning
npm.cmd run dev                    # :5173

node scripts\mqtt-probe.mjs status --locker=Tu_1   # giả lập thiết bị gửi bản tin (TLS 8883)
```
Tài khoản mẫu: `admin/admin123` · `shipper/shipper123` · `khachhang/123456`.

## 4. Bẫy đã gây lỗi thật (đọc kỹ)

1. **Trọng lượng**: MQTT và DB dùng **gram**; `LockerCabinetVisualizer` hiểu **kg** → chia 1000 tại chỗ truyền vào.
2. **Online/offline**: không tin cột `connectionStatus`. Tủ thật suy từ `lastHeartbeat` (<5 phút xanh, 5–60 vàng, >60 đỏ); tủ ảo luôn online.
3. **Không chạy 2 `mvnw` song song** (tranh `target/` và DB test `create-drop`). Luôn `clean test`.
4. **PowerShell 5.1 làm hỏng tiếng Việt.** Không đọc/ghi file tiếng Việt bằng `Get-Content`, `Out-File`, `Set-Content`, `>`. Dùng công cụ Edit/Write hoặc `node`. Sau khi ghi, kiểm mojibake bằng `node` (lệnh trong `MAP.md`). `STATE.md` đã từng bị hỏng như vậy và **không nằm trong git** → hỏng là mất.
5. **Topic MQTT**: uplink dùng topic chung (id nằm trong payload), downlink có `{id}` thiết bị. Paho 1.2.5 **không hiểu `mqtts://`**, phải dùng `ssl://`.
6. **Grep toàn repo** khi đổi tên/id (gồm `scripts/`, `.mjs`, `.json`, `docs/`) — đã sót 3 lần.
7. **`LockerMap.jsx` dùng chung với luồng khách** — không sửa khi làm tính năng shipper/admin.
8. **Không đổi dữ liệu thật cho đẹp**: `command_logs.ack_received_at` luôn NULL vì firmware không gửi ACK — giữ nguyên.
9. **Cờ khẩn cấp** `SECURITY_ENABLED=false` tắt toàn bộ xác thực; chỉ dùng khi demo hỏng.

## 5. Giới hạn đã biết (không phải lỗi, phải nói rõ khi bảo vệ)

- **QR shipper vĩnh viễn** (GĐ15, người dùng chấp nhận): mất lớp chống replay; chỉ còn kiểm `isVerified`.
- Khoá vật lý khi bảo trì phụ thuộc firmware; repo **không có mã firmware**.
- Bảng `orders` không lưu shipper nào giao.
- Broker công cộng `broker.emqx.io`, không xác thực (đã có TLS từ GĐ16).
- `docker/emqx/acl.conf` dùng prefix `ptit/smartlocker/#`, không khớp base thật `ptit`.
- Secret còn nằm trong file trong git: mật khẩu MySQL ở `MAP.md` và `src/test/resources/application.properties`; giá trị mặc định `mqtt.security.secret-token` ở `application.properties`.
- Đồ án chưa có Dockerfile, docker-compose hay CI; máy chưa cài Docker. Frontend **đã có** `.env.example` (`VITE_API_URL`); backend chưa có file cấu hình mẫu.
- `test-all.bat` chỉ chạy `npm test` của frontend, **không** chạy test backend.
- `schema.sql` chỉ tạo `smart_locker_db`; DB test `smart_locker_tester` phải tạo tay, và mật khẩu DB test đang gán sẵn trong file test.

## 6. Thay đổi từ GĐ11 đến GĐ16 mà MAP.md chưa ghi

| GĐ | Thay đổi | Commit |
|---|---|---|
| 11 | Khách chỉ nhận hàng; shipper `suggest-lockers` + `assign-locker`; đơn tạo không cần `lockerId` | `10009ce` |
| 12 | Cột `lockers.is_virtual`: 1 tủ thật, 9 tủ ảo | `fdb435e` |
| 13 | Nối `store.js` (localStorage) vào API thật; ADMIN được gọi `recall-overdue` | `a74d138` |
| 14 | Lộ trình shipper theo đường thật qua OSRM (`routingApi.js`), lùi về Haversine khi lỗi | `44097e3` |
| 15 | QR shipper không hết hạn | `eadbdb5` |
| 16 | Backend nối MQTT **TLS `ssl://broker.emqx.io:8883`**; id thiết bị đổi `khuon_vien` → **`Tu_1`** | `eadbdb5` |

Khác: thêm `AdminController`, entity `MaintenanceLog` + `MaintenanceLogRepository`, DTO `CommandLogDTO`/`MaintenanceLogDTO`, `utils/lockerHealth.js`, `utils/commandLogActor.js`, `services/testEngine.js`.
Số liệu MAP.md đã cũ: 26 endpoint (thật 33), 10 entity (thật 11), số dòng 8 service, `store.js` (thật 795 dòng), `ShipperRouteMap.jsx` (thật 774 dòng), broker 1883 (thật TLS 8883).

## 7. Git & quy trình

- Nhánh `main`, **đi trước `origin/main` 11 commit, chưa push** — chờ người dùng quyết. Không push, không force-push.
- Nhật ký tiến độ chi tiết: `STATE.md` (2400+ dòng, append theo GĐ, **gitignore**). Phần đáng đọc: cuối file (`TỒN ĐỌNG ĐÃ BIẾT`, `DỮ LIỆU CHUẨN`, `BÀI HỌC`).
- Bằng chứng kiểm thử lưu ở `scripts/evidence/` (gitignore).
- Luồng làm việc: Kiến thiết kế → Code triển khai → Soát review/test (tối đa 3 vòng) → Vận hạ tầng → báo cáo. Không tuyên bố xong khi chưa có output build/test thật.
