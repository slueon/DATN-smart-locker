# BẢN ĐỒ HỆ THỐNG TỦ GIAO NHẬN ĐỒ THÔNG MINH ỨNG DỤNG IoT (SMART LOCKER)

Dự án Đồ án Tốt nghiệp ngành Kỹ thuật Điện tử - Viễn thông, Học viện Công nghệ Bưu chính Viễn thông (PTIT).

## 📌 Giới Thiệu Đề Tài
Hệ thống giải quyết bài toán giao nhận hàng hóa chặng cuối (Last-Mile Delivery) thông qua hệ thống Tủ giao nhận đồ thông minh ứng dụng IoT. Tích hợp giữa Web Thương mại điện tử (E-Commerce), Bản đồ số GIS (Leaflet) và Tủ phần cứng IoT điều khiển qua MQTT/HTTP.

### 🌟 Các Điểm Đổi Mới Nổi Bật:
1. **Khách hàng chủ động đặt trước tủ**: Chọn trạm tủ trên bản đồ Leaflet và chọn ngày nhận hàng mong muốn ngay tại trang thanh toán.
2. **Cơ chế Khóa Tranh Chấp Nguyên Tử (Atomic Pessimistic Locking)**: Ngăn chặn tuyệt đối tình trạng đặt trùng ngăn (Double-Booking / Overselling) trong CSDL MySQL bằng cơ chế `SELECT FOR UPDATE` trên cả Lịch biểu (`LockerSlotSchedule`) và Ngăn tủ (`Compartment`).
3. **Bảo mật Mật khẩu chuẩn Doanh nghiệp (BCrypt)**: Loại bỏ hoàn toàn plaintext password, mã hóa băm một chiều với BCrypt 10 rounds và cơ chế Transparent Auto-Migration tự động nâng cấp mật khẩu cũ.
4. **Cơ chế Chống Dò Mã (Anti-Brute-Force Lockout)**: Tạm khóa mã nhận hàng sau 5 lần nhập sai liên tiếp, đồng thời tích hợp lá chắn trạm tủ chống quét từ điển tự động.
5. **Chính sách lưu kho hết 24h00 ngày hôm sau**: Hàng sau khi shipper nạp vào tủ sẽ được lưu trữ đến hết 24h00 của ngày tiếp theo, tích hợp đồng hồ đếm ngược chuyển màu và cảnh báo tự động.
6. **Quy trình 2 bước bảo mật tại tủ (TFT & GM65)**:
   - Bước 1: Shipper quét **Mã QR Định Danh Động 60 giây** qua camera GM65 để xác thực danh tính.
   - Bước 2: Quét mã vận đơn đơn hàng ➔ Tủ tự động bật mở khóa Solenoid đúng ngăn.
7. **Xác thực cảm biến kép (Dual-Sensor)**: Cảm biến từ cửa MC-38 xác nhận đóng kín + Cảm biến cân tải trọng Load cell HX711 xác nhận có kiện hàng trong ngăn.
8. **Nhận hàng bằng mã OTP & QR động**: Khách hàng có thể quét mã QR động hoặc yêu cầu tạo mã OTP 6 số (hiệu lực 5 phút), ràng buộc chống IDOR theo số điện thoại người nhận.
9. **Phân hệ Quản trị (Admin Portal)**: Dashboard KPI tỷ lệ lấp đầy, giám sát nhịp tim kết nối Heartbeat ESP32, sơ đồ ma trận các ngăn tủ thời gian thực, mở khóa khẩn cấp từ xa và điều phối đơn quá hạn.

---

## 🛠️ Công Nghệ Sử Dụng (Tech Stack)

### 1. Frontend
- **Framework**: React 19, Vite 8, Tailwind CSS v4
- **Bản đồ**: Leaflet.js, OpenStreetMap
- **Thư viện UI/Icon**: Lucide React, QRCode.react, Axios
- **Cấu hình môi trường**: File `.env` (`VITE_API_URL=http://localhost:8080/api`)
- **Quản lý phiên & vai trò**: Phân quyền 3 vai trò (Khách hàng, Shipper, Quản trị viên)

