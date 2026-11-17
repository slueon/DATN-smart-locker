# HỆ THỐNG TỦ GIAO NHẬN HÀNG THÔNG MINH ỨNG DỤNG IoT (SMART LOCKER)

Đồ án tốt nghiệp ngành Kỹ thuật Điện tử – Viễn thông, Học viện Công nghệ Bưu chính Viễn thông (PTIT).

## 📌 Giới thiệu

Smart Locker giải quyết bài toán giao nhận chặng cuối (last-mile delivery) bằng mạng lưới tủ giao nhận tự động.
Hệ thống gồm ba phần nối với nhau:

- **Web** (React) cho ba vai trò: Khách hàng, Shipper, Quản trị viên.
- **Backend** (Spring Boot + MySQL) giữ toàn bộ nghiệp vụ và là nguồn sự thật duy nhất.
- **Tủ IoT** (ESP32 + màn hình TFT + đầu đọc GM65) nói chuyện với backend qua **MQTT over TLS (cổng 8883)**.

Mạng lưới mẫu có **10 trạm tủ**: tủ thật duy nhất `Tu_1` ánh xạ vào `LOCKER_HN_01`, 9 tủ còn lại là tủ ảo dùng để demo
(web hiển thị "Tủ demo — không có thiết bị"). Tủ được coi là trực tuyến khi có nhịp tim trong 5 phút gần nhất.

## 🔄 Luồng nghiệp vụ chính

**1. Tạo đơn và chọn tủ (Shipper).** Shipper tạo đơn và gắn cho một tài khoản khách hàng, chọn trạm tủ trên bản đồ
(gợi ý tủ gần, lộ trình giao theo đường đi thật qua OSRM) rồi có thể **giữ trước một ngăn trong 1 giờ hoặc 2 giờ**.
Hết hạn mà chưa nạp, ngăn tự được nhả.

**2. Nạp hàng tại tủ.** Shipper quét **mã QR định danh** của mình trên camera GM65 (mỗi shipper một mã cố định,
không hết hạn — rủi ro được ghi ở [docs/GIOI-HAN-BAOMAT.md](docs/GIOI-HAN-BAOMAT.md) mục 6), quét mã đơn, tủ mở đúng ngăn.
Khi cửa đóng và cảm biến xác nhận có hàng, đơn chuyển `DEPOSITED`, ngăn `OCCUPIED`. Mở cửa mà không bỏ hàng
thì ngăn được trả về trống và đơn quay lại chờ giao.

**3. Khách nhận hàng.** Khách mở tủ bằng **QR** hoặc **OTP 6 số (hiệu lực 5 phút)**, trên web hoặc trực tiếp tại màn hình tủ.
Mỗi lần nhập hợp lệ phát **đúng một lệnh mở**. Đơn chỉ chốt `COMPLETED` khi cửa đóng **và** ngăn rỗng
(cân ≤ 5 g, cảm biến hồng ngoại không thấy vật); còn hàng thì đơn trở lại `DEPOSITED` để khách mở lại.

**4. Quá hạn và thu hồi.** Hàng được lưu đến **hết 24h00 ngày hôm sau**. Quá hạn, đơn chuyển `OVERDUE` (tác vụ nền
mỗi 10 phút hoặc Admin bấm quét). Chỉ **shipper** được thu hồi: phải quét QR tại tủ thì nút **"Mở Cửa Ngăn"** mới hiện,
bấm nút thì tủ nhận lệnh mở thật, xác nhận "Đã lấy hàng & đóng cửa" thì đơn chốt và ngăn được giải phóng.

**5. Đồng bộ thời gian thực.** Web tự cập nhật sau khi nạp/nhận hàng (≤ 3 giây, không cần F5) nhờ sự kiện Kiosk
và nhịp hỏi 1,5 giây. Sơ đồ ngăn và cảm biến (cửa, cân, hồng ngoại) hiển thị giống nhau ở cả ba vai trò.

## 👥 Chức năng theo vai trò

| Vai trò | Chức năng |
|---|---|
| **Khách hàng** | Xem bưu kiện của tôi, mở tủ bằng QR/OTP, đổi mã mới, xem bản đồ mạng lưới tủ |
| **Shipper** | Tạo đơn cho khách, chọn tủ và giữ ngăn 1h/2h, lấy QR định danh, nạp hàng, thu hồi đơn quá hạn, lộ trình giao hàng |
| **Quản trị viên** | Dashboard KPI, ma trận ngăn và cảm biến theo thời gian thực, mở ngăn khẩn cấp, **bảo trì toàn tủ hoặc từng ngăn** (tủ bảo trì không nhận hàng), quét đơn quá hạn, lịch sử mở tủ (ai mở, lúc nào), cấp tài khoản |

## 🔐 Bảo mật

- Mật khẩu băm **BCrypt**; đăng nhập cấp phiên có hạn 8 giờ; mọi API phân quyền theo vai trò ở `SecurityConfig`.
- **Chống dò mã**: khoá mã nhận hàng sau 5 lần nhập sai.
- **Chống đặt trùng ngăn** bằng khoá bi quan (`SELECT … FOR UPDATE`) trên lịch biểu và ngăn tủ.
- MQTT qua **TLS 8883**, có Last Will; uplink (tủ → backend) dùng topic chung và mang `locker_id` trong payload,
  downlink (backend → tủ) dùng topic riêng `ptit/{id}/…` để lệnh chỉ tới đúng tủ.
