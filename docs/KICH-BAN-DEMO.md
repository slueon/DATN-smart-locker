# KỊCH BẢN DEMO BẢO VỆ

> Tài liệu này dùng **trực tiếp trước hội đồng**. Mọi con số đều là **kết quả đo thật** trên máy
> này ngày 2026-11-08, không phải ước lượng.
>
> **Đã chạy thử: 3 lần toàn bộ luồng tự động (18/18 bước đạt, 12–14 giây/lần) + 3 lần phần giao
> diện (8/8 bước đạt, ~27 giây/lần).** Nhật ký thô: `scripts/evidence/demo-run{1,2,3}.json`,
> `scripts/evidence/demo-ui.json`, `scripts/evidence/demo-run*.log`.
>
> Mã nguồn tại thời điểm viết: HEAD `00f565b`. Test: **39/39 PASS**.

---

## PHẦN 1 — CHUẨN BỊ (5 phút trước khi vào phòng)

### 1.1 Bật hệ thống

Mở **2 cửa sổ PowerShell**, chạy từ thư mục gốc dự án.

**Cửa sổ 1 — backend (đợi ~35 giây đến dòng "Started SmartLockerBackendApplication"):**

```powershell
cd backend\smart-locker-backend
$env:DB_PASSWORD='200220'      # BẮT BUỘC: mật khẩu đã được bỏ khỏi repo ở GĐ2
$env:SECURITY_ENABLED='true'   # mặc định đã true; đặt tường minh cho chắc
$env:MQTT_ENABLED='true'       # bật MQTT để demo bước 3
.\mvnw.cmd -o spring-boot:run
```

> **Vì sao phải set `DB_PASSWORD`:** `application.properties` dòng 20 để
> `spring.datasource.password=${DB_PASSWORD:}` (không có giá trị mặc định — đây là bản vá GĐ2 cho
> lỗ hổng "mật khẩu từng nằm trong git"). Quên biến này thì app **không khởi động được**, log báo
> `HikariPool ... checkFailFast` / `Access denied for user 'root'@'localhost'`.

**Cửa sổ 2 — frontend (đợi ~2 giây đến dòng "Local: http://localhost:5173/"):**

```powershell
cd frontend
npm.cmd run dev
```

### 1.2 Kiểm nhanh "hệ thống sẵn sàng" (khoảng 20 giây)

Dán nguyên khối này vào cửa sổ thứ 3:

```powershell
$base='http://localhost:8080'
foreach($u in @(@('admin','admin123'),@('shipper','shipper123'),@('khachhang','123456'))){
  $b=@{username=$u[0];password=$u[1]}|ConvertTo-Json
  $r=Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -Body $b -ContentType 'application/json' -UseBasicParsing
  $j=$r.Content|ConvertFrom-Json
  "$($u[0]) => HTTP $($r.StatusCode) role=$($j.data.role) tokenLen=$($j.data.token.Length)"
}
```

**Kết quả phải thấy đúng 3 dòng — đó là mốc "sẵn sàng":**

```
admin      => HTTP 200 role=ADMIN    tokenLen=43
shipper    => HTTP 200 role=SHIPPER  tokenLen=43
khachhang  => HTTP 200 role=CUSTOMER tokenLen=43
```

Nếu một dòng không ra 200 → xem Phần 3 (phương án B).

### 1.3 Phải tắt / kiểm trước