### 2. Backend
- **Ngôn ngữ & Runtime**: Java 17 (Maven compiler target release 17, tương thích JDK 17 - 21)
- **Framework**: Spring Boot 3.4.x / 4.x, Spring Data JPA, Spring Security Crypto
- **Bảo mật**: BCrypt PasswordEncoder, Whitelist CORS Security, Anti-Brute-Force Tracker
- **ORM / Database**: Hibernate, MySQL 8.0 (InnoDB Atomic Insert & Pessimistic Locking)
- **Giao thức**: RESTful API, MQTT Broker, WebSocket SockJS / STOMP
- **Tác vụ nền**: `@EnableScheduling` Cron Job quét đơn quá hạn tự động
- **Kiểm thử tự động**: JUnit 5, Spring Boot Test Integration Test Suite (100% Pass)

### 3. Phần Cứng Nhúng IoT
- **Vi điều khiển**: ESP32 NodeMCU
- **Màn hình**: TFT SPI Touch LCD (IL9341/XPT2046)
- **Đầu đọc mã**: Barcode/QR Reader Module GM65 (UART)
- **Cơ cấu chấp hành**: Khóa chốt điện Solenoid 12V, Relay Module
- **Cảm biến**: Cảm biến cửa từ MC-38, Cảm biến tải trọng Load cell + Module HX711, Còi Buzzer cảnh báo

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

### 1. Cơ Sở Dữ Liệu (MySQL)
1. Cài đặt MySQL 8.0 (Port 3306).
2. Tạo database:
   ```sql
   CREATE DATABASE smart_locker_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```
3. Import file cấu trúc và dữ liệu mẫu `smart_locker_db.sql` vào database.

### 2. Khởi Chạy Backend (Spring Boot)
1. Mở thư mục `backend/smart-locker-backend` bằng **IntelliJ IDEA** hoặc Terminal.
2. Cấu hình biến môi trường trong `src/main/resources/application.properties` (hoặc truyền qua Environment Variables của hệ điều hành):
   ```properties
   spring.datasource.url=${DB_URL:jdbc:mysql://localhost:3306/smart_locker_db?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Ho_Chi_Minh&characterEncoding=UTF-8}
   spring.datasource.username=${DB_USERNAME:root}
   spring.datasource.password=${DB_PASSWORD:200220}
   app.cors.allowed-origins=${CORS_ALLOWED_ORIGINS:http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000}
   ```
3. Chạy kiểm thử tự động (Integration Tests):
   ```bash
   .\mvnw.cmd test
   ```
4. Khởi chạy ứng dụng:
   ```bash
   .\mvnw.cmd spring-boot:run
   ```
   *(Server lắng nghe tại `http://localhost:8080`)*.

### 3. Khởi Chạy Frontend (React + Vite)
1. Mở thư mục `frontend` bằng Terminal.
2. Kiểm tra file cấu hình `.env`:
   ```properties
   VITE_API_URL=http://localhost:8080/api
   ```
3. Cài đặt các gói phụ thuộc (nếu chạy lần đầu):
   ```bash
   npm install
   ```
4. Khởi chạy máy chủ phát triển:
   ```bash
   npm run dev
   ```
5. Truy cập giao diện web tại: **`http://localhost:5173`**.

---

## 👥 Tài Khoản Mẫu Đăng Nhập Nhanh

*(Tất cả mật khẩu đã được mã hóa băm BCrypt an toàn trong CSDL)*

| Vai trò | Tên đăng nhập | Mật khẩu mẫu | Chức năng chính |
|---|---|---|---|
| **Khách Hàng** | `khachhang` | `123456` | Sàn mua sắm, chọn trạm tủ trên bản đồ Leaflet, giỏ hàng & thanh toán, nhận hàng bằng QR / OTP (hiệu lực 5 phút) |
| **Shipper** | `shipper` | `shipper123` | Thống kê ca giao, xác minh danh tính QR 60s, quét đơn nạp tủ với cảm biến kép, thu hồi đơn quá hạn |
| **Quản Trị Viên** | `admin` | `admin123` | Dashboard KPI lấp đầy, ma trận ngăn tủ, mở ngăn khẩn cấp từ xa, quét đơn quá hạn, cấp tài khoản |

---

## 📄 Bản Quyền & Thực Hiện
- **Đơn vị**: Khoa Viễn thông 1 - Học viện Công nghệ Bưu chính Viễn thông (PTIT).
- **Nhóm sinh viên thực hiện**: Nhóm 64 (D22VTHI01).
- **Năm thực hiện**: 2026.
