# GIỚI HẠN BẢO MẬT ĐÃ BIẾT

> Tài liệu này ghi lại **đúng 3 giới hạn còn tồn tại** của hệ thống Smart Locker tại thời điểm
> bàn giao. Mỗi mục nêu: mô tả, tác động, hướng khắc phục, mức độ.
>
> Cập nhật: 2026-11-08. Người ghi: sóc (Dev).

---

## 1. Broker MQTT công cộng không xác thực

**Mức độ: NGHIÊM TRỌNG**

**Mô tả**
Backend và firmware cùng dùng broker công cộng `tcp://broker.emqx.io:1883` với cấu hình mặc
định trong `application.properties`:

```properties
mqtt.broker.url=${MQTT_BROKER_URL:tcp://broker.emqx.io:1883}
mqtt.username=${MQTT_USERNAME:}          # rỗng — kết nối ẩn danh
mqtt.password=${MQTT_PASSWORD:}          # rỗng
mqtt.ssl.enabled=${MQTT_SSL_ENABLED:false}   # truyền plaintext
mqtt.acl.enforce=${MQTT_ACL_ENFORCE:true}    # cờ này KHÔNG được broker thực thi
```

Broker không kiểm danh tính người kết nối. Bất kỳ ai trên Internet cũng subscribe được để
đọc toàn bộ luồng dữ liệu, và publish được vào các topic downlink.

**Tác động**
- Ai biết tên topic đều **publish được lệnh mở tủ**. Đây là đường mở tủ từ xa không cần
  đăng nhập: `ptit/{dev}/locker/open` với payload `<index>,deposit|pickup`.
- Đọc được dữ liệu nghiệp vụ phát lên broker: trạng thái ngăn, trọng lượng, sự kiện nạp/nhận,
  token QR định danh shipper (**từ GĐ15 token này KHÔNG có hạn — xem mục 6**).
- Kẻ tấn công có thể giả mạo bản tin `ptit/{dev}/compartment/N/status|event` để đẩy sai
  trạng thái ngăn/đơn hàng vào CSDL.
- Không có TLS ⇒ dữ liệu bị đọc/sửa trên đường truyền ở bất kỳ chặng nào.

**Hướng khắc phục**
1. Dựng broker riêng (EMQX/Mosquitto) thay vì dùng broker công cộng.
2. Bật TLS (`mqtt.ssl.enabled=true`, cổng 8883) với chứng chỉ hợp lệ.
3. Bật xác thực: đặt `mqtt.username` / `mqtt.password` (hoặc mTLS) và tạo tài khoản riêng
   cho backend và cho từng thiết bị.
4. Nạp ACL để mỗi thiết bị chỉ publish/subscribe được topic của chính nó. File mẫu **đã có
   trong repo** tại `docker/emqx/acl.conf` nhưng **chưa được nạp vào broker** — và **chưa khớp
   với topic đang dùng**: ACL viết cho prefix `ptit/smartlocker/#` trong khi hệ thống thật
   dùng `ptit/...` (base = `mqtt.topic.base=ptit`). Trước khi nạp phải sửa lại pattern trong
   ACL cho đúng base và đúng quy ước uplink/downlink (uplink chung không id, downlink
   `ptit/{dev}/...`).
5. Chỉ khi (1)–(4) xong mới nên đem hệ thống ra ngoài mạng nội bộ.

---

## 2. Mật khẩu CSDL từng nằm trong git history

**Mức độ: CAO**

**Mô tả**
`src/main/resources/application.properties` từng chứa mật khẩu MySQL dạng giá trị mặc định:

```properties
# Trước khi sửa (còn trong lịch sử git):
spring.datasource.password=${DB_PASSWORD:200220}
```

Đã sửa thành `${DB_PASSWORD:}` (không có giá trị mặc định) và chuyển mật khẩu sang
`application-local.properties` (đã gitignore). **Tuy nhiên các commit cũ vẫn còn nguyên chuỗi
mật khẩu trong lịch sử** — ai clone repo và xem `git log -p` đều đọc được.

**Tác động**
- Bất kỳ ai có bản sao repo đều biết mật khẩu `root` của MySQL.
- Nếu MySQL lắng nghe ra ngoài localhost, hoặc máy có nhiều người dùng, kẻ đó truy cập được
  toàn bộ `smart_locker_db` (đơn hàng, tài khoản, phiên đăng nhập, mã mở tủ).