| Việc | Lệnh kiểm | Kỳ vọng |
|---|---|---|
| Không còn process Java cũ giữ port | `Get-NetTCPConnection -State Listen \| Where-Object LocalPort -in 8080,5173` | chỉ 2 dòng: 8080 (backend), 5173 (vite) |
| Không có `mvnw`/`npm` chạy song song | `Get-CimInstance Win32_Process -Filter "Name='java.exe'"` | chỉ 1 process java (backend của bạn) |
| MySQL đang chạy | `Get-Service MySQL80` | `Running` |
| DB đúng baseline | xem lệnh dưới | 5 đơn PENDING, 0 credential, 3 user, 10 tủ |

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -uroot -p200220 -e "SELECT order_id,status,locker_id,compartment_id FROM smart_locker_db.orders ORDER BY order_id;"
```

**Baseline phải thấy (5 đơn, đều PENDING):**

```
ORD-332156  PENDING  LOCKER_HN_02  4
ORD-554432  PENDING  LOCKER_HN_03  5
ORD-654123  PENDING  LOCKER_HN_01  1
ORD-882104  PENDING  LOCKER_HN_01  2
ORD-991345  PENDING  LOCKER_HN_02  3
```

> ⚠️ **Cảnh báo quan trọng khi chuẩn bị:** đừng bật nhiều process `mvnw` cùng lúc (ví dụ vừa chạy
> `mvnw test` vừa `mvnw spring-boot:run`). Hai tiến trình Maven dùng chung thư mục `target/` sẽ
> xoá dở class của nhau → lỗi `NoClassDefFound ...Builder` hoặc `package ... does not exist` trông
> như lỗi code nhưng thực ra là tranh chấp build. Đã gặp thật. Nếu gặp: tắt hết, chạy lại **một**
> lệnh.

### 1.4 Tài khoản dùng trong demo

| Vai trò | Username | Mật khẩu | Dùng ở bước |
|---|---|---|---|
| Khách hàng | `khachhang` | `123456` | 1, 4, 5 |
| Shipper | `shipper` | `shipper123` | 2, 3 |
| Quản trị | `admin` | `admin123` | dự phòng |

Trên trang đăng nhập có sẵn **3 nút điền nhanh** (`Khách Hàng`, `Shipper`, `Quản Trị`) — bấm là
đăng nhập luôn, không cần gõ. Đây là cách nhanh nhất khi demo.

---

## PHẦN 2 — 5 BƯỚC DEMO (15 phút)

> Thời gian ghi dưới đây là **số đo thật** của phần tự động; phần bấm tay trên web lâu hơn, tính
> khoảng 1,5–2×.

### BƯỚC 1 — Khách đặt hàng (≈2 phút)

**Ai bấm gì:**
1. Trình duyệt mở `http://localhost:5173`.
2. Bấm nút điền nhanh **`Khách Hàng / 123456`**.
3. Vào tab **Bản đồ trạm tủ GIS** → bấm một marker tủ bất kỳ (ví dụ `KTX A1 (Trụ Sở PTIT)`).
4. Chọn ngăn trống, bấm đặt hàng → xác nhận thanh toán.
5. Hệ thống hiện **mã QR nhận hàng**.

**Kết quả mong đợi (số thật):**
- Màn hình: mã QR + mã đơn dạng `ORD-XXXXXXXX`.
- DB: đơn mới `status = PENDING`, `locker_id` = tủ đã chọn.
- DB: `pickup_credentials` có `qr_token` **43 ký tự**, `otp_code` rỗng (OTP cấp sau khi nạp hàng).

**Câu nói khi demo (điểm ghi điểm đầu tiên):**
> "Mã QR dài **43 ký tự** sinh từ `SecureRandom` 32 byte, mã hoá Base64URL. Nó **không** chứa và
> **không** suy ra được từ mã đơn. Trước đây mã là `PKUP-<orderId>` — ai biết mã đơn là mở được tủ.
> Đây là lỗ hổng đã bịt, và bước 5 sẽ chứng minh lại."

Kiểm bằng lệnh nếu bị hỏi:

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -uroot -p200220 -e "SELECT order_id,status,compartment_id,CHAR_LENGTH(qr_token) AS qr_len FROM smart_locker_db.orders o JOIN smart_locker_db.pickup_credentials p ON p.order_id=o.order_id ORDER BY o.created_at DESC LIMIT 1;"
```

---

### BƯỚC 2 — Shipper đặt trước ngăn trên web (≈2 phút)

**Ai bấm gì:**
1. Đăng xuất → bấm nút điền nhanh **`Shipper / shipper123`**.
2. Vào tab **Cổng Shipper & Nạp tủ**.
3. Danh sách **HÀNG CHỜ NẠP** hiện đơn của bước 1 (lấy từ API, không phải dữ liệu mẫu).
4. Bấm vào đơn → panel **"ĐẶT TRƯỚC NGĂN TỦ"** hiện các ngăn **EMPTY**.
5. Chọn một ngăn → bấm **"Đặt trước ngăn"** → hiện *"Đã đặt trước ngăn #N"*.
6. Bấm **"Đặt trước ngăn"** lần nữa → hiện lỗi đỏ *"…đã được đặt trước. Huỷ đặt trước trước khi đổi
   ngăn."* và nút đổi thành **"Huỷ đặt trước"**.

**Kết quả mong đợi (số thật):**
- `orders.compartment_id` = ngăn đã chọn, `orders.shipper_reserved_at` **≠ NULL**,
  `orders.tracking_code` = mã vận đơn.
- `compartments.status` của ngăn đó = **`RESERVED`**.
- `locker_slot_schedules.available_slots` **KHÔNG đổi** (đã trừ 1 lần lúc khách đặt; trừ lần nữa là
  1 đơn ăn 2 slot — lỗi đã sửa).

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -uroot -p200220 -e "SELECT o.order_id,o.compartment_id,o.tracking_code,o.shipper_reserved_at IS NOT NULL AS da_dat_truoc,c.comp_index,c.status FROM smart_locker_db.orders o LEFT JOIN smart_locker_db.compartments c ON c.compartment_id=o.compartment_id ORDER BY o.created_at DESC LIMIT 2;"
```