- Các giới hạn còn lại (broker công cộng, QR shipper cố định…) được liệt kê thẳng thắn ở [docs/GIOI-HAN-BAOMAT.md](docs/GIOI-HAN-BAOMAT.md).

## 🛠️ Công nghệ

- **Frontend**: React 19, Vite 8, Tailwind CSS 4, Leaflet / React-Leaflet (OpenStreetMap, OSRM), Axios, Lucide, qrcode.react, oxlint.
- **Backend**: Java 21, Spring Boot 4.0.8 (Web MVC, Data JPA, Security, WebSocket), Hibernate, MySQL 8.0,
  Eclipse Paho MQTT 3.1.1, springdoc-openapi (Swagger UI), tác vụ nền `@Scheduled`, JUnit 5.
- **Phần cứng**: ESP32, màn hình TFT cảm ứng SPI (ILI9341/XPT2046), đầu đọc QR GM65 (UART), khoá Solenoid 12 V + relay,
  công tắc cửa MC-38, loadcell + HX711, cảm biến hồng ngoại, còi.

## 🚀 Cài đặt và chạy

**Yêu cầu:** JDK 21, Node.js 20+, MySQL 8.0 (cổng 3306).

### 1. Cơ sở dữ liệu
```bash
mysql -uroot -p < schema.sql   # tạo DB và bảng, an toàn, chạy lại được
mysql -uroot -p < seed.sql     # (tuỳ chọn) 10 trạm tủ + 3 tài khoản mẫu, chạy MỘT lần
```

### 2. Backend
Mật khẩu MySQL **không nằm trong repo**. Tạo `backend/smart-locker-backend/application-local.properties` (đã gitignore):
```properties
spring.datasource.password=<mật-khẩu-MySQL>
```
rồi chạy:
```bash
cd backend/smart-locker-backend
.\mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=local
```
Hoặc đặt biến môi trường `DB_PASSWORD` trước khi chạy. Quên bước này thì app báo `Access denied for user 'root'` — không phải lỗi code.

Các biến hay dùng (đều có mặc định): `DB_URL`, `DB_USERNAME`, `CORS_ALLOWED_ORIGINS`, `MQTT_BROKER_URL`
(mặc định `ssl://broker.emqx.io:8883`), `MQTT_TOPIC_BASE` (`ptit`), `MQTT_LOCKER_ID_MAP` (`Tu_1:LOCKER_HN_01`),
`MQTT_ENABLED`, `RESERVATION_TIMEOUT_MINUTES`.

- API: `http://localhost:8080` · Swagger UI: `http://localhost:8080/swagger-ui/index.html`
- Kiểm thử: `.\mvnw.cmd test` (dùng DB riêng `smart_locker_tester`, mật khẩu qua `TEST_DB_PASSWORD`).

### 3. Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```
File `frontend/.env`: `VITE_API_URL=http://localhost:8080/api`.

### 4. Bật/tắt nhanh cả dự án
```bash
node scripts/devctl.mjs status   # kiểm tra backend 8080 / vite 5173 bằng HTTP thật
node scripts/devctl.mjs up       # bật cả hai
node scripts/devctl.mjs down     # tắt cả hai
```

### 5. Thử MQTT không cần tủ thật
Nhập [mqttx-Tu_1-import.json](mqttx-Tu_1-import.json) vào MQTTX để theo dõi và phát bản tin như tủ `Tu_1`,
hoặc dùng `node scripts/mqtt-probe.mjs sub|pub|shipper|status …`. Bảng topic đầy đủ ở [MQTT_GUIDE.md](MQTT_GUIDE.md).

## 🔑 Tài khoản mẫu

| Vai trò | Tên đăng nhập | Mật khẩu |
|---|---|---|
| Khách hàng | `khachhang` | `123456` |
| Shipper | `shipper` | `shipper123` |
| Quản trị viên | `admin` | `admin123` |

## 📚 Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [MQTT_GUIDE.md](MQTT_GUIDE.md) | Topic, payload, luồng nghiệp vụ qua MQTT, cách thử bằng MQTTX |
| [docs/KIEN-TRUC.md](docs/KIEN-TRUC.md) | Kiến trúc hệ thống |
| [docs/SO-DO.md](docs/SO-DO.md) | Sơ đồ luồng và trạng thái |
| [docs/KICH-BAN-DEMO.md](docs/KICH-BAN-DEMO.md) | Kịch bản demo bảo vệ |
| [docs/GIOI-HAN-BAOMAT.md](docs/GIOI-HAN-BAOMAT.md) | Giới hạn và rủi ro bảo mật đã biết |
| [MAP.md](MAP.md) | Bản đồ mã nguồn (file nào làm gì) |

## 📄 Thực hiện

- **Đơn vị**: Khoa Viễn thông 1 – Học viện Công nghệ Bưu chính Viễn thông (PTIT).
- **Nhóm sinh viên**: Nhóm 64 (D22VTHI01).
- **Năm**: 2026.
