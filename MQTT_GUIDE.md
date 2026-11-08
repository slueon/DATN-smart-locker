# Hướng dẫn MQTT - Smart Locker

Tài liệu này mô tả cách firmware tủ giao tiếp với backend qua MQTT, cách theo dõi bằng MQTTX, tên topic, payload và ý nghĩa của từng bản tin.

## 1. Thông tin chung

- Locker ID hiện cấu hình là `khuon_vien`. Thay `{id}` trong tài liệu bằng Locker ID thực tế của tủ.
- **Topic UPLINK (tủ gửi lên) là topic chung, KHÔNG có `{id}`** — ví dụ `ptit/qr/order`. Locker ID nằm trong `locker_id` của payload. Riêng `status` xem mục 3.1.
- **Topic DOWNLINK (backend gửi xuống) có `{id}`** — ví dụ `ptit/khuon_vien/verified/order`, để lệnh chỉ đến đúng tủ nhận.
- Topic phân biệt chữ hoa/chữ thường. Firmware hiện dùng topic chữ thường.
- **Tủ gửi lên backend:** payload thường là JSON có `locker_id`. Ngoại lệ là topic trạng thái kết nối `status`, gửi chuỗi `ONLINE`/`OFFLINE`.
- **Backend gửi xuống tủ:** payload là chuỗi thuần, không bọc JSON.
- Tủ chỉ subscribe các topic dưới `ptit/{id}/`; do đó kết quả xác minh/lệnh mở gửi vào topic của sai Locker ID sẽ không được tủ nhận.
- Các topic nghiệp vụ dùng QoS 1 (giao ít nhất một lần), vì vậy backend nên xử lý lặp an toàn, đặc biệt với event và lệnh có tác động.
- Các topic dưới đây là hợp đồng firmware/backend. Khi đổi tên hoặc payload phải cập nhật cả hai phía.

## 2. Kết nối broker

Thiết lập firmware hiện tại:

| Thuộc tính | Giá trị |
|---|---|
| Broker | `broker.emqx.io` |
| Giao thức | MQTT over TLS |
| URI | `mqtts://broker.emqx.io` |
| Cổng MQTT TLS | `8883` |
| Client ID của firmware | Locker ID, ví dụ `khuon_vien` |

Firmware đồng bộ giờ qua SNTP trước khi kết nối TLS. Nếu đồng bộ giờ thất bại, MQTT không được khởi động.

Broker EMQX công cộng phù hợp cho thử nghiệm. Không dùng broker công cộng để vận hành dữ liệu thật: topic không có tính riêng tư/ACL của hệ thống và người khác có thể publish nếu broker cho phép. Khi triển khai thực tế, dùng broker riêng, tài khoản riêng và ACL giới hạn quyền theo Locker ID.

## 3. Topic tủ publish lên backend

MQTT QoS của các bản tin publish nghiệp vụ là 1. Payload JSON được firmware bổ sung `locker_id` tự động, không cần ứng dụng TFT tự thêm trường này.

> **QUY ƯỚC CHIỀU DỮ LIỆU (quan trọng)**
> - **Uplink (tủ → backend): topic CHUNG, KHÔNG chứa Locker ID.** Nhiều tủ cùng publish lên một topic; bản tin nào của tủ nào thì đọc `locker_id` trong payload. Nhờ vậy backend chỉ cần subscribe một lần cho mọi tủ, và thêm tủ mới không phải sửa cấu hình subscribe.
> - **Downlink (backend → tủ): topic RIÊNG từng tủ, CÓ `{id}`.** Lệnh chỉ được phát vào đúng tủ nhận, tránh mở nhầm tủ khác. Xem mục 4.
> - Ngoại lệ duy nhất ở uplink là `status` (mục 3.1) — xem ghi chú ngay dưới.

### 3.1 Kết nối và heartbeat