**Câu nói:**
> "`shipper_reserved_at` là **cột riêng** để phân biệt 'ngăn do khách chọn lúc checkout' với 'ngăn
> shipper chủ động đặt trước'. Thiếu cột này thì mọi đơn đều bị coi là đã đặt trước và tính năng
> mất nghĩa — đây là lỗi thiết kế đã phát hiện và sửa ở vòng nghiệm thu."

---

### BƯỚC 3 — Shipper nạp hàng tại tủ (≈3 phút)

**Ai bấm gì:**
1. Vẫn ở tab Shipper → bấm **"Sinh Mã QR Shipper 60s"** → modal hiện QR + đếm ngược.
2. **Quét QR đó tại tủ** (hoặc người demo mô phỏng bằng probe — xem Phần 3).
3. Quét **mã vận đơn** trên nhãn kiện hàng (hoặc bấm "Quét Mã Kiện").
4. Tủ bung đúng ngăn đã đặt trước → shipper bỏ hàng, đóng cửa → bấm **"Mở Cửa Ngăn"** để hệ thống
   ghi nhận nạp hàng thành công.

**Kết quả mong đợi (số thật):**
- Token QR trên modal có dạng **`SHIP-<uuid>`** (ví dụ `SHIP-51be6380-…`), **KHÔNG** phải
  `SHIPPER-TOKEN-…` (token giả của bản cũ do client tự bịa).
- MQTT: `ptit/{dev}/verified/order` = **`1`**.
- MQTT: `ptit/{dev}/locker/open` = **`<compIndex−1>,deposit`** — chỉ số **0-based** (ngăn 2 → `1`).
- DB: `command_logs` **+1** dòng (`locker_id` đúng tủ, `compartment_id` = ngăn, `OPEN_DOOR`).
- DB: đơn → **`DEPOSITED`**, `deposited_at` ≠ NULL, `expiry_deadline` = 24h00 ngày hôm sau.
- DB: ngăn → **`OCCUPIED`**.

**Điều kiện bắt buộc — nói rõ khi demo:**
> "Quét mã đơn chỉ mở tủ khi hội đủ **4 điều kiện**: đơn `PENDING`, có ngăn, **`shipper_reserved_at`
> ≠ NULL** (đã đặt trước), và đơn thuộc **đúng tủ đang nhận bản tin**. Cộng thêm phiên shipper đã
> xác thực còn hiệu lực **tại đúng tủ đó** (token sống 60 giây). Thiếu bất kỳ điều kiện nào →
> hệ thống phát `verified/order = 0` và **không mở** — nghĩa là lỗi sẽ lộ ra ngay, không im lặng."

---

### BƯỚC 4 — Khách nhận hàng (≈3 phút)

**Ai bấm gì:**
1. Đăng xuất → đăng nhập **`Khách Hàng / 123456`**.
2. Vào tab nhận hàng → nhập **số điện thoại** `0988123456`.
3. Màn hình báo số đơn sẵn sàng → bấm **"Nhận mã OTP"**.
4. Nhập **OTP 6 số** → tủ bung ngăn.

**Kết quả mong đợi (số thật):**
- MQTT: `ptit/{dev}/verified/customer` = **số đơn DEPOSITED** (≥ 1). SĐT lạ → **`-1`**.
- MQTT: `ptit/{dev}/locker/open` = **`<compIndex−1>,pickup`** (mode **`pickup`**, khác `deposit`).
- DB: OTP là **6 chữ số** (`^\d{6}$`), đơn → **`COMPLETED`**, credential `is_used = 1`.
- DB: ngăn về **`EMPTY`**, `current_weight = 0`.

**Câu nói:**
> "Khách nhận được đúng `locker/open` với mode `pickup` để firmware biết đây là luồng lấy hàng, không
> phải nạp hàng. OTP 6 số cấp lại mỗi lần yêu cầu, có hiệu lực 5 phút, và khoá sau 5 lần nhập sai."

