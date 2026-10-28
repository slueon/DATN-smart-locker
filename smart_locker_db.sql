-- =========================================================================
-- ĐỒ ÁN TỐT NGHIỆP: BẢN ĐỒ HỆ THỐNG TỦ GIAO NHẬN ĐỒ THÔNG MINH IoT
-- HỆ QUẢN TRỊ CSDL: MySQL 8.0
-- CÔNG CỤ THỰC THI: DataGrip 2025
-- =========================================================================

DROP DATABASE IF EXISTS smart_locker_db;
CREATE DATABASE smart_locker_db 
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE smart_locker_db;

-- 1. BẢNG TỦ GIAO NHẬN (LOCKERS)
CREATE TABLE lockers (
    locker_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255) NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    connection_status VARCHAR(20) DEFAULT 'ONLINE', -- ONLINE, OFFLINE, MAINTENANCE
    total_compartments INT NOT NULL DEFAULT 2,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. BẢNG NGĂN TỦ (COMPARTMENTS)
CREATE TABLE compartments (
    compartment_id INT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    comp_index INT NOT NULL,
    size VARCHAR(10) NOT NULL DEFAULT 'S', -- S (Ngăn nhỏ), L (Ngăn lớn)
    status VARCHAR(20) NOT NULL DEFAULT 'EMPTY', -- EMPTY, OCCUPIED, RESERVED, OUT_OF_SERVICE
    current_weight DOUBLE DEFAULT 0.0,
    is_door_closed BOOLEAN NOT NULL DEFAULT TRUE,
    relay_pin INT DEFAULT NULL,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE CASCADE,
    UNIQUE KEY uk_locker_comp (locker_id, comp_index)
) ENGINE=InnoDB;

-- 3. BẢNG LỊCH BIỂU SỨC CHỨA THEO NGÀY (LOCKER_SLOT_SCHEDULES)
CREATE TABLE locker_slot_schedules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    schedule_date DATE NOT NULL,
    total_slots INT NOT NULL DEFAULT 2,
    available_slots INT NOT NULL DEFAULT 2,
    version BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE CASCADE,
    UNIQUE KEY uk_locker_date (locker_id, schedule_date)
) ENGINE=InnoDB;