| Topic | Payload | Khi nào được gửi | Ý nghĩa |
|---|---|---|---|
| `ptit/status` | `ONLINE` hoặc `OFFLINE` | `ONLINE` khi kết nối và mỗi 30 giây; `OFFLINE` do Last Will khi mất kết nối bất thường | Theo dõi trạng thái kết nối của tủ. Chuỗi thuần, retained, QoS 1. |

Ngoại lệ: `status` là chuỗi thuần nên **không mang `locker_id`**. Hai cách firmware có thể dùng, backend chấp nhận cả hai:

| Cách | Topic | Payload | Backend xử lý |
|---|---|---|---|
| Khuyến nghị | `ptit/{id}/status` | `ONLINE` / `OFFLINE` | Lấy Locker ID từ chính topic |
| Tương thích firmware hiện tại | `ptit/status` | `ONLINE` / `OFFLINE` | Không đọc được tủ nào → gán tủ mặc định + log WARN (vẫn cập nhật nhịp tim) |

Ví dụ với ID `khuon_vien`: `ptit/khuon_vien/status`.

### 3.2 QR, thông tin nhận hàng và thao tác giao diện

Tất cả topic dưới đây là **topic chung, không chứa `{id}`**. Locker ID nằm trong `locker_id` của payload.

| Topic | Payload mẫu | Ý nghĩa |
|---|---|---|
| `ptit/qr/shipper` | `{"locker_id":"khuon_vien","qr":"<mã QR shipper>"}` | Mã QR shipper quét từ TFT. Backend xác minh rồi publish kết quả lên `verified/shipper`. |
| `ptit/qr/order` | `{"locker_id":"khuon_vien","qr":"<mã vận đơn>"}` | Mã vận đơn trên nhãn kiện hàng. Backend tra đơn: nếu đơn đã được shipper đặt trước ngăn thì publish `1`; nếu chưa thì publish `0`. |
| `ptit/qr/receive` | `{"locker_id":"khuon_vien","qr":"<mã QR nhận hàng>"}` | Mã QR khách dùng để nhận hàng. Backend xác minh; nếu hợp lệ gửi lệnh mở theo luồng nhận hàng. |
| `ptit/receive/phone` | `{"locker_id":"khuon_vien","phone":"090..."}` | Số điện thoại khách nhập. Backend phản hồi số đơn qua `verified/customer`. |
| `ptit/receive/otp` | `{"locker_id":"khuon_vien","otp":"123456"}` | OTP khách nhập. Backend xác minh OTP. |
| `ptit/session/cancel` | `{"locker_id":"khuon_vien","action":"cancel_send"}` | Tín hiệu hủy thao tác. `action` phân biệt: `cancel_send`, `cancel_receive`, `cancel_order_scan`, `cancel_receive_phone`, `cancel_receive_qr`, `cancel_receive_otp`. |
| `ptit/locker/scan_order_qr/request` | `{"locker_id":"khuon_vien","action":"scan_order_qr"}` | Báo backend bắt đầu luồng quét QR đơn hàng; đây không phải nội dung QR. QR thực tế gửi trên `qr/order`. |
| `ptit/receive/scan_qr/request` | `{"locker_id":"khuon_vien","action":"scan_receive_qr"}` | Báo backend bắt đầu luồng quét QR nhận hàng; QR thực tế gửi trên `qr/receive`. |
| `ptit/locker/select_compartment` | `{"locker_id":"khuon_vien","compartment":0,"qr":"<mã vận đơn>"}` | Shipper chọn ngăn trong nhánh **không có đặt trước**. Tủ mở ngăn ngay tại thao tác chọn và gửi thông tin ngăn/đơn cho backend lưu. `compartment` bắt đầu từ 0. Backend **chỉ ghi nhận, không phát lệnh mở** cho lần chọn này. |

QR shipper, QR đơn và QR nhận hàng có topic riêng để backend không nhầm mục đích của mã.