---

### BƯỚC 5 — Chứng minh bảo mật (≈4 phút) ⭐ PHẦN GHI ĐIỂM

Chạy khối lệnh này, **đọc to kết quả** cho hội đồng (4 phép thử, ~1 giây):

```powershell
$base='http://localhost:8080'
$b=@{username='khachhang';password='123456'}|ConvertTo-Json
$tok=((Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST -Body $b -ContentType 'application/json' -UseBasicParsing).Content|ConvertFrom-Json).data.token
$h=@{Authorization="Bearer $tok"}

# (1) Không token
try{ (Invoke-WebRequest -Uri "$base/api/lockers" -UseBasicParsing).StatusCode }catch{ "1) Không token => HTTP $($_.Exception.Response.StatusCode.value__)" }

# (2) Đoán mã QR từ mã đơn
try{
  Invoke-WebRequest -Uri "$base/api/pickup/verify" -Method POST -Headers $h -UseBasicParsing -ContentType 'application/json' -Body '{"lockerId":"LOCKER_HN_03","authMethod":"QR","code":"PKUP-ORD-654123","orderId":"ORD-654123"}' | Out-Null
}catch{ "2) Đoán PKUP-<orderId> => HTTP $($_.Exception.Response.StatusCode.value__)" }

# (3) by-phone của NGƯỜI KHÁC
try{ Invoke-WebRequest -Uri "$base/api/orders/by-phone?phone=0912345678" -Headers $h -UseBasicParsing | Out-Null }
catch{ "3) by-phone SĐT người khác => HTTP $($_.Exception.Response.StatusCode.value__)" }

# (4) by-phone của CHÍNH MÌNH - kiểm không lộ secret
$r=Invoke-WebRequest -Uri "$base/api/orders/by-phone?phone=0988123456" -Headers $h -UseBasicParsing
"4) by-phone SĐT mình => HTTP $($r.StatusCode), rò qrToken/otpCode = $([bool]($r.Content -match '\"qrToken\":\s*\"[^\"]+\"|\"otpCode\":\s*\"[^\"]+\"'))"
```

**Kết quả phải thấy (đo thật):**

```
1) Không token            => HTTP 401
2) Đoán PKUP-<orderId>    => HTTP 409
3) by-phone người khác    => HTTP 403
4) by-phone SĐT mình      => HTTP 200, rò qrToken/otpCode = False
```

**Nói gì với từng con số:**

| Phép thử | Con số | Ý nghĩa |
|---|---|---|
| Gọi API không đăng nhập | **401** | 23 API nghiệp vụ đều sau lớp xác thực; mặc định `denyAll()`. Trước đây mọi API mở. |
| Đoán mã mở tủ từ mã đơn | **409** (sai mã) | Hệ thống **không còn nhánh nào** suy mã từ `orderId`. Mã đúng là 43 ký tự ngẫu nhiên, không đoán được. |
| Xem đơn theo SĐT người khác | **403** | Chống IDOR: CUSTOMER chỉ xem được SĐT của chính mình; ADMIN xem được mọi SĐT. |
| Xem đơn theo SĐT của mình | **200 nhưng không có secret** | Danh sách **không bao giờ** trả `qrToken`/`otpCode`. Muốn lấy mã phải qua chi tiết đơn + đúng SĐT + đơn đã `DEPOSITED`. |

**Câu chốt phần bảo mật:**
> "Ba lỗ này đều là lỗ thật, đã từng tồn tại trong bản chạy được. Giờ mỗi lỗ có **test tự động**
> khoá lại — và tôi đã kiểm chứng bằng cách **cố tình phá lại code** để xem test có bắt được không.
> Kết quả: 6/6 lần phá đều có test báo đỏ."

---

## PHẦN 3 — PHƯƠNG ÁN B (khi mạng / broker / phần cứng hỏng)

> Nguyên tắc: **không bao giờ để hội đồng nhìn màn hình trắng.** Mỗi bước đều có đường lui đã
> chuẩn bị sẵn.

### B.0 Nếu backend không khởi động

