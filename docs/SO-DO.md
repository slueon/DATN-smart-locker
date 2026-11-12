# SƠ ĐỒ HỆ THỐNG SMART LOCKER

> Ba sơ đồ Mermaid dưới đây mô tả **đúng luồng đang chạy trong code**, không phải luồng mong muốn.
> Số liệu (đếm từ mã nguồn): **26 endpoint / 6 controller / 8 service / 10 entity / 14 component**.
> Mọi topic lấy từ `MQTT_GUIDE.md`; giới hạn bảo mật lấy từ `docs/GIOI-HAN-BAOMAT.md`.

---

## 1. Kiến trúc tổng thể

```mermaid
flowchart TB
    subgraph WEB["🖥️ Web Client — React 19 + Vite 8 + Tailwind 4"]
        direction LR
        C1["👤 Khách hàng<br/>đặt hàng · nhận mã QR/OTP"]
        C2["🚚 Shipper<br/>đặt trước ngăn · nạp hàng"]
        C3["🛡️ Admin<br/>giám sát · mở khoá khẩn cấp"]
    end

    subgraph BE["⚙️ Backend — Spring Boot 4.0.8 (Java 21)"]
        direction TB
        SEC["Security Filter Chain<br/>TokenAuthFilter (Bearer opaque)<br/>23 API cần xác thực"]
        CTRL["Controller × 6<br/>26 endpoint REST"]
        SVC["Service × 8<br/>nghiệp vụ + MqttService"]
        REPO["Repository (Spring Data JPA)"]
        DB[("🗄️ MySQL 8.0<br/>smart_locker_db<br/>10 entity")]
        SEC --> CTRL --> SVC --> REPO --> DB
    end

    subgraph BROKER["☁️ MQTT Broker — broker.emqx.io:1883"]
        B1["Topic UPLINK (chung, không id)<br/>ptit/status · ptit/qr/* · ptit/receive/*<br/>ptit/compartment/N/*"]
        B2["Topic DOWNLINK (riêng từng tủ, có id)<br/>ptit/{dev}/verified/* · ptit/{dev}/locker/open"]
    end

    subgraph HW["🔌 Tủ ESP32 — phần cứng nhúng"]
        direction TB
        H1["🖥️ TFT màn hình cảm ứng"]
        H2["📷 GM65 — quét mã QR/vạch"]
        H3["🚪 MC-38 — cảm biến cửa đóng/mở"]
        H4["⚖️ HX711 — cảm biến cân nặng"]
        H5["🔒 Solenoid 12V — khoá ngăn"]
    end

    C1 & C2 & C3 -- "HTTPS/REST + Authorization: Bearer" --> SEC
    SVC -- "publish (uplink) + subscribe ptit/#" --> B1
    SVC -- "publish (downlink)" --> B2
    HW2["ESP32 client"] -- "publish (uplink)" --> B1
    B2 -- "subscribe (downlink)" --> HW2
    HW2 --- H1 & H2 & H3 & H4 & H5

    style BROKER fill:#fff4e6,stroke:#e8a33d,stroke-width:2px
    style SEC fill:#e8f5e9,stroke:#43a047
```

**Ghi chú thiết kế — vì sao UPLINK và DOWNLINK khác quy ước tên:**