### 3.3 Trạng thái ngăn và sự kiện giao dịch

`N` trong topic là số ngăn bắt đầu từ **1** (ngăn 1 hoặc ngăn 2).

| Topic | Payload mẫu | Ý nghĩa |
|---|---|---|
| `ptit/compartment/N/status` | `{"locker_id":"khuon_vien","has_item":1,"door_closed":1,"weight":120.5}` | Trạng thái hiện tại của ngăn. Firmware publish khi có thay đổi trạng thái hàng/cửa, hoặc gửi lại sau khi thoát bảo trì. Không phải heartbeat định kỳ. |
| `ptit/compartment/N/event` | `{"locker_id":"khuon_vien","status":"deposit_success","weight":120.5,"compartment":1}` | Sự kiện nghiệp vụ sau thao tác gửi/nhận hàng. `compartment` trong payload bắt đầu từ **1**. |

> **Firmware hiện tại** publish trạng thái ngăn theo dạng phẳng `ptit/chung2004/compartment/N/status` mà payload **không có `locker_id`**. Backend vẫn nhận được nhờ cấu hình `mqtt.locker.prefix.chung2004` (mặc định `LOCKER_HN_01`) — xem `application.properties`. Khi firmware chuyển sang topic chung có `locker_id` thì đặt cấu hình đó rỗng.

Các trường status:

- `has_item`: `1` có hàng, `0` không phát hiện hàng.
- `door_closed`: `1` cửa đóng, `0` cửa mở.
- `weight`: trọng lượng do loadcell đo, đơn vị gram.

Các loại event hiện firmware gửi:

| `status` | Trường bổ sung | Ý nghĩa |
|---|---|---|
| `deposit_success` | `weight`, `compartment` | Shipper đã đặt hàng và đóng cửa; cân phát hiện hàng. |
| `deposit_cancelled` | `reason:"no_item_detected"`, `compartment` | Cửa đóng nhưng không phát hiện hàng. |
| `pickup_success` | `door_closed`, `compartment` | Khách lấy hàng thành công. `door_closed` là `0` nếu xác nhận khi cửa còn mở, hoặc `1` nếu xác nhận sau khi đóng cửa. |
| `item_uncollected` | `weight`, `compartment` | Cửa đã đóng nhưng hàng vẫn còn trong ngăn. |

`N` trong topic status/event tính từ 1, còn chỉ số `compartment` trong lệnh mở và bản tin chọn ngăn tính từ 0. Backend cần chuyển đổi nếu lưu theo số ngăn bắt đầu từ 1.

## 4. Topic backend publish xuống tủ

Firmware subscribe các topic dưới đây theo QoS 1. Payload gửi xuống là **Plaintext**, không phải JSON.

| Topic | Payload | Ý nghĩa và phản ứng của tủ |
|---|---|---|
| `ptit/{id}/verified/shipper` | `1` / `0` | Kết quả xác minh shipper: `1` mở màn hình chọn phương thức gửi; `0` báo QR shipper không hợp lệ. |
| `ptit/{id}/verified/order` | `1` / `0` | Kết quả tra lịch đặt trước cho QR đơn: `1` backend tiếp tục gửi lệnh mở ngăn đã đặt; `0` TFT hiển thị các ngăn khả dụng để shipper chọn. |
| `ptit/{id}/verified/customer` | số nguyên `-1`, `0` hoặc `n` | Kết quả tra số điện thoại: `-1` không tồn tại; `0` không có đơn; số dương `n` là số đơn tìm được. |
| `ptit/{id}/verified/qr_otp/failed` | `-1` | QR/OTP nhận hàng không hợp lệ; TFT hiện thông báo sai mã. Giao diện hiện tại điều hướng về màn hình nhập OTP. |
| `ptit/{id}/locker/open` | `<index>,<mode>` ví dụ `0,deposit` hoặc `1,pickup` | Mở ngăn. `index` bắt đầu từ 0; `mode` là `deposit` khi gửi hàng hoặc `pickup` khi nhận hàng. Tủ bắt đầu theo dõi giao dịch để gửi event cảm biến. |
| `ptit/{id}/maintenance/locker` | `1` / `0` | Bật/tắt bảo trì toàn tủ. Khi bật, tủ khóa luồng thao tác thường và hiện màn hình bảo trì. Nên publish retained để khôi phục trạng thái sau reconnect. |
| `ptit/{id}/maintenance/compartment` | `<index>,<state>` ví dụ `0,1` hoặc `1,0` | Bật/tắt bảo trì một ngăn. Index bắt đầu từ 0; state `1` là bảo trì, `0` là hoạt động. Nên publish retained. |