| Triệu chứng | Nguyên nhân | Xử lý ngay |
|---|---|---|
| `Access denied for user 'root'` / `HikariPool ... checkFailFast` | Quên `$env:DB_PASSWORD='200220'` | Set lại biến rồi chạy lại |
| `Port 8080 was already in use` | Process cũ còn sống | `Get-NetTCPConnection -State Listen -LocalPort 8080 \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| `NoClassDefFound ...Builder` / `package does not exist` | 2 tiến trình Maven tranh `target/` | Tắt hết java, chạy lại **một** lệnh `mvnw` |

### B.1 Nếu broker MQTT không kết nối (mạng phòng thi yếu)

**Triệu chứng:** log backend có `Chưa thể kết nối tức thời tới MQTT Broker`; bước 3 không thấy tủ
bung.

**Xử lý — nói thẳng rồi chuyển sang bằng chứng đã chụp sẵn:**
> "Broker công cộng `broker.emqx.io` đang không kết nối được từ mạng này. Đây là phụ thuộc bên
> ngoài, không phải lỗi hệ thống. Tôi có sẵn bằng chứng chạy thật từ lúc mạng tốt:"

1. **Vẫn demo được bước 1, 2, 4, 5** — các bước này chỉ dùng HTTP + DB, **không cần MQTT**.
   - Bước 3 chuyển sang chứng minh bằng DB: đơn `DEPOSITED`, `command_logs` có dòng `OPEN_DOOR`.
2. Mở sẵn các file bằng chứng (mở trước khi vào phòng):
   - `scripts/evidence/demo-run1.json` — 18/18 bước, có cả kết quả MQTT `verified/order=1`,
     `locker/open=1,deposit`.
   - `scripts/evidence/demo-run1-backend.log` — log thật có dòng
     `Kết nối MQTT Broker thành công tại: tcp://broker.emqx.io:1883` và `✅ Đã subscribe ... ptit/#`.
3. Nếu hội đồng muốn xem trực tiếp: dùng **`scripts/mqtt-probe.mjs`** (tự cài MQTT 3.1.1 trên
   `node:net`, không cần npm) để giả lập tủ:

```powershell
# Giả lập tủ báo đã nạp hàng: phát sự kiện deposit_success
node scripts\mqtt-probe.mjs pub "ptit/compartment/1/event" '{"locker_id":"khuon_vien","status":"deposit_success","compartment":1,"weight":0.85}' --qos=1
```

> ⚠️ Trên PowerShell 5.1, dấu `"` trong tham số bị bóc. Nếu lệnh trên lỗi, ghi payload ra file rồi
> đọc bằng `Get-Content -Raw`, hoặc chạy qua `cmd /c`.

### B.2 Nếu KHÔNG có thiết bị phần cứng (tủ thật) — **tình huống thường gặp nhất**

Đây là tình huống mặc định khi bảo vệ tại phòng: **không mang tủ theo được**. Cách xử lý:

> "Phần cứng không có tại phòng, nên tôi mô phỏng đúng bản tin mà firmware gửi lên — cùng topic,
> cùng payload. Backend không phân biệt được đâu là tủ thật và đâu là probe, vì giao thức là như
> nhau."

| Việc firmware làm | Lệnh giả lập | Kỳ vọng |
|---|---|---|
| Tủ báo kết nối | `node scripts\mqtt-probe.mjs status --plaintext` | `lockers.last_heartbeat` tăng |
| Tủ quét QR shipper | `node scripts\mqtt-probe.mjs shipper <token>` | `verified/shipper = 1` |
| Tủ quét mã vận đơn | `node scripts\mqtt-probe.mjs send <trackingCode> --locker=LOCKER_HN_03 --dev=LOCKER_HN_03` | `verified/order = 1` + `locker/open` |
| Khách nhập SĐT | `node scripts\mqtt-probe.mjs receive-phone 0988123456` | `verified/customer = n` |
| Cảm biến ngăn thay đổi | `node scripts\mqtt-probe.mjs pub "ptit/compartment/1/status" '{"locker_id":"khuon_vien","has_item":1,"door_closed":1,"weight":120.5}'` | `compartments` cập nhật |

**Lưu ý tiếng Việt:** `mqtt-probe.mjs` cần `--locker` và `--dev` cùng trỏ đúng tủ để quan sát
downlink. Nếu không thấy `RESULT payload=...`, tăng thời gian chờ: `--ms=12000`.

### B.3 Nếu frontend trắng trang / lỗi

