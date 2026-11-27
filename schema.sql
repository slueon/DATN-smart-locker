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
    -- GĐ12: TRUE = tủ khai báo trong CSDL, KHÔNG có thiết bị thật (không bao giờ gửi nhịp tim).
    -- Phần cứng thật chỉ có 1 tủ: thiết bị `Tu_1` → LOCKER_HN_01 (is_virtual = FALSE).
    -- Cột nhịp tim PHẢI phản ánh sự thật, nên KHÔNG bịa last_heartbeat cho tủ ảo để làm nó "xanh";
    -- trạng thái "có kết nối" của tủ ảo đến từ chính cờ này và luôn hiện kèm nhãn "(tủ ảo)".
    is_virtual BOOLEAN NOT NULL DEFAULT FALSE,
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
    -- GĐ22: cảm biến HỒNG NGOẠI báo có vật cản (payload `ir_detected`).
    -- NULL = CHƯA TỪNG nhận thông tin IR (firmware cũ / 20 ngăn có sẵn trước GĐ22).
    -- CỐ Ý NULL-able: NOT NULL sẽ làm ddl-auto không thêm được cột trên DB đang có dữ liệu.
    -- Hiện chỉ LƯU để truy vết, chưa dùng để quyết định `status`.
    ir_detected BOOLEAN DEFAULT NULL,
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
    -- GĐ21: hạn giữ chỗ của RIÊNG lần đặt trước này (shipper chọn 1 giờ hoặc 2 giờ).
    -- NULL = đơn cũ (trước GĐ21) → ReservationTimeoutService rơi về shipper_reserved_at + 120 phút.
    -- CỐ Ý cho phép NULL: thêm NOT NULL sẽ làm app không khởi động được trên DB đang có đơn.
    reserve_expires_at DATETIME DEFAULT NULL,
    -- Shipper nhận đơn trên web; NULL = chưa có shipper nhận đơn.
    assigned_shipper_id BIGINT DEFAULT NULL,
    INDEX idx_orders_assigned_shipper_status (assigned_shipper_id, status),
    FOREIGN KEY (locker_id) REFERENCES lockers(locker_id) ON DELETE SET NULL,
    FOREIGN KEY (compartment_id) REFERENCES compartments(compartment_id) ON DELETE SET NULL
) ENGINE=InnoDB;
-- Hibernate ánh xạ assigned_shipper_id tới users.id; bảng users được khai báo ở phần sau.

-- 5. BẢNG MÃ NHẬN HÀNG CỦA KHÁCH (PICKUP_CREDENTIALS)
CREATE TABLE IF NOT EXISTS pickup_credentials (
    credential_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    qr_token VARCHAR(255) NOT NULL UNIQUE,
    otp_code VARCHAR(10) NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INT NOT NULL DEFAULT 0,
    -- GĐ69: hạn của MÃ NHẬN HÀNG (QR + OTP) = hạn lưu kho của đơn.
    -- KHÔNG còn bị request-otp ghi đè (trước GĐ69 xin OTP làm QR hết hạn sau 5 phút).
    expired_at DATETIME NOT NULL,
    -- GĐ69: hạn RIÊNG của OTP do request-otp đặt = min(now + 5 phút, expired_at).
    -- NULL = chưa cấp OTP (hoặc OTP cũ đã bị xoá khi khách quên lấy hàng) ⇒ đường OTP từ chối.
    otp_expired_at DATETIME DEFAULT NULL,
    used_at DATETIME DEFAULT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- GĐ69 — thêm cột `otp_expired_at` cho DB ĐANG CÓ DỮ LIỆU.
-- `CREATE TABLE IF NOT EXISTS` ở trên chỉ tạo bảng mới nên bảng cũ không có cột này.
-- MySQL 8 không hỗ trợ `ADD COLUMN IF NOT EXISTS` ⇒ kiểm INFORMATION_SCHEMA rồi mới ALTER;
-- chạy lại file bao nhiêu lần cũng an toàn, không mất dữ liệu.
SET @gd69_sql = (
    SELECT IF(
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = 'smart_locker_db'
            AND TABLE_NAME = 'pickup_credentials'
            AND COLUMN_NAME = 'otp_expired_at') = 0,
        'ALTER TABLE pickup_credentials ADD COLUMN otp_expired_at DATETIME DEFAULT NULL AFTER expired_at',
        'SET @gd69_noop = 1'
    )
);
PREPARE gd69_stmt FROM @gd69_sql;
EXECUTE gd69_stmt;
DEALLOCATE PREPARE gd69_stmt;

