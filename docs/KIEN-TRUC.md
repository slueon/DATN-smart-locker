# KIẾN TRÚC — GIẢI THÍCH "TẠI SAO"

> Tài liệu này **không** mô tả lại code. Mỗi mục trả lời câu hỏi hội đồng hay hỏi: *"tại sao lại chọn cách này, và cái giá phải trả là gì?"*
> Cấu trúc mỗi mục: **Vấn đề → Cách chọn → Đánh đổi**. Đánh đổi ghi cả mặt xấu.
> Đối chiếu code ghi kèm tên file để người đọc kiểm lại được.

---

## 1. Vì sao dùng token opaque lưu DB thay vì JWT

**File:** `service/AuthService.java` (`issueSession`), `config/TokenAuthFilter.java`, `entity/AuthSession.java`

### Vấn đề
Cần xác thực 23 API nhưng **phải thu hồi được ngay** khi tài khoản bị khoá hoặc shipper/nhân viên nghỉ việc. JWT là stateless: đã phát ra thì có hiệu lực tới khi hết hạn, muốn thu hồi phải có thêm blacklist — mà blacklist thì cũng là state trong DB, tức là quay lại đúng vấn đề.

### Cách chọn
Token **opaque**: 32 byte `SecureRandom` → Base64URL 43 ký tự, lưu **nguyên chuỗi** vào bảng `auth_sessions` cùng `user_id`, `role`, `expires_at` (TTL 8 giờ), `revoked`. Mỗi request, `TokenAuthFilter` tra `findActiveByToken(token, now)` — 1 truy vấn điểm trên `UNIQUE INDEX`, **không** scan bảng.

### Đánh đổi
- **Mỗi request tốn 1 round-trip DB.** Với JWT thì không. Nhưng `token` có unique index nên đây là index seek, không phải scan; hệ thống này lưu lượng thấp (một trường, vài chục shipper) nên hoàn toàn chấp nhận được.
- **Backend không scale ngang dễ như JWT** — mọi instance đều phải đọc cùng một DB. Đây là cái giá thật của quyết định này.
- **Mất DB là mất hết phiên** (mọi người phải đăng nhập lại). Với JWT thì phiên sống sót.
- Đổi lại: **thu hồi tức thì**. Chỉ cần set `revoked=true` (hoặc xoá dòng) là token chết ngay ở request kế tiếp, không phải chờ 8 giờ.

---

## 2. Vì sao uplink topic chung không có `{id}`, downlink thì có

**File:** `service/MqttService.java` (`topic()`, `deviceIdOf()`, `isDownlinkTopic()`), `MQTT_GUIDE.md` mục 3–4

### Vấn đề
Broker dùng chung cho N tủ. Phải trả lời hai câu ngược nhau: *làm sao một tủ gửi dữ liệu lên mà backend biết đó là tủ nào?* và *làm sao lệnh mở tủ chỉ đến đúng một tủ?*

### Cách chọn
- **Uplink** (tủ → backend): topic **chung**, không chứa id — `ptit/status`, `ptit/qr/order`, `ptit/compartment/N/status`. Tủ nào gửi thì nói trong payload: `{"locker_id":"Tu_1", ...}`.
- **Downlink** (backend → tủ): topic **riêng từng tủ**, có `{id}` — `ptit/{dev}/verified/order`, `ptit/{dev}/locker/open`.

Lý do bất đối xứng: uplink mà có id thì mỗi tủ phải biết mình là ai để publish đúng topic, và backend phải subscribe wildcard nhiều tầng. Còn downlink mà **không** có id thì **mọi tủ đều nhận lệnh và đều mở cửa** — đây là thảm hoạ, nên bắt buộc phải có id.