- Mật khẩu này còn được dùng làm mặc định của `smart_locker_tester` — cùng một mật khẩu cho
  cả DB thật và DB test.

**Hướng khắc phục**
1. **Đổi mật khẩu MySQL** ngay (việc quan trọng nhất — mật khẩu cũ coi như đã lộ):
   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED BY '<mật-khẩu-mới>';
   FLUSH PRIVILEGES;
   ```
   Sau đó cập nhật `application-local.properties` và biến `TEST_DB_PASSWORD` cho môi trường test.
2. Nên tạo user riêng cho ứng dụng, không dùng `root`:
   ```sql
   CREATE USER 'smart_locker_app'@'localhost' IDENTIFIED BY '<mật-khẩu-riêng>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON smart_locker_db.* TO 'smart_locker_app'@'localhost';
   ```
3. Nếu repo là **công khai**, phải viết lại lịch sử để xoá chuỗi mật khẩu:
   ```bash
   git filter-repo --path backend/smart-locker-backend/src/main/resources/application.properties \
                   --invert-paths --replace-text passwords.txt
   ```
   rồi force-push và yêu cầu mọi người clone lại. Nếu repo nội bộ, đổi mật khẩu là đủ.

---

## 3. Firmware cũ gửi thiếu `locker_id`

**Mức độ: TRUNG BÌNH**

**Mô tả**
Firmware đang chạy trên thiết bị publish dữ liệu cảm biến lên topic dạng phẳng
`ptit/chung2004/compartment/N/status` với payload **không có** trường `locker_id`:

```json
{"has_item":0,"door_closed":1,"weight":0.0}
```

Theo nguyên tắc topic đã chốt, uplink phải mang `locker_id` trong payload. Backend xử lý
tình huống này bằng cách **đệm (fallback)** bằng property chuyên dụng:

```properties
# app/application.properties
mqtt.locker.prefix.chung2004=${MQTT_LOCKER_PREFIX_CHUNG2004:LOCKER_HN_01}
```

Khi topic có segment đầu là `chung2004` và payload không có `locker_id`, `MqttService`
gán bản tin cho tủ trong `mqtt.locker.prefix.chung2004` (= `LOCKER_HN_01`) — xem
`MqttService.java:92` và nhánh xử lý ở `MqttService.java:448-455`.

**Tác động**
- Mọi bản tin cảm biến của firmware cũ đều bị **gán vào một tủ duy nhất** (`LOCKER_HN_01`),
  không phân biệt được thiết bị nào gửi.
- Nếu triển khai từ 2 tủ trở lên, dữ liệu cảm biến của tủ này có thể **ghi đè trạng thái ngăn
  của tủ khác**, làm sai trạng thái `OCCUPIED`/`EMPTY`, sai trọng lượng và sai luồng chuyển
  đơn sang `DEPOSITED`/`COMPLETED`.
- Log WARN sẽ rất nhiễm, dễ che mất cảnh báo thật.
- Trạng thái nhịp tim (`last_heartbeat`) có thể bị ghi nhầm tủ, làm dashboard báo online sai.

**Hướng khắc phục**
1. **Sửa firmware** để mọi payload nghiệp vụ đều kèm `locker_id` (đúng contract):
   ```json
   {"locker_id":"Tu_1","has_item":0,"door_closed":1,"weight":0.0}
   ```
   Đây là cách khắc phục gốc, làm một lần là xong.
2. Trong thời gian chờ nạp firmware, đổi `mqtt.locker.prefix.chung2004` cho khớp tủ thật
   nếu tủ đó không phải `LOCKER_HN_01`:
   ```properties
   mqtt.locker.prefix.chung2004=${MQTT_LOCKER_PREFIX_CHUNG2004:LOCKER_HN_02}
   ```
   (Cách này chỉ đúng khi chỉ có **một** tủ mang tiền tố `chung2004`; từ 2 tủ trở lên buộc
   phải sửa firmware.)
3. Khi đã lên firmware mới, nên **để trống** `mqtt.locker.prefix.chung2004` để lỗi thiếu
   `locker_id` lộ ra ngay thay vì bị che.

---

## 6. Mã QR định danh shipper KHÔNG còn hạn — mất lớp chống Replay Attack

**Mức độ: CAO (đánh đổi do người dùng chốt)**

**Mô tả**

Trước GĐ15, token QR định danh shipper sống **60 giây**: `ShipperService.generateDynamicToken`
gán `expiredAt = now + 60s`, và `verifyDynamicToken` từ chối token quá hạn. GĐ15 đã **bỏ hoàn
toàn hạn này** theo yêu cầu của người dùng ("QR vĩnh viễn, KHÔNG giới hạn gì"):

- `expiredAt` được gán mốc `9999-12-31T23:59:59` (không dùng `NULL` vì cột `expired_at` là
  `NOT NULL` — giữ nguyên schema, không cần migration).
- Khối kiểm `now.isAfter(expiredAt)` trong `verifyDynamicToken` đã **bị xoá**.
- `GenerateTokenResponse.validitySeconds` trả `0` (nghĩa: không giới hạn).

**Tác động — phải nói rõ, không được giấu**

- **KHÔNG còn chống Replay Attack bằng hạn thời gian.** Ai **chụp ảnh** màn hình QR của shipper
  một lần là giữ được mã đó **vĩnh viễn**, dùng lại bất kỳ lúc nào.
- Nếu ảnh QR rò rỉ (chụp trộm, ảnh đăng nhóm chat, ảnh trong log màn hình), kẻ đó có thể tới
  tủ và mở quyền nạp hàng dưới danh nghĩa shipper thật.
- Đây là **đánh đổi có ý thức** của người dùng để tiện demo/trình diễn; nó **không phù hợp cho
  môi trường thật**.

**Hai lớp bảo vệ CÒN LẠI (bắt buộc giữ, đã kiểm hoạt động)**

1. **`isVerified`** — mỗi token chỉ quét được **đúng một lần**. Quét lại cùng token → lỗi
   "Mã QR Shipper này đã được sử dụng!". Đây là lớp DUY NHẤT còn lại chặn phát lại đúng một mã;
   **bỏ nó là mất hoàn toàn khả năng chống quét lại**.
2. **`lockerId`** — token được gắn tủ lúc quét. Token xác thực ở tủ A **không** mở được cửa tủ B
   (`findActiveVerifiedTokensForLocker` lọc theo `lockerId`), nên không dùng chéo tủ được.

**Lưu ý về thiết kế hiện tại:** mỗi lần bấm "Xem mã QR định danh" lại sinh một token MỚI; token
cũ **không bị thu hồi** và vẫn dùng được. Vì vậy số mã có hiệu lực tăng dần theo số lần bấm —
càng nhiều ảnh QR từng phát ra thì càng nhiều mã còn dùng được.

**Hướng khắc phục (nếu cần đưa lên môi trường thật)**

1. Khôi phục hạn ngắn (60–120 giây) và cho shipper tạo lại mã tại chỗ — đây là cách chuẩn.
2. Hoặc dùng QR một-lần ký bằng khoá bí mật, có `nonce` + hạn, để vừa chống chụp lại vừa chống
   phát lại.
3. Hoặc gắn mã với phiên đăng nhập + thiết bị, thu hồi mã cũ khi sinh mã mới.

**Ghi chú:** tài liệu này **trước đây không còn câu nào nói "đã chống Replay Attack nhờ QR 60s"**.
Nếu ở bất kỳ bản nháp/tài liệu nào khác còn câu đó thì **câu đó SAI** — hạn 60 giây chỉ làm giảm
cửa sổ tấn công, và từ GĐ15 nó đã bị bỏ hẳn.

---

## Ghi chú chung

Bốn giới hạn trên đều **đã biết và chấp nhận có kiểm soát** trong phạm vi đồ án. Khi đưa lên
môi trường thật, thứ tự xử lý nên là: **#1 (broker) → #2 (mật khẩu) → #3 (firmware) → #6 (QR
shipper vĩnh viễn)**, vì #1 là đường tấn công trực tiếp không cần bất kỳ thông tin đăng nhập nào,
còn #6 là đường tấn công cần tiếp cận vật lý hoặc ảnh chụp.