-- 8. BẢNG MÃ QR ĐỊNH DANH CỐ ĐỊNH CỦA SHIPPER (SHIPPER_IDENTITY_TOKENS)
CREATE TABLE IF NOT EXISTS shipper_identity_tokens (
    token_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    shipper_id VARCHAR(50) NOT NULL,
    dynamic_token VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expired_at DATETIME NOT NULL, -- mã cố định: luôn đặt mốc rất xa (PERPETUAL_EXPIRY), không dùng để chặn
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
    -- GĐ9: AI đã ra lệnh mở tủ. NULLABLE có chủ đích — bảng đã có 31 dòng từ trước khi cột này
    -- tồn tại, thêm NOT NULL sẽ làm `ddl-auto=update` không ALTER được ⇒ app không khởi động.
    -- 31 dòng cũ sẽ mãi NULL: dữ liệu đó chưa từng được ghi, không khôi phục được.
    triggered_by VARCHAR(30) DEFAULT NULL,
    -- GĐ9: mã đơn liên quan. Cố ý là chuỗi trần, KHÔNG phải khoá ngoại sang `orders` —
    -- nhật ký phải ghi được cả khi đơn đã bị xoá/đổi mã, và FK chỉ thêm một đường N+1 khi tra.
    order_id VARCHAR(50) DEFAULT NULL,
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


-- 13. BẢNG NHẬT KÝ BẢO TRÌ TỦ/NGĂN (LOCKER_MAINTENANCE_LOGS)
-- GĐ10: bảng riêng, KHÔNG dùng chung `command_logs` — hai thứ khác bản chất.
-- `command_logs` ghi lệnh kỹ thuật (phần lớn KHÔNG có ai bấm), còn bảng này ghi hành động
-- do một admin chủ động làm, kèm lý do và người làm.
-- compartment_id NULL = bảo trì TOÀN TỦ; có giá trị = bảo trì một ngăn (1-based).
-- by_username NOT NULL vì mọi lần bảo trì đều đến từ request HTTP đã xác thực ADMIN.
CREATE TABLE IF NOT EXISTS locker_maintenance_logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    locker_id VARCHAR(50) NOT NULL,
    compartment_id INT DEFAULT NULL,
    action VARCHAR(20) NOT NULL,           -- LOCK / UNLOCK
    reason_code VARCHAR(30) DEFAULT NULL,  -- GIA_CO, HONG_CAN, VE_SINH, NANG_CAP, KHAC
    note VARCHAR(255) DEFAULT NULL,
    by_username VARCHAR(50) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_maintenance_logs_locker (locker_id),
    KEY idx_maintenance_logs_created (created_at),
    CONSTRAINT fk_maintenance_logs_locker FOREIGN KEY (locker_id) REFERENCES lockers(locker_id)
) ENGINE=InnoDB;

-- 14. BẢNG THÔNG BÁO MÁY CHỦ (NOTIFICATIONS)
-- GĐ64a: thay chuông đọc localStorage. Người nhận là recipient_phone (khách) HOẶC
-- recipient_role (vd 'SHIPPER' — dùng chung trạng thái đã đọc cho cả vai).
-- order_id là chuỗi trần, KHÔNG khoá ngoại (giống command_logs.order_id).
-- Cột khớp đúng com.ptit.smartlocker.entity.Notification.
CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    recipient_phone VARCHAR(20) DEFAULT NULL,
    recipient_role VARCHAR(20) DEFAULT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    order_id VARCHAR(50) DEFAULT NULL,
    method VARCHAR(10) DEFAULT NULL,
    is_read BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    KEY idx_notifications_phone_created (recipient_phone, created_at),
    KEY idx_notifications_role_created (recipient_role, created_at)
) ENGINE=InnoDB;