| Triệu chứng | Xử lý |
|---|---|
| Trắng trang, console báo `Failed to fetch` | Backend chưa lên → làm B.0. Kiểm `http://localhost:8080/api/lockers` phải trả **401** (không phải lỗi kết nối). |
| `localhost:5173` không mở được | Vite chưa chạy: `cd frontend; npm.cmd run dev`. Kiểm cổng 5173. |
| Đăng nhập báo lỗi | Dùng nút điền nhanh; nếu vẫn lỗi, kiểm 3 tài khoản bằng mục 1.2. |
| Không thấy marker trên bản đồ | Bản đồ cần Internet để tải tile OpenStreetMap. Mất mạng thì marker vẫn còn (dữ liệu tủ từ API), chỉ nền bản đồ trắng. **Vẫn demo được** — nói rõ "nền bản đồ cần mạng, dữ liệu tủ thì không". |

### B.4 Nếu bước 4 (nhận hàng) hỏng

Cách ngắn nhất để chứng minh luồng nhận hàng mà không cần OTP:
```powershell
node scripts\mqtt-probe.mjs pub "ptit/rec/otp" '{"locker_id":"khuon_vien","otp":"<OTP 6 số>"}' --qos=1
```
hoặc đọc thẳng DB để chứng minh trạng thái đã đúng:
```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -uroot -p200220 -e "SELECT order_id,status,compartment_id FROM smart_locker_db.orders ORDER BY created_at DESC LIMIT 3; SELECT command_id,locker_id,compartment_id,command_type FROM smart_locker_db.command_logs ORDER BY sent_at DESC LIMIT 3;"
```

### B.5 Dọn dẹp sau demo (nếu hội đồng cho phép, hoặc trước khi chấm lại)

```powershell
& 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' -uroot -p200220 -e "DELETE FROM smart_locker_db.pickup_credentials WHERE order_id IN (SELECT order_id FROM smart_locker_db.orders WHERE product_name LIKE 'ORD-FIXTURE-DEMO%'); DELETE FROM smart_locker_db.orders WHERE product_name LIKE 'ORD-FIXTURE-DEMO%'; UPDATE smart_locker_db.compartments SET status='EMPTY';"
```

---

## PHẦN 4 — CÂU HỎI HỘI ĐỒNG CÓ THỂ HỎI

> Trả lời **thẳng**, không né. Ba giới hạn dưới đây đã được ghi trong `docs/GIOI-HAN-BAOMAT.md` —
> biết rõ giới hạn của mình là điểm cộng, không phải điểm trừ.

**Câu 1: "Broker MQTT là công cộng thì ai cũng mở được tủ à?"**

> **Đúng. Đây là giới hạn nghiêm trọng nhất còn tồn tại, em đã ghi rõ trong tài liệu.**
> Broker `broker.emqx.io` không kiểm danh tính người kết nối: ai biết tên topic đều publish được
> `ptit/{dev}/locker/open` với payload `<index>,deposit` và mở tủ **không cần qua backend**.
> Backend có kiểm tra đầy đủ, nhưng firmware subscribe **trực tiếp** topic đó nên không đi qua
> backend.
> **Hướng khắc phục (theo thứ tự):** (1) dựng broker riêng EMQX/Mosquitto; (2) bật TLS cổng 8883
> với chứng chỉ hợp lệ; (3) bật username/password hoặc mTLS cho từng thiết bị; (4) nạp ACL để mỗi
> thiết bị chỉ vào được topic của mình — file mẫu đã có trong repo tại `docker/emqx/acl.conf` nhưng
> **chưa nạp vào broker** và **chưa khớp base topic** (ACL viết cho `ptit/smartlocker/#`, hệ thống
> dùng `ptit/...`), nên phải sửa pattern trước khi nạp.

**Câu 2: "Tại sao dùng token opaque (lưu DB) thay vì JWT? JWT nhanh hơn mà?"**

> Đúng là JWT không cần query DB mỗi request nên nhanh hơn và scale ngang tốt hơn. Em chọn token
> opaque vì **thu hồi được ngay**: đăng xuất là set `revoked = true`, hiệu lực tức thì. JWT thì
> không thu hồi được trước hạn nếu không có thêm danh sách đen — mà danh sách đen thì lại phải
> query DB, mất luôn ưu điểm.
> **Giá phải trả:** mỗi request tốn **1 query DB** để kiểm token, và không scale ngang tốt bằng JWT
> khi có nhiều instance backend (mỗi instance đều phải hỏi DB chung). Với quy mô đồ án (một trường,
> vài chục tủ) thì đánh đổi này hợp lý; nếu lên quy mô lớn phải thêm cache (Redis) hoặc chuyển JWT
> + refresh token ngắn hạn.

**Câu 3: "Mật khẩu database có an toàn không?"**

