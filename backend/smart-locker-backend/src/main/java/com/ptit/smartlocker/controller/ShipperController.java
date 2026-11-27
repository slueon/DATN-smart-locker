package com.ptit.smartlocker.controller;

import com.ptit.smartlocker.dto.ApiResponse;
import com.ptit.smartlocker.dto.KioskEventDTO;
import com.ptit.smartlocker.dto.OrderDTO;
import com.ptit.smartlocker.dto.ShipperDTO;
import com.ptit.smartlocker.service.KioskEventService;
import com.ptit.smartlocker.service.ShipperService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/shipper")
public class ShipperController {

    private final ShipperService shipperService;
    private final KioskEventService kioskEventService;

    public ShipperController(ShipperService shipperService, KioskEventService kioskEventService) {
        this.shipperService = shipperService;
        this.kioskEventService = kioskEventService;
    }

    /**
     * Shipper bấm "Xác minh danh tính" trên Web Mobile -> Trả mã QR định danh CỐ ĐỊNH của shipper
     * (GĐ15/GĐ33: mỗi shipper một mã, không hết hạn; mỗi lần gọi chỉ mở phiên quét mới).
     *
     * <p><b>ĐÃ BỊT:</b> trước đây nhận `@RequestParam(defaultValue = "SHIPPER_001") shipperId`,
     * nên bất kỳ ai gọi endpoint cũng xin được mã QR định danh cho shipper bất kỳ (kể cả
     * SHIPPER_001) rồi đem quét tại tủ để mở quyền giao hàng. Nay `shipperId` lấy từ
     * danh tính đã đăng nhập (principal), client KHÔNG tự khai được.
     */
    @PostMapping("/token/generate")
    public ResponseEntity<ApiResponse<ShipperDTO.GenerateTokenResponse>> generateToken(
            java.security.Principal principal) {
        String shipperId = (principal != null && principal.getName() != null)
                ? principal.getName().trim()
                : "";
        if (shipperId.isEmpty()) {
            return ResponseEntity.status(401)
                    .body(ApiResponse.error("Chưa xác thực: vui lòng đăng nhập bằng tài khoản shipper!"));
        }
        ShipperDTO.GenerateTokenResponse response = shipperService.generateDynamicToken(shipperId);
        return ResponseEntity.ok(ApiResponse.ok("Mã QR định danh Shipper (mã cố định, không hết hạn) — quét tại tủ để xác thực", response));
    }

