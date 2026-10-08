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
    total_compartments INT NOT NULL DEFAULT 3,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. BẢNG NGĂN TỦ (COMPARTMENTS)
CREATE TABLE compartments (
    compartment_id INT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    comp_index INT NOT NULL,
    size VARCHAR(10) NOT NULL DEFAULT 'M', -- S, M, L
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
    total_slots INT NOT NULL DEFAULT 3,
    available_slots INT NOT NULL DEFAULT 3,
    version BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE CASCADE,
    UNIQUE KEY uk_locker_date (locker_id, schedule_date)
) ENGINE=InnoDB;

-- 4. BẢNG SẢN PHẨM E-COMMERCE (PRODUCTS)
CREATE TABLE products (
    product_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    image_url VARCHAR(255) DEFAULT NULL,
    description TEXT,
    required_size VARCHAR(10) NOT NULL DEFAULT 'S',
    weight_kg DOUBLE NOT NULL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 5. BẢNG ĐƠN HÀNG (ORDERS)
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
    total_amount DECIMAL(12,2) NOT NULL,
    payment_method VARCHAR(30) DEFAULT 'ONLINE_VIETQR', -- ONLINE_VIETQR, ONLINE_MOMO, ONLINE_VNPAY, COD
    payment_status VARCHAR(20) DEFAULT 'PAID', -- PAID, UNPAID
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE SET NULL,
    FOREIGN KEY (compartment_id) REFERENCES compartments(compartment_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 6. BẢNG CHI TIẾT ĐƠN HÀNG (ORDER_ITEMS)
CREATE TABLE order_items (
    item_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;

-- 7. BẢNG MÃ NHẬN HÀNG CỦA KHÁCH (PICKUP_CREDENTIALS)
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

-- 1. Thêm Tủ A vật lý và Tủ B mô phỏng
INSERT INTO lockers (locker_id, name, address, latitude, longitude, connection_status, total_compartments) VALUES
('LOCKER_HN_01', 'Tủ Giao Nhận KTX A1', 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội', 20.980645, 105.787920, 'ONLINE', 3),
('LOCKER_HN_02', 'Tủ Giao Nhận Thư Viện', 'Sảnh tầng 1, Nhà Thư Viện, Học viện CNBCVT, Hà Đông, Hà Nội', 20.980910, 105.787450, 'ONLINE', 3);

-- 2. Thêm các ngăn của Tủ A (3 ngăn)
INSERT INTO compartments (locker_id, comp_index, size, status, relay_pin) VALUES
('LOCKER_HN_01', 1, 'S', 'EMPTY', 18),
('LOCKER_HN_01', 2, 'M', 'EMPTY', 19),
('LOCKER_HN_01', 3, 'L', 'EMPTY', 21);

-- 3. Thêm các ngăn của Tủ B mô phỏng (3 ngăn)
INSERT INTO compartments (locker_id, comp_index, size, status, relay_pin) VALUES
('LOCKER_HN_02', 1, 'S', 'EMPTY', 12),
('LOCKER_HN_02', 2, 'M', 'EMPTY', 14),
('LOCKER_HN_02', 3, 'L', 'EMPTY', 27);

-- 4. Thêm sản phẩm mẫu trên sàn E-Commerce
INSERT INTO products (name, price, image_url, description, required_size, weight_kg) VALUES
('Tai nghe Bluetooth True Wireless Pro', 450000.00, 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=80', 'Âm thanh chất lượng cao, pin 24h, khử ồn chủ động ANC', 'S', 0.2),
('Áo Hoodie PTIT Sinh Viên 2026', 280000.00, 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&auto=format&fit=crop&q=80', 'Chất nỉ bông ấm áp, form rộng unisex PTIT', 'M', 0.6),
('Balo Laptop Công Nghệ Chống Nước', 520000.00, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=600&auto=format&fit=crop&q=80', 'Ngăn chống sốc 15.6 inch, cổng sạc USB tích hợp', 'L', 1.1),
('Sách Lập Trình IoT với ESP32', 150000.00, 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80', 'Tài liệu hướng dẫn thực hành vi điều khiển & IoT', 'S', 0.4);

-- 5. Khởi tạo lịch biểu sức chứa cho 3 ngày tới của Tủ A
INSERT INTO locker_slot_schedules (locker_id, schedule_date, total_slots, available_slots) VALUES
('LOCKER_HN_01', CURRENT_DATE(), 3, 3),
('LOCKER_HN_01', DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY), 3, 3),
('LOCKER_HN_01', DATE_ADD(CURRENT_DATE(), INTERVAL 2 DAY), 3, 3),
('LOCKER_HN_02', CURRENT_DATE(), 3, 3),
('LOCKER_HN_02', DATE_ADD(CURRENT_DATE(), INTERVAL 1 DAY), 3, 3);

-- 6. Khởi tạo 3 tài khoản người dùng mẫu đại diện cho 3 vai trò
INSERT INTO users (username, password, full_name, phone, role) VALUES
('admin', 'admin123', 'Quản Trị Viên Hệ Thống', '0900000001', 'ADMIN'),
('shipper', 'shipper123', 'Nguyễn Văn Shipper PTIT', '0900000002', 'SHIPPER'),
('khachhang', '123456', 'Đoàn Viết Hoàng', '0988123456', 'CUSTOMER');