-- 4. BẢNG ĐƠN HÀNG GIAO NHẬN (ORDERS)
CREATE TABLE orders (
    order_id VARCHAR(50) PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    delivery_type VARCHAR(20) NOT NULL, -- 'LOCKER' hoặc 'STANDARD'
    locker_id VARCHAR(50) DEFAULT NULL,
    compartment_id INT DEFAULT NULL,
    expected_date DATE NOT NULL,
    deposited_at DATETIME DEFAULT NULL,
    expiry_deadline DATETIME DEFAULT NULL, -- Hạn chót: 24h00 của ngày hôm sau
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, DEPOSITED, COMPLETED, OVERDUE
    product_name VARCHAR(255) NOT NULL DEFAULT 'Bưu kiện Smart Locker',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    payment_method VARCHAR(30) DEFAULT 'ONLINE_VIETQR', -- ONLINE_VIETQR, ONLINE_MOMO, ONLINE_VNPAY, COD
    payment_status VARCHAR(20) DEFAULT 'PAID', -- PAID, UNPAID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE SET NULL,
    FOREIGN KEY (compartment_id) REFERENCES compartments(compartment_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. BẢNG MÃ NHẬN HÀNG CỦA KHÁCH (PICKUP_CREDENTIALS)
CREATE TABLE pickup_credentials (
    credential_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    qr_token VARCHAR(255) NOT NULL UNIQUE,
    otp_code VARCHAR(10) NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INT NOT NULL DEFAULT 0,
    expired_at DATETIME NOT NULL,
    used_at DATETIME DEFAULT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. BẢNG MÃ QR ĐỊNH DANH ĐỘNG CỦA SHIPPER (SHIPPER_IDENTITY_TOKENS)
CREATE TABLE shipper_identity_tokens (
    token_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipper_id VARCHAR(50) NOT NULL,
    dynamic_token VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expired_at DATETIME NOT NULL, -- 60 giây hiệu lực
    is_verified BOOLEAN NOT NULL DEFAULT FALSE
) ENGINE=InnoDB;

-- 9. BẢNG NHẬT KÝ LỆNH MỞ KHÓA MQTT (COMMAND_LOGS)
CREATE TABLE command_logs (
    command_id VARCHAR(50) PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    compartment_id INT NOT NULL,
    command_type VARCHAR(30) NOT NULL DEFAULT 'OPEN_DOOR',
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ack_received_at DATETIME DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'SENT', -- SENT, SUCCESS, TIMEOUT
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id)
) ENGINE=InnoDB;

-- 10. BẢNG SỰ KIỆN CẢM BIẾN THIẾT BỊ (DEVICE_EVENTS)
CREATE TABLE device_events (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    compartment_id INT DEFAULT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'DOOR_CLOSED', 'WEIGHT_CHANGED', 'QR_SCANNED'
    event_payload TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id)
) ENGINE=InnoDB;

-- 11. BẢNG TÀI KHOẢN NGƯỜI DÙNG & VAI TRÒ (USERS)
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL, -- 'ADMIN', 'SHIPPER', 'CUSTOMER'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =========================================================================
-- CHÈN DỮ LIỆU MẪU (SEED DATA CHO TỦ A VÀ E-COMMERCE)
-- =========================================================================

-- 1. Thêm mạng lưới 10 điểm tủ thông minh phân tán khu vực Tây Nam Hà Nội
INSERT INTO lockers (locker_id, name, address, latitude, longitude, connection_status, total_compartments) VALUES
('LOCKER_HN_01', 'Tủ Giao Nhận KTX A1 (Trụ Sở PTIT)', 'Sảnh Tầng 1, KTX A1, Học viện CNBCVT, Km10 Nguyễn Trãi, Q. Hà Đông', 20.9808, 105.7876, 'ONLINE', 2),
('LOCKER_HN_02', 'Tủ Giao Nhận Đại Học Hà Nội (HANU)', 'Cổng Chính ĐH Hà Nội, Km9 Đường Nguyễn Trãi, P. Trung Văn, Q. Nam Từ Liêm', 20.9892, 105.7958, 'ONLINE', 2),
('LOCKER_HN_03', 'Tủ Giao Nhận Vinhomes Royal City (Ngã Tư Sở)', 'Sảnh R1, KĐT Vinhomes Royal City, 72A Nguyễn Trãi, P. Thượng Đình, Q. Thanh Xuân', 21.0032, 105.8162, 'ONLINE', 2),
('LOCKER_HN_04', 'Tủ Giao Nhận Bến Xe Yên Nghĩa (Metro Hà Đông)', 'Sảnh Ga Yên Nghĩa (Tuyến Metro Cát Linh - Hà Đông), P. Yên Nghĩa, Q. Hà Đông', 20.9542, 105.7538, 'ONLINE', 2),
('LOCKER_HN_05', 'Tủ Giao Nhận Trung Hòa - Nhân Chính (Cầu Giấy)', 'Tòa Nhà 17T1 Hoàng Đạo Thúy, KĐT Trung Hòa Nhân Chính, Q. Cầu Giấy', 21.0088, 105.8035, 'ONLINE', 2),
('LOCKER_HN_06', 'Tủ Giao Nhận GO! Thăng Long (Trần Duy Hưng)', 'Đại Siêu Thị GO! Thăng Long, 222 Trần Duy Hưng, P. Trung Hòa, Q. Cầu Giấy', 21.0068, 105.7918, 'ONLINE', 2),
('LOCKER_HN_07', 'Tủ Giao Nhận Aeon Mall Hà Đông (Dương Nội)', 'Cổng 1, TTTM Aeon Mall Hà Đông, Khu Đô Thị Dương Nội, Q. Hà Đông', 20.9882, 105.7548, 'ONLINE', 2),
('LOCKER_HN_08', 'Tủ Giao Nhận KĐT Mỗ Lao (Mulberry Lane)', 'Khu Chung Cư TSQ Mulberry Lane, KĐT Mỗ Lao, Q. Hà Đông', 20.9858, 105.7822, 'ONLINE', 2),
('LOCKER_HN_09', 'Tủ Giao Nhận ĐH Khoa Học Tự Nhiên (VNU)', '334 Nguyễn Trãi, P. Thanh Xuân Trung, Q. Thanh Xuân, Hà Nội', 20.9968, 105.8078, 'ONLINE', 2),
('LOCKER_HN_10', 'Tủ Giao Nhận Trung Tâm Hành Chính Hà Đông', 'Phố Tô Hiệu, P. Hà Cầu, Q. Hà Đông (Gần Ga Metro La Khê)', 20.9678, 105.7738, 'ONLINE', 2);

-- 2. Thêm đúng 2 ngăn tủ (Ngăn 1: S - Nhỏ, Ngăn 2: L - Lớn) cho 10 trạm
INSERT INTO compartments (locker_id, comp_index, size, status, relay_pin) VALUES
-- Tủ A (KTX A1 - 2 ngăn)
('LOCKER_HN_01', 1, 'S', 'EMPTY', 18),
('LOCKER_HN_01', 2, 'L', 'EMPTY', 19),
-- Tủ B (HANU - 2 ngăn)
('LOCKER_HN_02', 1, 'S', 'EMPTY', 12),
('LOCKER_HN_02', 2, 'L', 'EMPTY', 14),
-- Tủ C (Royal City - 2 ngăn)
('LOCKER_HN_03', 1, 'S', 'EMPTY', 101),
('LOCKER_HN_03', 2, 'L', 'EMPTY', 102),
-- Tủ D (Bến Xe Yên Nghĩa - 2 ngăn)
('LOCKER_HN_04', 1, 'S', 'EMPTY', 105),
('LOCKER_HN_04', 2, 'L', 'EMPTY', 106),
-- Tủ E (Trung Hòa Nhân Chính - 2 ngăn)
('LOCKER_HN_05', 1, 'S', 'EMPTY', 109),
('LOCKER_HN_05', 2, 'L', 'EMPTY', 110),
-- Tủ F (GO! Thăng Long - 2 ngăn)
('LOCKER_HN_06', 1, 'S', 'EMPTY', 113),
('LOCKER_HN_06', 2, 'L', 'EMPTY', 114),
-- Tủ G (Aeon Mall Hà Đông - 2 ngăn)
('LOCKER_HN_07', 1, 'S', 'EMPTY', 117),
('LOCKER_HN_07', 2, 'L', 'EMPTY', 118),
-- Tủ H (KĐT Mỗ Lao - 2 ngăn)
('LOCKER_HN_08', 1, 'S', 'EMPTY', 121),
('LOCKER_HN_08', 2, 'L', 'EMPTY', 122),
-- Tủ I (ĐH Khoa Học Tự Nhiên - 2 ngăn)
('LOCKER_HN_09', 1, 'S', 'EMPTY', 125),
('LOCKER_HN_09', 2, 'L', 'EMPTY', 126),
-- Tủ K (TT Hành Chính Hà Đông - 2 ngăn)
('LOCKER_HN_10', 1, 'S', 'EMPTY', 129),
('LOCKER_HN_10', 2, 'L', 'EMPTY', 130);

-- 4. Khởi tạo lịch biểu sức chứa cho 3 ngày tới của Tủ A (2 ngăn mỗi ngày)
INSERT INTO locker_slot_schedules (locker_id, schedule_date, total_slots, available_slots) VALUES
('LOCKER_HN_01', CURRENT_DATE(), 2, 2),
('LOCKER_HN_01', DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY), 2, 2),
('LOCKER_HN_01', DATE_ADD(CURRENT_DATE(), INTERVAL 2 DAY), 2, 2),
('LOCKER_HN_02', CURRENT_DATE(), 2, 2),
('LOCKER_HN_02', DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY), 2, 2);

-- 6. Khởi tạo 3 tài khoản người dùng mẫu đại diện cho 3 vai trò
INSERT INTO users (username, password, full_name, phone, role) VALUES
('admin', 'admin123', 'Quản Trị Viên Hệ Thống', '0900000001', 'ADMIN'),
('shipper', 'shipper123', 'Nguyễn Văn Shipper PTIT', '0900000002', 'SHIPPER'),
('khachhang', '123456', 'Đoàn Viết Hoàng', '0988123456', 'CUSTOMER');
