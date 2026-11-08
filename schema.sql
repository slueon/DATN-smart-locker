-- =========================================================================
-- SMART LOCKER - CẤU TRÚC CSDL (SCHEMA ONLY, KHÔNG XOÁ DỮ LIỆU)
-- MySQL 8.0 | utf8mb4 | utf8mb4_unicode_ci
--
-- AN TOÀN: KHÔNG xoá database, KHÔNG xoá dữ liệu.
--   CREATE DATABASE IF NOT EXISTS + CREATE TABLE IF NOT EXISTS
-- Chạy lại nhiều lần không làm mất đơn hàng / tài khoản / lịch sử.
-- =========================================================================

CREATE DATABASE IF NOT EXISTS smart_locker_db
CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE smart_locker_db;
CREATE TABLE IF NOT EXISTS lockers (
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
CREATE TABLE IF NOT EXISTS compartments (
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
CREATE TABLE IF NOT EXISTS locker_slot_schedules (
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
CREATE TABLE IF NOT EXISTS orders (
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
    -- T3: mã vận đơn in trên nhãn kiện hàng. Mặc định lấy order_id (user chốt Q1 = (c)),
    -- shipper được sửa khi nhãn in mã khác. UNIQUE để quét nhãn không mở nhầm đơn.
    -- NULL được phép: đơn cũ chưa backfill, và code coi NULL như order_id.
    tracking_code VARCHAR(50) DEFAULT NULL,
    UNIQUE KEY uk_orders_tracking (tracking_code),
    -- T3 (Q4): thời điểm SHIPPER chủ động đặt trước/đổi ngăn trên web.
    -- NULL = ngăn do hệ thống gán lúc checkout (shipper CHƯA đặt trước).
    -- NOT NULL = shipper đã chủ động chọn ngăn → quét nhãn mới trả verified/order = 1.
    -- Không backfill: đơn cũ để NULL đúng nghĩa "chưa đặt trước".
    shipper_reserved_at DATETIME DEFAULT NULL,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE SET NULL,
    FOREIGN KEY (compartment_id) REFERENCES compartments(compartment_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. BẢNG MÃ NHẬN HÀNG CỦA KHÁCH (PICKUP_CREDENTIALS)
CREATE TABLE IF NOT EXISTS pickup_credentials (
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
CREATE TABLE IF NOT EXISTS shipper_identity_tokens (
    token_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipper_id VARCHAR(50) NOT NULL,
    dynamic_token VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expired_at DATETIME NOT NULL, -- 60 giây hiệu lực
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    -- W4/W6: tủ mà shipper đã quét mã để xác thực (gán lúc verifyDynamicToken).
    -- NULL = mã chưa quét ở tủ nào. Bắt buộc có để chặn lỗi cross-locker:
    -- shipper xác thực ở tủ A thì token chỉ có giá trị tại đúng tủ A, không mở được tủ B.
    locker_id VARCHAR(50) DEFAULT NULL,
    -- Truy vấn quyết định mở cửa tủ:
    --   select ... where is_verified = true and expired_at > :now and locker_id = :lockerId
    KEY idx_shipper_tokens_locker_verified (locker_id, is_verified, expired_at),
    CONSTRAINT fk_shipper_tokens_locker FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. BẢNG NHẬT KÝ LỆNH MỞ KHÓA MQTT (COMMAND_LOGS)
CREATE TABLE IF NOT EXISTS command_logs (
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
CREATE TABLE IF NOT EXISTS device_events (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    compartment_id INT DEFAULT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'DOOR_CLOSED', 'WEIGHT_CHANGED', 'QR_SCANNED'
    event_payload TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id)
) ENGINE=InnoDB;

-- 11. BẢNG TÀI KHOẢN NGƯỜI DÙNG & VAI TRÒ (USERS)
CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL, -- 'ADMIN', 'SHIPPER', 'CUSTOMER'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 12. BẢNG PHIÊN ĐĂNG NHẬP BẰNG TOKEN OPAQUE (AUTH_SESSIONS)
-- W2: token Bearer cấp khi /api/auth/login, tra ở mỗi request bởi TokenAuthFilter.
-- Không dùng JWT — token là 32 byte ngẫu nhiên (SecureRandom) mã hoá Base64URL,
-- lưu NGUYÊN chuỗi vào cột token. TTL 8 giờ (AuthService.SESSION_TTL_HOURS).
-- Cột khớp đúng com.ptit.smartlocker.entity.AuthSession.
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    user_id BIGINT NOT NULL,
    role VARCHAR(20) NOT NULL, -- bản sao vai trò tại thời điểm cấp token: 'ADMIN' / 'SHIPPER' / 'CUSTOMER'
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NOT NULL, -- createdAt + 8 giờ; expires_at <= NOW() là token chết
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE KEY idx_auth_sessions_token (token),
    KEY idx_auth_sessions_expires_at (expires_at),
    KEY idx_auth_sessions_user_id (user_id),
    CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