> **Không, và em đã ghi rõ là giới hạn mức CAO.** Mật khẩu `root` từng nằm dạng mặc định trong
> `application.properties` và **vẫn còn trong lịch sử git** — ai clone repo đều xem được bằng
> `git log -p`. Đã sửa thành `${DB_PASSWORD:}` (không giá trị mặc định) và chuyển sang file
> `application-local.properties` đã gitignore, **nhưng lịch sử cũ thì chưa viết lại**.
> **Hướng khắc phục:** (1) đổi mật khẩu MySQL ngay — mật khẩu cũ coi như đã lộ; (2) tạo user riêng
> `smart_locker_app` chỉ có `SELECT/INSERT/UPDATE/DELETE` trên `smart_locker_db`, không dùng `root`;
> (3) nếu repo công khai thì phải viết lại lịch sử (`git filter-repo`) và force-push.

**Câu 4: "Firmware gửi thiếu `locker_id` thì sao? Có bị lẫn dữ liệu giữa các tủ không?"**

> **Có, đây là giới hạn mức TRUNG BÌNH.** Firmware hiện tại publish
> `ptit/chung2004/compartment/N/status` với payload **không có** `locker_id`. Backend xử lý bằng
> fallback: gán mọi bản tin đó cho `mqtt.locker.prefix.chung2004` (mặc định `LOCKER_HN_01`).
> Với **một tủ** thì chấp nhận được; từ **hai tủ trở lên** thì dữ liệu cảm biến của tủ này ghi đè
> trạng thái tủ khác — sai `OCCUPIED/EMPTY`, sai trọng lượng, sai luồng chuyển đơn.
> **Khắc phục gốc:** sửa firmware để **mọi** payload nghiệp vụ đều kèm `locker_id` (một lần là xong).
> Trong lúc chờ: đổi property cho khớp tủ thật, và khi lên firmware mới thì **để trống** property để
> lỗi lộ ra thay vì bị che.

**Câu 5: "Nếu hai khách đặt cùng một ngăn cuối cùng thì sao? Có bán quá số ngăn không?"**

> Có ba lớp chặn: (1) `available_slots` trên lịch biểu bị kiểm `<= 0` trước khi nhận; (2)
> `findWithLockByLockerIdAndStatus` khoá bi quan (`SELECT ... FOR UPDATE`) các ngăn EMPTY, nên hai
> request đồng thời thì chỉ một thắng; (3) nếu không còn ngăn phù hợp kích thước thì `selectSuitable
> Compartment` trả `null` và hệ thống từ chối bằng thông báo nghiệp vụ.
> **Em đã kiểm chứng bằng cách phá code:** bỏ chốt `available_slots` → 2 test đỏ; bỏ chốt
> `assignedComp == null` → code nổ `NullPointerException` và 2 test đỏ với thông điệp *"LỖI LẬP
> TRÌNH"*, đúng như mong đợi.

**Câu 6: "Tại sao cùng một lỗi mà lúc trả 400, lúc trả 409, lúc 404? Sao không thống nhất?"**

> Đó là chủ đích: phân biệt **loại** lỗi để client xử lý đúng.
> - **404** = không tìm thấy tài nguyên (đơn không tồn tại, đơn không thuộc trạm này).
> - **409** = tài nguyên tồn tại nhưng **trạng thái hiện tại** không cho phép (đơn đã nạp rồi, mã đã
>   khoá, sai số điện thoại chủ đơn).
> - **400** = request sai cú pháp/thiếu tham số, hoặc vi phạm kiểm tra cơ bản.
> **Giá phải trả (đã ghi trong tài liệu kiến trúc):** 23 chỗ còn ném `RuntimeException` trần chưa
> gắn nhãn nên vẫn ra **400** — API chưa nhất quán hoàn toàn. Và client cũ nào hard-code
> `if (status === 400)` để hiện thông báo sẽ **không bắt được 409**, phải sửa thành kiểm
> `status >= 400`. Em giữ 400 cho các chỗ chưa gắn nhãn đúng để **không phá client đang chạy**.

**Câu 7: "Token QR shipper sống 60 giây. Nếu mạng chậm quá 60 giây thì sao?"**

> Thì tủ từ chối và shipper phải bấm tạo lại — đúng thiết kế, vì token ngắn là để chống chụp lại
> màn hình dùng lại. Backend kiểm **cả** `is_verified` **và** `expired_at > now()`, đồng thời lọc
> theo `locker_id`, nên token xác thực ở tủ A **không** mở được tủ B (lỗi cross-locker đã vá và có
> test khoá lại).