> **Uplink dùng topic CHUNG, không chứa `{id}`; downlink dùng topic RIÊNG từng tủ, có `{id}`.**
>
> Lý do: nhiều tủ phải cùng publish lên **một** topic (ví dụ `ptit/status`) thì thiết bị nào chỉ cần biết 1 topic là gửi được — id của tủ nằm trong **payload** (`locker_id`). Ngược lại, lệnh mở tủ là lệnh **nguy hiểm**, phải đến **đúng một** tủ; nếu dùng topic chung thì mọi tủ đều nhận và đều mở → thảm hoạ. Vì vậy downlink bắt buộc có `{id}`.
>
> **Đánh đổi:** mỗi bản tin uplink đều phải parse JSON để biết tủ nào → tốn CPU và dễ lỗi nếu firmware quên `locker_id` (đúng là chuyện đang xảy ra, xem giới hạn #3 trong `GIOI-HAN-BAOMAT.md`). Nhưng nếu đảo lại (uplink có id) thì mỗi tủ phải publish N topic khác nhau và backend phải subscribe wildcard nhiều tầng — phức tạp hơn mà lợi ích không có.

> ⚠️ **Giới hạn bảo mật (xem `GIOI-HAN-BAOMAT.md` #1):** broker `broker.emqx.io` là broker **công cộng, KHÔNG xác thực** (`mqtt.username` rỗng, `mqtt.ssl.enabled=false`). Ai biết tên topic đều publish được lệnh mở tủ. Đây là lý do nhánh downlink phải có id — nhưng **id không phải bí mật**, nên biện pháp thật là broker riêng + TLS + ACL.

---

## 2. Tuần tự — Shipper nạp hàng (2 nhánh)

Điểm mới của giai đoạn T3: shipper **được chọn trước ngăn trên web**, nhưng vẫn giữ được nhánh cũ (đến tủ mới chọn trên TFT).

```mermaid
sequenceDiagram
    autonumber
    actor S as 🚚 Shipper
    participant W as 🖥️ Web (ShipperTab)
    participant BE as ⚙️ Backend
    participant DB as 🗄️ MySQL
    participant B as ☁️ Broker
    participant T as 🔌 Tủ ESP32

    Note over S,T: ===== NHÁNH A — ĐÃ ĐẶT TRƯỚC TRÊN WEB =====

    S->>W: Chọn đơn PENDING + chọn ngăn trống
    W->>BE: GET /api/shipper/orders/pending
    BE->>DB: Đơn PENDING + compartment + locker
    BE-->>W: trackingCode, compartmentIndex
    W->>BE: GET /api/lockers/{id}/compartments
    BE-->>W: Danh sách ngăn (lọc status=EMPTY)
    W->>BE: POST /api/shipper/orders/{orderId}/reserve<br/>{trackingCode, compartmentIndex}
    BE->>DB: SELECT ... FOR UPDATE (khoá bi quan ngăn)
    Note right of BE: Ngăn cũ RESERVED → EMPTY<br/>Ngăn OCCUPIED → từ chối 400<br/>KHÔNG đụng available_slots
    BE->>DB: compartment.status=RESERVED<br/>order.compartment + tracking_code<br/>order.shipper_reserved_at = now()
    BE-->>W: 200 OK (hoặc 409 nếu đã đặt trước)

    S->>T: Quét QR shipper tại tủ (mã không có hạn)
    T->>B: publish ptit/qr/shipper {locker_id, qr}
    B->>BE: nhận uplink
    BE->>DB: verifyDynamicToken → token.is_verified=true<br/>token.locker_id = tủ này
    BE->>B: publish ptit/{dev}/verified/shipper = 1

    S->>T: Quét mã vận đơn trên nhãn
    T->>B: publish ptit/qr/order {locker_id, qr}
    B->>BE: nhận uplink
    BE->>DB: tra tracking_code trước, trượt thì order_id
    Note right of BE: verified/order = 1 CHỈ KHI<br/>PENDING + có ngăn + shipper_reserved_at ≠ NULL<br/>+ đúng tủ nhận tin
    BE->>B: publish ptit/{dev}/verified/order = 1
    BE->>B: publish ptit/{dev}/locker/open = "<idx 0-based>,deposit"
    B->>T: nhận downlink
    Note over T: open_lock(compartment_idx)<br/>→ Solenoid bung ngăn
    T->>B: publish ptit/compartment/N/event {status:deposit_success}
    B->>BE: nhận event
    BE->>DB: ngăn OCCUPIED · đơn → DEPOSITED

    Note over S,T: ===== NHÁNH B — CHƯA ĐẶT TRƯỚC (dự phòng) =====

    S->>T: Quét QR shipper tại tủ
    T->>B: publish ptit/qr/shipper
    BE->>B: publish ptit/{dev}/verified/shipper = 1
    S->>T: Quét mã vận đơn
    T->>B: publish ptit/qr/order
    BE->>DB: tra đơn — PENDING nhưng shipper_reserved_at = NULL
    Note right of BE: KHÔNG đủ điều kiện ⇒ phát 0 THẬT<br/>(im lặng thì TFT treo chờ)
    BE->>B: publish ptit/{dev}/verified/order = 0
    B->>T: nhận 0
    T->>S: TFT hiện danh sách ngăn trống
    S->>T: Chọn ngăn trên màn hình cảm ứng
    Note over T: firmware TỰ open_lock()<br/>mở bằng phần cứng, không cần backend
    T->>B: publish ptit/locker/select_compartment {locker_id, compartment:0-based, qr}
    B->>BE: nhận uplink
    Note right of BE: Backend CHỈ ghi nhận — gán ngăn cho đơn<br/>+ ghi device_events. TUYỆT ĐỐI không publish locker/open<br/>(nếu phát, tủ đã mở rồi còn mở lần 2 + không cần xác thực)
    BE->>DB: order.compartment = ngăn (1-based), ghi event
```

**Ghi chú thiết kế — vì sao nhánh B vẫn tồn tại:**

> **Đánh đổi của Q2 ("shipper chọn ngăn trên web"):** luồng đặt trước chỉ áp dụng cho ca shipper **có dùng web trước khi đến tủ**. Nhưng thực tế shipper có thể đến tủ mà chưa đặt trước (mất mạng, quên, đơn phát sinh). Nếu bỏ nhánh B thì shipper đó **không giao được hàng nào** — tủ không có đường nào để mở. Vì vậy nhánh B giữ lại làm **dự phòng**, do firmware tự mở và backend chỉ ghi nhận.
>
> **Cái giá:** hệ thống có **hai** đường mở tủ khác nhau, nên bề mặt tấn công rộng hơn (nhánh B không cần xác thực shipper ở phía backend — firmware tự quyết). Đây là lý do `handleSelectCompartment` **bỏ hẳn** `publishCommand`: backend không được phát lệnh mở từ gói tin này, nếu không thì ai publish được `select_compartment` là mở được tủ.

**Ghi chú thiết kế — vì sao `verified/order = 0` phải phát thật:**

> TFT là máy trạng thái hữu hạn: sau khi quét mã đơn, nó **chờ** một trong hai giá trị `1` hoặc `0` trên `ptit/{dev}/verified/order`. Nếu backend "im lặng" khi đơn không đủ điều kiện (thay vì phát `0`), TFT **treo vô hạn** ở màn hình chờ. Người dùng thấy tủ "đơ". Vì vậy mọi nhánh từ chối đều phải phát `0`.

---

## 3. Tuần tự — Khách nhận hàng

```mermaid
sequenceDiagram
    autonumber
    actor K as 👤 Khách hàng
    participant W as 🖥️ Web (CustomerPickupTab)
    participant BE as ⚙️ Backend
    participant DB as 🗄️ MySQL
    participant B as ☁️ Broker
    participant T as 🔌 Tủ ESP32

    K->>W: Mở màn hình nhận hàng
    W->>BE: GET /api/orders/{orderId}?phone=...
    Note right of BE: W3: CUSTOMER chỉ xem được SĐT của chính mình<br/>khác → 403. Không token → 401
    BE-->>W: qrToken (chỉ khi DEPOSITED + đúng chủ)

    Note over K,T: ===== ĐƯỜNG 1 — NHẬP SỐ ĐIỆN THOẠI TẠI TFT =====
    K->>T: Nhập SĐT trên TFT
    T->>B: publish ptit/receive/phone {locker_id, phone}
    B->>BE: nhận uplink
    BE->>DB: đếm đơn DEPOSITED của SĐT này
    BE->>B: publish ptit/{dev}/verified/customer = n (hoặc -1 / 0)
    B->>T: TFT biết có bao nhiêu kiện chờ nhận

    Note over K,T: ===== ĐƯỜNG 2 — NHẬP OTP =====
    K->>T: Nhập OTP 6 số
    T->>B: publish ptit/receive/otp {locker_id, otp}
    B->>BE: nhận uplink
    BE->>DB: PickupService.verifyAndPickup (OTP)<br/>kiểm hạn · đếm failedAttempts · chống brute-force
    alt OTP đúng
        BE->>B: publish ptit/{dev}/locker/open = "<idx>,pickup"
        B->>T: Solenoid bung ngăn của đơn
    else OTP sai
        BE->>B: publish ptit/{dev}/verified/qr_otp/failed = -1
        Note right of BE: sai 5 lần → tạm khoá mã (failedAttempts)
    end

    Note over K,T: ===== ĐƯỜNG 3 — QUÉT QR NHẬN HÀNG =====

    K->>T: Quét mã QR (lấy từ web, do server cấp)
    T->>B: publish ptit/qr/receive {locker_id, qr}
    B->>BE: nhận uplink
    BE->>DB: so khớp CHÍNH XÁC qr_token (SecureRandom 32 byte)
    Note right of BE: Đã bỏ mọi nhánh suy mã từ order_id<br/>(PKUP-*, hậu tố -T, chính orderId) — đó là lỗ hổng cũ
    alt QR đúng
        BE->>B: publish ptit/{dev}/locker/open = "<idx>,pickup"
    else QR sai
        BE->>B: publish ptit/{dev}/verified/qr_otp/failed = -1
    end

    T->>B: publish ptit/compartment/N/event {status:pickup_success}
    B->>BE: nhận event
    Note over K,T: Khách lấy hàng ra và đóng cửa ngăn<br/>→ MC-38 báo cửa đóng → sinh event pickup_success
    BE->>DB: ngăn → EMPTY · đơn → COMPLETED
    BE->>DB: (nếu quá hạn) OverdueScheduler đánh OVERDUE trước đó
```

**Ghi chú thiết kế — vì sao mã QR nhận hàng KHÔNG suy ra từ `order_id`:**

> **Vấn đề cũ:** mã nhận hàng từng là `"PKUP-" + orderId`. Ai biết mã đơn (in trên nhãn, hiện trên web) là suy ra được mã mở tủ. Tệ hơn, `PickupService` còn chấp nhận chính `orderId` làm mã hợp lệ.
>
> **Cách chọn:** sinh `qrToken` bằng `SecureRandom` 32 byte (256 bit) → Base64URL 43 ký tự, kiểm trùng tối đa 5 lần trước khi lưu. Mã **không suy được** từ bất kỳ dữ liệu đơn nào.
>
> **Đánh đổi:** (1) mã **không thể tính lại** — mất mã là phải cấp lại, không "tính lại từ orderId" được như trước; (2) phải thêm cột `qr_token` UNIQUE + index để tra cứu điểm, tốn chỗ hơn; (3) khi khách mở web, mã phải **gọi API** lấy từ server chứ không tự sinh ở client — nghĩa là mất mạng thì không hiện được mã (trước đây vẫn sinh được mã giả, nhưng mã giả đó vô dụng vì không mở được tủ thật).

**Ghi chú thiết kế — vì sao phải có cả OTP và QR:**

> OTP dùng khi khách không mở được web (máy hết pin, không có mạng) — chỉ cần đọc 6 số trên màn hình. QR dùng khi khách có web — quét nhanh, không phải gõ. Hai đường cùng ghi vào `pickup_credentials` và cùng gọi `verifyAndPickup`, nên luật bảo mật (hạn, số lần sai, trạng thái đơn) chỉ viết **một lần**.
>
> **Đánh đổi:** bề mặt tấn công gấp đôi (2 cách đoán mã). Bù lại, `failedAttempts` và `expiredAt` dùng chung nên brute-force một đường cũng bị khoá luôn đường kia.