### Đánh đổi
- Mỗi bản tin uplink phải **parse JSON** để biết tủ nào → tốn CPU hơn, và **hỏng nếu firmware quên `locker_id`**. Chuyện này đang xảy ra thật: firmware hiện tại gửi `ptit/chung2004/compartment/N/status` **không có** `locker_id`, nên backend phải đệm bằng `mqtt.locker.prefix.chung2004` (xem `GIOI-HAN-BAOMAT.md` #3).
- **Đổi tên/id thiết bị phải sửa cấu hình**, không sửa code: `mqtt.locker.id.map=Tu_1:LOCKER_HN_01`.
- Backend subscribe `ptit/#` nên **nghe lại chính bản tin mình vừa phát** — phải có cơ chế chống echo (`isDownlinkTopic` + cửa sổ 5 giây). Nếu quên, mỗi lệnh mở tủ sẽ sinh thêm `device_events` rác.

**Một điểm không hoàn hảo đã biết:** id tủ trong topic downlink **không phải bí mật** (ai đọc `MQTT_GUIDE.md` cũng biết). Vì broker công cộng không xác thực, người ngoài vẫn publish được vào topic đó. Cách chặn thật là broker riêng + ACL, không phải giấu id.

---

## 3. Vì sao `reserve` dùng khoá bi quan (`SELECT FOR UPDATE`)

**File:** `service/ShipperService.java` (`reserveCompartment`), `repository/CompartmentRepository.java` (`findWithLockByLockerIdAndStatus`)

### Vấn đề
Hai shipper bấm "Đặt trước" cùng lúc cho cùng một ngăn trống. Nếu cả hai cùng đọc thấy ngăn `EMPTY` rồi cùng ghi `RESERVED` thì **hai đơn trỏ về cùng một ngăn** — đến lúc nạp hàng mới phát hiện, và một kiện hàng mất chỗ.

### Cách chọn
Dùng pessimistic write lock: `@Lock(PESSIMISTIC_WRITE)` trên `findWithLockByLockerIdAndStatus(lockerId, "EMPTY")` → phát `SELECT ... FOR UPDATE`. Transaction thứ hai **phải chờ** transaction thứ nhất commit, rồi đọc lại và thấy ngăn đã `RESERVED` → báo lỗi nghiệp vụ `400/409` thay vì cấp trùng.

Chọn pessimistic thay vì optimistic (`@Version`) vì: thao tác này **ngắn** (một lần bấm nút) và **xung đột thật sự hiếm** nhưng **hậu quả nặng**. Khoá bi quan cho kết quả "một người thắng, một người nhận thông báo rõ ràng" ngay lần đầu, thay vì bắt client retry.

### Đánh đổi
- **Giữ khoá DB trong lúc transaction chạy** → nếu code trong transaction chậm (gọi API ngoài, xử lý nặng), các shipper khác bị chặn. Hiện transaction này chỉ ghi 2 bảng nên rất ngắn.
- **Có thể deadlock** nếu hai transaction khoá nhiều ngăn theo thứ tự khác nhau. Code hiện tại khoá **toàn bộ** ngăn EMPTY của một tủ theo `ORDER BY comp_index ASC` nên thứ tự nhất quán — nhưng nếu sau này thêm chỗ khoá ngăn của **nhiều tủ** trong một transaction thì phải khoá theo thứ tự cố định.
- **`@Transactional` bắt buộc** — nếu ai gỡ annotation này, khoá mất tác dụng mà không có lỗi biên dịch nào báo.

---

## 4. Vì sao `ReservationTimeoutService` tách transaction theo từng đơn

**File:** `service/ReservationTimeoutService.java` (`releaseExpiredReservations` + `releaseOne`)

### Vấn đề
Tác vụ định kỳ nhả ngăn đặt trước quá hạn. Nếu bọc **cả lượt quét** trong một `@Transactional`, entity được nạp từ đầu lượt nằm trong persistence context suốt thời gian quét. Khi shipper vừa nạp hàng xong (đơn → `DEPOSITED`, ngăn → `OCCUPIED`) mà tác vụ vẫn đang giữ bản **cũ** (`PENDING`/`RESERVED`), nó sẽ ghi đè ngăn về `EMPTY` — **hàng nằm trong tủ nhưng DB ghi trống**.

Đây **không phải giả thuyết**: lỗi này đã xảy ra thật và đã sửa.

### Cách chọn
Tách làm hai bước:
1. **Quét**: một transaction ngắn **chỉ lấy id** rồi đóng ngay (`findExpiredShipperReservations`) — không giữ entity nào.
2. **Nhả từng đơn**: mỗi đơn một transaction riêng, **mở đầu bằng** `findByIdForReleaseWithLock` (`SELECT ... FOR UPDATE`) và **kiểm lại toàn bộ điều kiện trên bản ghi vừa khoá** — không tin danh sách đã quét.

Nhờ vậy nếu shipper vừa commit việc nạp hàng, khoá sẽ **chờ** giao dịch đó xong, lần đọc lại thấy `status != PENDING` → bỏ qua.

### Đánh đổi
- **Nhiều transaction hơn** (1 quét + M đơn) → overhead commit lớn hơn một transaction gộp. Chấp nhận được vì tác vụ chạy 5 phút/lần.
- **Không nguyên tử toàn lượt**: một đơn lỗi giữa chừng thì các đơn khác vẫn được xử lý. Đây là **chủ ý** (một đơn hỏng không được làm hỏng cả lượt quét), nhưng nghĩa là không có "rollback toàn bộ".
- **Cửa sổ race vẫn còn rất nhỏ**: giữa bước 1 (quét) và bước 2 (khoá) trạng thái có thể đổi — nhưng vì bước 2 **kiểm lại trên bản ghi đã khoá**, kết quả vẫn đúng. Đổi lại là code phức tạp hơn hẳn so với một vòng lặp đơn giản.
- Test khoá lại hành vi này bằng `verify(findByIdForReleaseWithLock)` + `never(findById)` — nếu ai đổi sang `findById` thường, test **FAIL** ngay (đã được `minh` phá thử xác nhận).

---

## 5. Vì sao `select_compartment` KHÔNG phát lệnh mở tủ

**File:** `service/MqttService.java` (`handleSelectCompartment`)

### Vấn đề
Nhánh dự phòng (shipper đến tủ mà chưa đặt trước): tủ publish `ptit/locker/select_compartment` kèm ngăn shipper vừa chọn trên TFT. Ban đầu backend phản ứng bằng cách gọi `publishCommand(...)` để mở ngăn đó.

**Đó là lỗi bảo mật.** Gói tin này **không đòi phiên shipper đã xác thực**. Ai publish được `select_compartment` (broker công cộng, ai cũng publish được) là mở được tủ. Ngoài ra nó còn **sai thiết kế ngay từ gốc**: theo `MQTT_GUIDE.md` và firmware (`main.c:136,146` gọi `open_lock(compartment_idx)`), **tủ đã tự mở bằng phần cứng** trước khi publish. Backend mở lần nữa là mở hai lần.

### Cách chọn
**Bỏ hẳn** `publishCommand` khỏi hàm này. Hàm chỉ còn: resolve tủ → ghi `device_events` → đọc ngăn (0-based → 1-based) → gán ngăn cho đơn nếu hợp lệ (đúng tủ, chống ghi đè khi đơn đã có ngăn khác) → log.

Xử lý lỗi bằng cách **xoá đường ra lệnh**, không phải bằng cách thêm kiểm tra quyền: không còn `publishCommand` thì không còn gì để mở tủ. Thêm `hasActiveShipperVerification` cũng được nhưng **không cần** — và nếu vẫn giữ lệnh mở thì bề mặt tấn công vẫn còn.

### Đánh đổi
- **Backend không còn kiểm soát việc mở tủ ở nhánh này** — firmware tự quyết. Nếu firmware lỗi, backend không biết. Niềm tin đặt vào phần cứng, không đặt vào server.
- **Phải tin firmware gửi `select_compartment` trung thực.** Nếu ai giả mạo gói tin này, họ đổi được **ngăn được gán cho đơn** (dữ liệu), dù **không mở được tủ**. Đó là đánh đổi có ý thức: sai dữ liệu gán ngăn nhẹ hơn nhiều so với mở tủ trái phép.
- **Khó test end-to-end** vì hành vi đúng là "không có gì xảy ra" — phải assert qua `command_logs` không tăng (đã làm trong `MqttTopicRoutingTests.selectCompartmentKhongPhatLenhMo`).

---

## 6. Vì sao test dùng DB riêng `smart_locker_tester`

**File:** `src/test/resources/application.properties`

### Vấn đề
Trước đây `mvnw test` chạy thẳng vào `smart_locker_db` — database dùng để **demo**. Mỗi lần chạy, test đẩy thêm hàng trăm dòng vào `device_events` và `auth_sessions`, tạo đơn rác, đổi trạng thái ngăn. Dữ liệu demo **trôi dần** mà không ai biết vì sao, và có lúc test **fail giả** do dữ liệu còn sót từ lần trước.

### Cách chọn
Test dùng database **riêng** `smart_locker_tester` với `ddl-auto=create-drop`:
- `create-drop` → mỗi lượt chạy tạo schema trắng, xong thì xoá → test **luôn bắt đầu từ trạng thái sạch**, không phụ thuộc dữ liệu còn sót.
- `mqtt.enabled=false` + `mqtt.lwt.enabled=false` → test **không phát lệnh thật** xuống tủ phần cứng qua broker công cộng.
- `app.security.enabled=true` → giữ nguyên luồng token để test kiểm được cả Authorization.

### Đánh đổi
- **Máy mới phải tạo DB trước một lần**: `CREATE DATABASE smart_locker_tester` (đã ghi trong comment file). Nếu quên, test fail với lỗi "Unknown database" — không phải lỗi code.
- **Test không phủ được dữ liệu thật**: `smart_locker_db` có 5 đơn, 10 tủ với dữ liệu GIS cụ thể; test thì dựng dữ liệu tối thiểu. Nghĩa là lỗi chỉ xuất hiện với dữ liệu thật (ví dụ đơn quá hạn từ hôm trước) **sẽ không bị test bắt**.
- **`create-drop` xoá sạch mỗi lượt** → muốn giữ dữ liệu test để điều tra sau khi fail thì phải đổi sang `update` tạm, nhưng **không được commit thay đổi đó** (đã ghi cảnh báo trong file).
- **Cẩn thận khi chạy song song**: hai tiến trình test cùng `create-drop` trên một DB sẽ **drop bảng của nhau** → lỗi `Table ... doesn't exist` / `Unable to select a bean to wrap`. Đã gặp thật; phải chắc không còn process java nào trước khi chạy.

---

## 7. Vì sao `GlobalExceptionHandler` giữ nguyên message tiếng Việt

**File:** `config/GlobalExceptionHandler.java`, `exception/BusinessException.java`, `exception/ResourceNotFoundException.java`

### Vấn đề
Trước đây **không có** `@ControllerAdvice` nào, và **41 chỗ** ném `RuntimeException` rải ở 4 service; mỗi controller lại tự `catch (Exception e)` trả `400 badRequest`. Hệ quả: **mọi** lỗi đều ra 400 giống nhau — client không phân biệt được "không tìm thấy đơn" với "vi phạm nghiệp vụ" hay "hệ thống lỗi".

> **Số đo thật sau GĐ3** (đếm bằng máy, liệt kê từng dòng trên `src/main`, commit `00f565b`):
> **53 điểm ném lỗi**, trong đó **20 đã gắn nhãn** (17 `BusinessException` → 409 + 3 `ResourceNotFoundException` → 404, tất cả ở `PickupService`) và **33 còn là `RuntimeException` trần** → 400, gồm **23** `throw new` + **10** `orElseThrow`:
>
> | File | `throw new RuntimeException` | `orElseThrow` RuntimeException |
> |---|---|---|
> | `AuthService` | 10 (L149, 169, 174, 178, 182, 208, 213, 217, 221, 225) | 1 (L129) |
> | `ShipperService` | 10 (L81, 85, 119, 126, 133, 137, 145, 153, 157, 499) | 4 (L78, 123, 130, 496) |
> | `OrderService` | 3 (L105, 121, 158) | 3 (L88, 152, 279) |
> | `LockerService` | 0 | 2 (L49, 104) |
> | **Tổng** | **23** | **10** |
>
> Con số **41** ở trên là **số đo TRƯỚC GĐ3** (khi chưa có 2 lớp exception mới); nó vẫn còn trong comment của `GlobalExceptionHandler` để ghi lại bối cảnh lịch sử. **Không** cộng `ResourceNotFoundException` vào phần "trần" — đó là exception đã gắn nhãn, trả 404 chứ không phải 400.

Nhưng siết lại thì có **ràng buộc sống còn**: **10 chỗ frontend** đọc `err.response.data.message` để hiện cho người dùng, và **12 chỗ trong test** assert trên câu chữ. Đổi một câu là vỡ cả hai phía.

### Cách chọn
Thêm advice ánh xạ **chỉ HTTP status**, giữ **nguyên văn** message:
| Ngoại lệ | HTTP |
|---|---|
| `ResourceNotFoundException` | 404 |
| `BusinessException` | 409 |
| `IllegalArgumentException` | 400 |
| `RuntimeException` trần (**33 chỗ** chưa gắn nhãn) | 400 — **giữ đúng hành vi cũ** |
| `Exception` khác | 500 |

Shape `ApiResponse` (`success`/`message`/`data`) **không thêm bớt field nào**.

Gắn nhãn ưu tiên `PickupService` (**20/20 điểm ném lỗi của file này** — luồng khách nhận hàng, dễ bị hỏi nhất): 3 chỗ "Không tìm thấy…" → `ResourceNotFoundException`, 17 chỗ còn lại → `BusinessException`. Câu chữ **không sửa một chữ**.

### Đánh đổi
- **Chỉ 20/53 điểm ném lỗi được gắn nhãn.** **33 điểm còn lại** vẫn là `RuntimeException` trần → vẫn ra 400 như cũ. Nghĩa là API **chưa nhất quán**: cùng là "không tìm thấy" nhưng `PickupService` trả 404 còn `OrderService` trả 400. Đây là nợ kỹ thuật **có ý thức** — sửa hết 53 điểm trong một lượt thì rủi ro vỡ client cao hơn lợi ích.
- **409 cho lỗi nghiệp vụ là lựa chọn có tranh cãi.** Nhiều API dùng 400 cho cả hai. 409 đúng nghĩa "trạng thái tài nguyên không cho phép thao tác" nhưng client cũ chỉ quen 400 — nếu client nào hard-code `if (status === 400)` thì sẽ không bắt được lỗi mới. Hiện frontend đọc `message` chứ không đọc status, nên an toàn; **nhưng đây là giả định phải kiểm lại nếu thêm client khác**.
- **500 che chi tiết lỗi** (message chung "Hệ thống gặp lỗi không mong muốn") để không lộ stack trace. Đánh đổi: người vận hành phải đọc log server mới biết nguyên nhân — ý đúng, nhưng debug khó hơn khi không có quyền xem log.
- **`IllegalArgumentException` map sang 400** có thể che lỗi lập trình thật: nếu code ném `IllegalArgumentException` do lỗi lập trình (không phải do input sai) thì client thấy 400 "lỗi của bạn" trong khi thực ra là lỗi server. Rủi ro nhỏ nhưng có thật.

---

## Tổng kết: những chỗ đánh đổi chưa trả xong

| Vấn đề | Trạng thái | Ghi chú |
|---|---|---|
| Broker công cộng không xác thực | **CHƯA SỬA** | `GIOI-HAN-BAOMAT.md` #1 — nghiêm trọng nhất |
| Mật khẩu DB từng trong git history | Đã bỏ khỏi code, **history còn** | `GIOI-HAN-BAOMAT.md` #2 |
| **33**/53 điểm ném lỗi còn là `RuntimeException` trần | **CHƯA GẮN NHÃN** | Mục 7 — API chưa nhất quán status |
| `findByLockerAndStatusWithCompartment` không fetch `locker` | Ổn **hiện tại** | Nếu thêm `getLocker()` vào vòng lặp → N+1 quay lại |
| Token opaque → 1 query DB/request | Chấp nhận | Mục 1 — không scale ngang tốt như JWT |