### Lưu ý lệnh mở ngăn

- Ngăn đã đặt trước: sau `verified/order = 1`, backend xác định ngăn đã đặt và gửi `locker/open` với mode `deposit`.
- Không có đặt trước: sau `verified/order = 0`, shipper chọn ngăn trên TFT. Firmware **tự mở ngăn ngay** rồi publish `locker/select_compartment` cùng QR đơn cho backend lưu. Backend không cần gửi thêm `locker/open` cho lựa chọn này.
- Nhận hàng: sau khi backend xác minh đúng, backend gửi `locker/open` với mode `pickup`.
- Không gửi `locker/open` retained; đây là lệnh tức thời, không nên được phát lại khi client reconnect.

## 5. Cách theo dõi và thử bằng MQTTX

### Import cấu hình theo dõi

1. Trong MQTTX, chọn **Import Data**.
2. Chọn định dạng **JSON** và import file [`mqttx-khuon_vien-import.json`](./mqttx-khuon_vien-import.json).
3. Kết nối profile **Smart Locker khuon_vien**.
4. File có subscription riêng cho các topic tủ gửi lên và topic phản hồi/lệnh. Để xem nhanh toàn bộ traffic, có thể thêm một subscription `ptit/khuon_vien/#` (QoS 1).

MQTTX import tạo profile và danh sách **subscriptions** để theo dõi. Nó không tự publish lệnh, không cấu hình backend, và cũng không tự thay đổi topic firmware.

### Publish thử một bản tin backend -> tủ

Trong MQTTX, chọn **Plaintext**, nhập topic đầy đủ và payload tương ứng. Thử nghiệm lệnh mở khóa có tác động phần cứng; chỉ dùng khi đang kiểm soát tủ:

| Mục đích thử | Topic | Payload |
|---|---|---|
| Hiển thị các ngăn khả dụng | `ptit/khuon_vien/verified/order` | `0` |
| Báo QR đơn đã đặt trước | `ptit/khuon_vien/verified/order` | `1` |
| Mô phỏng shipper đã xác minh | `ptit/khuon_vien/verified/shipper` | `1` |
| Bật bảo trì tủ | `ptit/khuon_vien/maintenance/locker` | `1` |
| Tắt bảo trì tủ | `ptit/khuon_vien/maintenance/locker` | `0` |
| Bảo trì ngăn 1 | `ptit/khuon_vien/maintenance/compartment` | `0,1` |
| Cho ngăn 1 hoạt động | `ptit/khuon_vien/maintenance/compartment` | `0,0` |

Với trạng thái bảo trì, bật **Retain** để firmware nhận lại trạng thái khi reconnect. Không bật Retain cho kết quả xác minh hay lệnh mở vì đây là phản hồi theo một giao dịch cụ thể, không phải trạng thái bền vững. Khi thử thủ công, nên tạm dừng backend để tránh backend đồng thời phản hồi các bản tin test.

## 6. Luồng nghiệp vụ đầy đủ

### Shipper gửi hàng