    /**
     * Tủ thông minh (GM65) quét mã QR động của Shipper để mở quyền giao hàng
     */
    @PostMapping("/token/verify")
    public ResponseEntity<ApiResponse<Boolean>> verifyToken(@RequestBody ShipperDTO.VerifyTokenRequest request) {
        try {
            boolean isValid = shipperService.verifyDynamicToken(request.getLockerId(), request.getDynamicToken());
            return ResponseEntity.ok(ApiResponse.ok("Xác thực Shipper thành công! Vui lòng quét kiện hàng.", isValid));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Shipper quét mã vận đơn kiện hàng và hoàn tất gửi đồ vào tủ
     * Có tích hợp kiểm tra cảm biến kép: Công tắc từ MC-38 và Cảm biến cân nặng HX711
     *
     * <p><b>GĐ28 — không {@code catch} tại đây nữa.</b> Trước đây khối {@code catch (Exception e)}
     * biến MỌI lỗi thành 400, nên chốt chặn "tủ đang bảo trì" (ném {@code BusinessException})
     * cũng ra 400 và client không phân biệt được "tủ đang bảo trì" với "request sai cú pháp".
     * Bỏ catch thì {@code GlobalExceptionHandler} ánh xạ đúng: {@code BusinessException} → 409,
     * {@code IllegalArgumentException}/{@code RuntimeException} → 400 như cũ. Giống cách
     * {@code PickupController} đã làm.
     */
    @PostMapping("/deposit")
    public ResponseEntity<ApiResponse<ShipperDTO.DepositResponse>> depositPackage(
            @RequestBody ShipperDTO.DepositPackageRequest request,
            java.security.Principal principal) {
        // Review bảo mật #8 — danh tính lấy từ phiên đăng nhập, không nhận từ client.
        ShipperDTO.DepositResponse response = shipperService.depositPackage(
                request, principal == null ? null : principal.getName());
        return ResponseEntity.ok(ApiResponse.ok(response.getMessage(), response));
    }

    /**
     * GĐ21 — danh sách khách hàng để shipper chọn khi tạo đơn hộ ("+ Thêm đơn").
     *
     * <p>Trước đây màn đó ghi cứng một tên khách nên mọi đơn tạo từ shipper đều gán cho cùng một
     * người. Endpoint này trả danh sách thật từ CSDL để tài khoản khách tạo thêm sau này cũng chọn
     * được.
     *
     * <p><b>Chỉ SHIPPER/ADMIN:</b> đây là dữ liệu cá nhân của khách (tên + SĐT). Mở cho CUSTOMER
     * là cho bất kỳ khách nào đọc được danh bạ khách của hệ thống. DTO cố ý không chứa
     * {@code password}/{@code role}.
     */
    @GetMapping("/customers")
    public ResponseEntity<ApiResponse<List<ShipperDTO.CustomerOptionResponse>>> getCustomers() {
        List<ShipperDTO.CustomerOptionResponse> customers = shipperService.getCustomerOptions();
        return ResponseEntity.ok(ApiResponse.ok(
                "Lấy danh sách khách hàng thành công (" + customers.size() + " khách)", customers));
    }

    /**
     * T3 — Danh sách đơn PENDING để shipper chọn đặt trước trên web.
     *
     * <p>Mỗi phần tử có {@code trackingCode} (= {@code tracking_code} nếu đã đặt, ngược lại
     * {@code order_id}) và {@code compartmentIndex} (null nghĩa là chưa giữ ngăn).
     */
    @GetMapping("/orders/pending")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getPendingOrders(
            @RequestParam(required = false) String lockerId,
            java.security.Principal principal) {
        List<OrderDTO.OrderResponse> response =
                shipperService.getPendingOrders(lockerId, principal.getName());
        return ResponseEntity.ok(ApiResponse.ok("Lấy danh sách đơn chờ gửi thành công", response));
    }

    /**
     * T3 — Đặt trước một ngăn cụ thể cho đơn PENDING (shipper chọn trên WEB, Q2).
     *
     * <p>GĐ21 — nhận thêm {@code reserveHours} (1 hoặc 2, bỏ trống = 2). Hạn giữ chỗ được lưu
     * RIÊNG trên đơn ({@code orders.reserve_expires_at}) chứ không đổi hằng số toàn cục, nên đổi
     * thẻ này không làm lệch hạn của những đơn đã đặt trước từ trước.
     */
    @PostMapping("/orders/{orderId}/reserve")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> reserveCompartment(
            @PathVariable String orderId,
            @RequestBody(required = false) OrderDTO.ReserveRequest request,
            java.security.Principal principal) {
        try {
            String trackingCode = request != null ? request.getTrackingCode() : null;
            Integer compartmentIndex = request != null ? request.getCompartmentIndex() : null;
            Integer reserveHours = request != null ? request.getReserveHours() : null;
            OrderDTO.OrderResponse response =
                    shipperService.reserveCompartment(orderId, trackingCode, compartmentIndex,
                            reserveHours, principal.getName());
            return ResponseEntity.ok(ApiResponse.ok(
                    "Đặt trước ngăn " + response.getCompartmentIndex() + " cho đơn " + orderId + " thành công!",
                    response));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * T3 — Huỷ đặt trước, nhả ngăn về EMPTY.
     */
    @DeleteMapping("/orders/{orderId}/reserve")
    public ResponseEntity<ApiResponse<Void>> cancelReserve(
            @PathVariable String orderId, java.security.Principal principal) {
        try {
            shipperService.cancelReserve(orderId, principal.getName());
            return ResponseEntity.ok(ApiResponse.ok(
                    "Đã huỷ đặt trước cho đơn " + orderId + " và nhả ngăn về trống.", null));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(ApiResponse.error(e.getMessage()));
        }
    }

    /**
     * Sự kiện phát sinh tại Kiosk của tủ thật — nguồn của popup "theo dõi tủ thật".
     *
     * <p><b>Hợp đồng với web:</b>
     * <ul>
     *   <li>Lần gọi ĐẦU TIÊN bỏ trống {@code after} → {@code events} rỗng, chỉ có
     *       {@code latestSeq}. Nhờ vậy mở tab không phát lại popup của lần test trước.</li>
     *   <li>Các lần sau gửi {@code after=<latestSeq>} vừa nhận → chỉ nhận sự kiện MỚI.</li>
     * </ul>
     *
     * <p><b>Quyền:</b> SHIPPER hoặc ADMIN (xem {@code SecurityConfig}). ADMIN cần đọc được vì
     * cùng một màn hình giám sát được dùng khi trực ca.
     *
     * <p>Bộ đệm gắn theo TỦ, mọi shipper đứng cùng tủ thấy cùng sự kiện phần cứng — <b>trừ</b>
     * sự kiện xác thực QR shipper (GĐ75 #9): SHIPPER_VERIFIED/SHIPPER_REJECTED của mã thuộc
     * shipper KHÁC bị lọc bỏ khi người gọi là SHIPPER. Trước đây shipper B quét QR ở tủ thì
     * màn hình shipper A cũng báo "Đã xác thực" và nút mở cửa sáng lên, bấm vào ra 400.
     * Sự kiện từ chối mã không tra được chủ ({@code shipperId == null}) vẫn trả cho mọi người.
     * ADMIN thấy tất cả.
     */
    @GetMapping("/kiosk-events")
    public ResponseEntity<ApiResponse<KioskEventDTO>> getKioskEvents(
            @RequestParam(required = false) String lockerId,
            @RequestParam(required = false) Long after,
            org.springframework.security.core.Authentication authentication) {
        List<com.ptit.smartlocker.dto.KioskEvent> events = kioskEventService.since(lockerId, after);
        boolean isShipper = authentication != null && authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_SHIPPER".equals(a.getAuthority()));
        if (isShipper) {
            String me = authentication.getName();
            events = events.stream()
                    .filter(e -> !(KioskEventService.SHIPPER_VERIFIED.equals(e.getType())
                                    || KioskEventService.SHIPPER_REJECTED.equals(e.getType()))
                            || e.getShipperId() == null
                            || e.getShipperId().equals(me))
                    .toList();
        }
        KioskEventDTO payload = KioskEventDTO.builder()
                .latestSeq(kioskEventService.latestSeq())
                .events(events)
                .build();
        return ResponseEntity.ok(ApiResponse.ok("Lấy sự kiện Kiosk thành công", payload));
    }

    /**
     * Shipper truy vấn danh sách bưu kiện quá hạn cần thu hồi
     */
    @GetMapping("/overdue-orders")
    public ResponseEntity<ApiResponse<List<OrderDTO.OrderResponse>>> getOverdueOrders(
            @RequestParam(required = false) String lockerId,
            java.security.Principal principal) {
        List<OrderDTO.OrderResponse> response =
                shipperService.getOverdueOrders(lockerId, principal.getName());
        return ResponseEntity.ok(ApiResponse.ok("Lấy danh sách đơn hàng quá hạn thành công", response));
    }

    /**
     * Shipper xác nhận thu hồi bưu kiện quá hạn về kho bãi và giải phóng ngăn tủ.
     *
     * <p><b>GĐ13 — đã bỏ {@code catch (Exception)}.</b> Trước đó mọi ngoại lệ bị nuốt và trả 400,
     * nên {@code BusinessException} ("đơn không ở trạng thái quá hạn") mất đúng mã 409 mà
     * {@code GlobalExceptionHandler} đã ánh xạ. Bấm "Thu hồi" lần hai phải ra 409 để client biết
     * đây là đơn đã xử lý, không phải request hỏng.
     *
     * <p><b>GĐ41 — BẮT BUỘC xác thực QR, và ADMIN mất quyền.</b> Trước GĐ41 endpoint này chỉ nhận
     * {@code orderId}: ai đăng nhập được cũng thu hồi được, mã QR ở tab thu hồi lại do client tự
     * bịa nên không có trong DB. Nay:
     * <ul>
     *   <li>nhận thêm {@code dynamicToken} — mã THẬT từ {@code /api/shipper/token/generate};</li>
     *   <li><b>danh tính lấy từ {@code Principal} của phiên đăng nhập</b>, TUYỆT ĐỐI không nhận
     *       {@code shipperId}/{@code username} từ query hay body (điều cấm #3);</li>
     *   <li>{@code SecurityConfig} giới hạn {@code hasRole("SHIPPER")} nên ADMIN bị chặn **trước
     *       khi** vào tới đây (điều cấm #2).</li>
     * </ul>
     */
    @PostMapping("/recall-overdue")
    public ResponseEntity<ApiResponse<Void>> recallOverdue(
            @RequestParam String orderId,
            @RequestParam(required = false) String dynamicToken,
            java.security.Principal principal) {
        shipperService.recallOverduePackage(
                orderId,
                dynamicToken,
                principal != null ? principal.getName() : null);
        return ResponseEntity.ok(ApiResponse.ok("Thu hồi bưu kiện " + orderId + " về kho bãi thành công!", null));
    }

    /**
     * GĐ51 — shipper TẠO một đơn quá hạn để demo/thử luồng thu hồi ("+ Thêm đơn quá hạn").
     *
     * <p><b>Vì sao ở đây chứ không phải ADMIN:</b> user chốt 17/11 — "nút thêm đơn quá hạn để ở tab
     * thu hồi hàng quá hạn của tài khoản shipper". Thu hồi là nghiệp vụ của shipper (GĐ41: ADMIN
     * không có quyền thu hồi), nên công cụ tạo dữ liệu cho luồng đó cũng thuộc shipper.
     *
     * <p><b>Danh tính người tạo lấy từ {@code Principal}</b> — không nhận {@code createdBy} từ body
     * (cùng luật với {@code recall-overdue}). {@code customerUsername} thì nhận từ body vì đó là
     * <i>đối tượng</i> của đơn, không phải danh tính người gọi.
     *
     * <p>Mã đơn + số ngăn trả về trong {@code data} để UI hiện ngay và tự chọn đơn mới.
     */
    @PostMapping("/overdue-orders")
    public ResponseEntity<ApiResponse<OrderDTO.OrderResponse>> createOverdueOrder(
            @RequestBody(required = false) ShipperDTO.CreateOverdueOrderRequest request,
            java.security.Principal principal) {
        String lockerId = request != null ? request.getLockerId() : null;
        String customerUsername = request != null ? request.getCustomerUsername() : null;

        OrderDTO.OrderResponse created = shipperService.createOverdueOrder(
                lockerId,
                customerUsername,
                principal != null ? principal.getName() : null);

        return ResponseEntity.ok(ApiResponse.ok(
                "Đã tạo đơn quá hạn " + created.getOrderId()
                        + " tại ngăn #" + created.getCompartmentIndex()
                        + " của " + created.getLockerName() + ".",
                created));
    }

    /**
     * GĐ46 — shipper mở cửa ngăn để LẤY hàng quá hạn ra (bấm "Mở Cửa Ngăn #N").
     *
     * <p><b>Trước GĐ46 nút này không gửi lệnh nào:</b> frontend chỉ phát tiếng solenoid bằng Web
     * Audio API rồi đổi state UI sang {@code DOOR_OPEN}, nên màn hình báo "cửa đang mở" trong khi
     * tủ thật vẫn khoá. Endpoint này là đường THẬT để mở cửa.
     *
     * <p><b>Điều cấm #1 — KHÔNG tái dùng {@code /api/lockers/{id}/compartments/{i}/unlock}:</b>
     * endpoint đó chỉ ADMIN và nó đặt ngăn {@code EMPTY} ngay lúc mở, tức báo "ngăn trống" trong khi
     * hàng còn trong tủ. Ở đây đơn vẫn {@code OVERDUE}, ngăn vẫn {@code OCCUPIED}.
     *
     * <p><b>Danh tính lấy từ {@code Principal}</b> (như {@code recall-overdue}) — không nhận
     * {@code shipperId} từ query/body.
     */
    @PostMapping("/recall-overdue/open")
    public ResponseEntity<ApiResponse<Void>> openForRecall(
            @RequestParam String orderId,
            @RequestParam(required = false) String dynamicToken,
            java.security.Principal principal) {
        boolean daPhat = shipperService.openForRecall(
                orderId,
                dynamicToken,
                principal != null ? principal.getName() : null);

        // Không phát được lệnh (broker chưa kết nối) KHÔNG được báo thành công: frontend chỉ đổi
        // sang `DOOR_OPEN`/phát tiếng khi server xác nhận, đúng yêu cầu "giống nút mở khẩn cấp"
        // (AdminTab báo "cửa VẪN ĐANG ĐÓNG" khi lỗi).
        if (!daPhat) {
            throw new com.ptit.smartlocker.exception.BusinessException(
                    "Chưa kết nối được tới tủ " + orderId
                            + " — lệnh đã ghi nhật ký nhưng cửa VẪN ĐANG ĐÓNG. Vui lòng thử lại.");
        }
        return ResponseEntity.ok(ApiResponse.ok(
                "Đã gửi lệnh mở cửa ngăn để thu hồi bưu kiện " + orderId + "!", null));
    }
}