**Câu 8: "Vì sao chọn MySQL chứ không phải PostgreSQL / MongoDB?"**

> MySQL vì cần **giao dịch ACID** và **khoá bi quan** (`SELECT ... FOR UPDATE`) cho bài toán giữ chỗ
> ngăn — đây là yêu cầu cứng, không phải sở thích. Dữ liệu có quan hệ rõ ràng (đơn → ngăn → tủ →
> người dùng) nên mô hình quan hệ phù hợp hơn document store. PostgreSQL cũng làm được và mạnh hơn
> về kiểu dữ liệu, nhưng nhóm đã quen MySQL và môi trường lab có sẵn. **Đánh đổi:** MySQL yếu hơn
> PostgreSQL ở JSONB và window function, nhưng đồ án không cần hai thứ đó.

---

## PHỤ LỤC — NHẬT KÝ 3 LẦN CHẠY THẬT

Phần này ghi lại **kết quả đo thật** để chứng minh kịch bản trên đã chạy được, không phải viết suông.

### 3 lần chạy toàn bộ luồng tự động (18 bước: API + MQTT)

| Lần | Thời gian | Kết quả | Đơn tạo ra |
|---|---|---|---|
| 1 | **13,8 s** | **18/18 đạt** | `ORD-60240A13` → `COMPLETED` |
| 2 | **12,3 s** | **18/18 đạt** | (đã dọn) |
| 3 | **12,9 s** | **18/18 đạt** | `ORD-3441621E` → `COMPLETED` |

Kiểm DB sau lần 1 (số thật): `status=COMPLETED`, `compartment_id=6`, `tracking_code=TRACK-DEMO-1`,
`shipper_reserved_at≠NULL`, `deposited_at≠NULL`, ngăn về `EMPTY`, credential `is_used=1`,
`command_logs` có 3 dòng `OPEN_DOOR` trên `LOCKER_HN_03`.

### 3 lần chạy phần giao diện (8 bước: trình duyệt thật qua CDP)

| Lần | Thời gian | Kết quả |
|---|---|---|
| 1 | **27,4 s** | **8/8 đạt** |
| 2 | **27,2 s** | **8/8 đạt** |
| 3 | **27,3 s** | **8/8 đạt** |

Các bước UI đo được: trang đăng nhập có 2 ô input; đăng nhập bằng nút điền nhanh → `POST
/api/auth/login` **200**; có phiên + thấy tên shipper; bản đồ Leaflet render **1 container, 10
marker**, có tên tủ và địa chỉ thật; tab Shipper `GET /api/shipper/orders/pending` **200**; panel
"Đặt trước ngăn" + nút "Sinh Mã QR" hiện đúng; sinh QR → `POST /api/shipper/token/generate`
**200**, không có token giả `SHIPPER-TOKEN-`; **0 exception** trong console.

### Bước KHÔNG demo được tại máy này

| Bước | Vì sao | Cách thay thế |
|---|---|---|
| **Tủ bung cửa thật** (bước 3, 4) | Không có thiết bị ESP32 + solenoid tại máy | Đã đo gián tiếp: MQTT `locker/open` = `1,deposit` / `0,pickup` (đúng chỉ số + mode) và `command_logs` +1. Muốn demo trực tiếp thì dùng `scripts/mqtt-probe.mjs` giả lập firmware (xem B.2). |
| **Quét QR bằng camera GM65** | Không có đầu đọc mã vạch | Bấm nút "Quét Mã Kiện" trên web (mô phỏng thao tác quét) hoặc phát bản tin qua probe. |
| **Cân nặng HX711 / công tắc cửa MC-38** | Không có phần cứng | Phát bản tin `compartment/N/status` qua probe với `weight`/`door_closed` mong muốn. |
| **Nền bản đồ OpenStreetMap** | Cần Internet tải tile | Marker và dữ liệu tủ lấy từ API nên vẫn hiện; chỉ nền bản đồ trắng. |

> **Cách nói khi bảo vệ:** "Ba bước cuối của luồng giao tiếp với phần cứng được kiểm bằng cách phát
> đúng bản tin MQTT mà firmware gửi — cùng topic, cùng payload. Backend không phân biệt được nguồn,
> nên đây là kiểm chứng tương đương ở tầng giao thức. Phần cơ cấu chấp hành (solenoid bật) là phần
> duy nhất cần tủ thật, và em có video/log chạy thật."