1. TFT bắt đầu quét shipper; firmware publish QR lên `qr/shipper`.
2. Backend publish `1` hoặc `0` lên `verified/shipper`.
3. Khi xác minh thành công, shipper chọn quét QR đơn. Firmware publish request `locker/scan_order_qr/request`, sau đó publish mã lên `qr/order`.
4. Backend tra đơn và publish kết quả lên `verified/order`.
5. Nếu kết quả là `1`, backend gửi `locker/open` cho ngăn đã đặt với mode `deposit`.
6. Nếu kết quả là `0`, TFT hiển thị các ngăn trống khả dụng. Shipper chọn ngăn; firmware mở ngăn ngay và publish `locker/select_compartment` gồm mã đơn và ngăn được chọn.
7. Shipper đặt hàng, đóng cửa. Firmware kiểm tra cửa/loadcell và publish `deposit_success` hoặc `deposit_cancelled`.

### Khách nhận hàng

1. Khách nhập số điện thoại; firmware publish lên `receive/phone`.
2. Backend trả số đơn trên `verified/customer`.
3. Khách nhập OTP (`receive/otp`) hoặc quét QR (request `receive/scan_qr/request`, mã trên `qr/receive`).
4. Nếu xác minh đúng, backend gửi `locker/open` với mode `pickup`; nếu sai, backend gửi `verified/qr_otp/failed` với payload `-1`.
5. Firmware theo dõi thao tác lấy hàng và publish `pickup_success` hoặc `item_uncollected`.

## 7. Danh sách subscriptions firmware

Đây là các topic firmware chủ động subscribe khi kết nối MQTT:

```text
ptit/{id}/maintenance/locker
ptit/{id}/maintenance/compartment
ptit/{id}/verified/shipper
ptit/{id}/verified/order
ptit/{id}/verified/customer
ptit/{id}/locker/open
ptit/{id}/verified/qr_otp/failed
```

Các topic này nhận lệnh/kết quả từ backend. Những topic QR, nhận hàng, trạng thái ngăn và event là topic firmware **publish lên**, không phải topic firmware subscribe.

## 8. Troubleshooting nhanh

- **Không thấy bản tin:** kiểm tra thiết bị và MQTTX cùng broker/port, TLS đang bật. Topic uplink là topic **chung** (`ptit/qr/order`, `ptit/compartment/N/status`…), nên subscribe `ptit/#` để thấy hết; subscribe kiểu `ptit/{id}/...` chỉ thấy downlink.
- **Tủ không nhận kết quả backend:** kiểm tra topic downlink có đúng Locker ID, đúng chữ hoa/thường, và payload là chuỗi thuần như `0`, `1`, `-1`, `0,deposit`.
- **Backend không thấy QR/OTP:** kiểm tra subscription của backend; payload JSON đã có `locker_id`.
- **TFT báo không có ngăn trống:** ngăn có thể đang chứa hàng, cửa đang mở, ngăn bảo trì, hoặc loadcell bị lỗi.
- **Topic cũ vẫn hiện trong MQTTX:** xóa subscription cũ như `ptit/QR_send`, `ptit/rec/otp`; chúng không thuộc hợp đồng topic hiện tại.

## 9. Ghi chú tương thích backend

Hợp đồng trong tài liệu này: **uplink dùng topic chung không có `{id}`, Locker ID nằm trong `locker_id` của payload; downlink dùng topic riêng có `{id}`.** Backend phải publish/subscribe đúng tên. Tên topic MQTT không được tự động đổi giữa firmware và backend; sai khác dù chỉ chữ hoa/thường hoặc dấu gạch dưới cũng khiến hai phía không giao tiếp.

Backend hiện đọc thêm 3 tên cũ cho tương thích ngược (`ptit/QR_Shipper`, `ptit/QR_send`, `ptit/QR_rec` và các topic `ptit/rec/*`). Đó là lớp đệm để firmware đang chạy chưa phải nạp lại, **không phải** hợp đồng chính thức — firmware mới nên dùng tên trong mục 3.
