import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
// GĐ15 — KHÔNG còn CircularTimer ở file này (mã QR shipper giờ vĩnh viễn, không đếm ngược).
// File `CircularTimer.jsx` VẪN GIỮ vì `CustomerPickupTab` + `ShipperRecallTab` còn dùng cho OTP khách.
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { shipperApi, lockerApi, orderApi } from '../services/api';
// GĐ40 — suy trạng thái tủ từ `lastHeartbeat` (dùng chung với màn admin, không tự viết ngưỡng mới).
import { getLockerHealth } from '../utils/lockerHealth';
import { ngayDiaPhuong } from '../utils/dateTime';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, Box, AlertCircle, X,
  DoorOpen, Weight, Layers, ArrowRight, User, PackageX,
  Barcode, Scan, Camera, Sparkles, ChevronRight,
  Shield, Volume2, Cpu, Clock, PlusCircle, Trash2
} from 'lucide-react';

/**
 * GĐ57 vòng sửa 1 — TẬP LOẠI SỰ KIỆN THÀNH CÔNG (so khớp CHÍNH XÁC, không dùng regex).
 *
 * <p><b>Vì sao:</b> bản vòng 1 lọc bằng `/VERIFIED|VALID|SUCCESS|SELECTED/`. Regex đó khớp
 * <b>chuỗi con</b> `VALID` bên trong `ORDER_INVALID` ⇒ coi "quét sai mã vận đơn" là thành công
 * và ẩn dòng đỏ (minh đo được: `ORDER_INVALID` seq 32 ⇒ 0 dòng). Nay so khớp đúng tập hằng của
 * backend (`KioskEventService.java:45-50`): mọi loại KHÁC tập này là sự kiện lỗi ⇒ hiện dòng đỏ.
 */
const KIOSK_EVENT_THANH_CONG = new Set([
  'SHIPPER_VERIFIED',
  'ORDER_VALID',
  'COMPARTMENT_SELECTED',
  'DEPOSIT_SUCCESS',
]);

/**
 * GĐ57 vòng sửa 1 — số mili-giây giữ thanh ở bước 6 sau `DEPOSIT_SUCCESS` (thẻ: ít nhất 4 s).
 * Đặt ở phạm vi module để không lọt vào dependency của effect và không đổi giữa các lần render.
 */
const GIU_BUOC_6_MS = 4000;

/**
 * GĐ49c — THANH TIẾN TRÌNH 4 BƯỚC (CHỈ ĐỌC state có sẵn — điều cấm #1).
 *
 * <p><b>Vì sao chỉ đọc:</b> quy trình nạp đã có state máy trạng thái thật (`depositStep` 1..4 do
 * tủ/firmware dẫn dắt, GĐ31b). Component này <b>không</b> đổi state, không gọi API, không thêm
 * timer — nó chỉ HIỂN THỊ bước hiện tại để shipper biết mình đang ở đâu. Mọi logic giữ nguyên.
 *
 * <p><b>Năm bước</b> (GĐ57, đúng trình tự kiosk): Chọn đơn → Quét QR shipper → Quét mã vận đơn →
 * Chọn ngăn &amp; bỏ hàng → Đóng cửa xác nhận. `buocHienTai` 1..6; 6 = đã nạp xong (cả 5 tick).
 *
 * @param buocHienTai 1..6
 */
function DepositSteps({ buocHienTai }) {
  const buoc = [
    { n: 1, nhan: 'Chọn đơn' },
    { n: 2, nhan: 'Quét QR shipper' },
    { n: 3, nhan: 'Quét mã vận đơn' },
    { n: 4, nhan: 'Chọn ngăn & bỏ hàng' },
    { n: 5, nhan: 'Đóng cửa xác nhận' },
  ];
  return (
    <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2" data-testid="deposit-steps" data-buoc={buocHienTai}>
      {buoc.map((b) => {
        const xong = b.n < buocHienTai;
        const dang = b.n === buocHienTai;
        return (
          <li
            key={b.n}
            data-testid={`deposit-step-${b.n}`}
            data-done={xong ? '1' : '0'}
            data-active={dang ? '1' : '0'}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${
              dang
                ? 'bg-blue-600 border-blue-600 text-white'
                : xong
                ? 'bg-white border-emerald-300 text-emerald-800'
                : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                dang
                  ? 'bg-white text-blue-700'
                  : xong
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 border border-slate-300'
              }`}
            >
              {xong ? <Check className="w-3 h-3" /> : b.n}
            </span>
            <span className="truncate">{b.nhan}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ShipperTab({ currentUser, onNavigateToRecall }) {
  const [orders, setOrders] = useState([]);
  const [allLockers, setAllLockers] = useState([]);
  const [sampleToast, setSampleToast] = useState(null);
  const [depositFailureInfo, setDepositFailureInfo] = useState(null);

  // GĐ21 — danh sách khách để chọn khi tạo đơn hộ. TRƯỚC ĐÂY hàm tạo đơn ghi cứng
  // "Đoàn Viết Hoàng / 0988123456" nên mọi đơn tạo từ màn shipper đều gán cho đúng một người,
  // bất kể khách thật là ai. Nay đọc từ `GET /api/shipper/customers`.
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [customersError, setCustomersError] = useState(null);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Token QR định danh shipper — GĐ15: KHÔNG còn hạn (vĩnh viễn), nên không có state đếm ngược.
  const [dynamicToken, setDynamicToken] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);

  // Deposit Stepper State (1: Scan Barcode, 2: Solenoid Open, 3: Put & Close, 4: Dual Sensor)
  const [depositStep, setDepositStep] = useState(1);
  const [isDepositing, setIsDepositing] = useState(false);

  /**
   * GĐ17 — THEO DÕI SỰ KIỆN TỪ TỦ THẬT.
   *
   * <p><b>Vì sao bỏ thanh 4 bước cũ:</b> 4 bước đó là mô phỏng trên web (nút "Quét Mã Kiện" tự
   * giả lập camera, nút "Mở Cửa" gọi API). Với tủ thật, shipper KHÔNG bấm gì trên web ở các
   * bước này — firmware tự quét GM65, tự mở cửa. Web chỉ cần HIỆN kết quả tủ đã làm.
   *
   * <p><b>Vì sao `lastSeqRef` (ref, không phải state):</b> backend dùng `seq` tăng đơn điệu. Mỗi
   * lần poll gửi `after=mốc` thì chỉ nhận sự kiện MỚI → popup không phát lại. Lần đầu mốc là
   * `null` → backend trả `events: []` + `latestSeq`, nên mở tab không hiện lại popup cũ.
   *
   * <p><b>GĐ42 vòng 2:</b> đổi từ state sang ref. Để state thì mốc nằm trong dependency của effect
   * poll ⇒ mỗi 1,5 giây effect dựng lại (clear + tạo interval mới) và nhịp vừa bắn có thể rơi vào
   * `cancelled` ⇒ sự kiện `DEPOSIT_SUCCESS` **không** được xử lý ngay. Đo thật: web vẫn mất
   * **3471 ms / 2964 ms** dù backend đã bắn sự kiện.
   */
  const [kioskEvents, setKioskEvents] = useState([]);
  const lastSeqRef = useRef(null);
  // GĐ42 vòng 2 — tủ cuối cùng đã poll. Giữ lại để poll không chết khi danh sách PENDING rỗng.
  const lastPolledLockerRef = useRef(null);
  const [, setKioskError] = useState(null);

  /**
   * GĐ57 vòng sửa 1 — "VỪA NẠP XONG": giữ thanh ở bước 6 (cả 5 tick) ít nhất 4 giây.
   *
   * <p><b>Vì sao cần:</b> `DEPOSIT_SUCCESS` kích `loadOrders()`; đơn vừa nạp rời danh sách
   * PENDING nên với đơn CUỐI danh sách, `activeOrder` thành `null` và thanh rơi ngay về bước 1 —
   * minh đo được bước 6 chỉ sống ~5 ms (0 khung rAF). Đây là bộ nhớ HIỂN THỊ thuần frontend
   * (mã đơn + thời điểm), KHÔNG đổi state nghiệp vụ, không gọi API thêm.
   *
   * <p><b>Quy ước:</b> chỉ giữ khi shipper CHƯA chọn đơn khác — `selectedOrderId` đổi sang đơn
   * khác thì thanh theo đơn mới ngay (điều cấm #5: không đổi thứ tự/nhãn bước).
   */
  const [vuaNapXong, setVuaNapXong] = useState(null); // { orderId, at }
  const [depositLeftInfo, setDepositLeftInfo] = useState(null);
  const vuaNapXongTimerRef = useRef(null);
  const selectedOrderIdRef = useRef(null);
  const lastSelectedOrderIdRef = useRef(null);
  const seenDepositSuccessRef = useRef(new Set());
  const seenDepositLeftRef = useRef(new Set());
  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
    if (selectedOrderId) lastSelectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);
  // Cleanup: rời tab thì không giữ timer (tránh setState lên component đã unmount).
  useEffect(() => () => {
    if (vuaNapXongTimerRef.current) clearTimeout(vuaNapXongTimerRef.current);
  }, []);

  // GM65 Scanner State
  const [scannedBarcode, setScannedBarcode] = useState(null);
  const [isScanSuccess, setIsScanSuccess] = useState(false);
  const [manualBarcodeInput, setManualBarcodeInput] = useState('');
  const [scanError, setScanError] = useState(null);
  const [isScanningActive, setIsScanningActive] = useState(false);

  // T3 — trạng thái đặt trước ngăn (gọi API thật)
  const [reserveCompartments, setReserveCompartments] = useState([]);
  const [reserveCompIndex, setReserveCompIndex] = useState(null);
  const [reserveTrackingCode, setReserveTrackingCode] = useState('');
  const [reserveMessage, setReserveMessage] = useState(null);
  // GĐ21 — thời hạn giữ chỗ shipper chọn. Mặc định 2 giờ (giữ đúng hành vi cũ 120 phút).
  const [reserveHours, setReserveHours] = useState(2);
  const [isReserving, setIsReserving] = useState(false);
  const [isLoadingCompartments, setIsLoadingCompartments] = useState(false);
  // Đơn đã đặt trước hay chưa: backend KHÔNG trả `shipperReservedAt`, nên suy ra từ
  // việc `reserve` có bị 400 "đã được đặt trước" hay không, hoặc từ lần reserve thành công.
  const [reservedOrderIds, setReservedOrderIds] = useState({});
  const [usingMockData, setUsingMockData] = useState(false);

  // GĐ5-A — CẢM BIẾN THẬT của ngăn đang thao tác.
  //
  // Nguồn dữ liệu: `GET /api/lockers/{id}/compartments` → `currentWeight`, `isDoorClosed`.
  // Hai trường này do thiết bị ghi qua `MqttService.handleCompartmentStatus` (HX711 + MC-38),
  // KHÔNG phải do UI tự suy ra như code cũ (`0.85` cứng và `doorState` theo bước).
  //
  // ⚠️ ĐƠN VỊ — ĐÃ TRUY TẬN GỐC, KHÔNG ĐOÁN:
  //   • `MQTT_GUIDE.md` dòng 90: "`weight`: trọng lượng do loadcell đo, đơn vị **gram**".
  //   • `MqttService:1067-1069` ghi THẲNG `payload.weight` vào `current_weight` (**không chia**)
  //     ⇒ DB lưu **gram**.
  //   • `LockerCabinetVisualizer` L17/L184 hiểu `sensorWeight` là **KG**.
  //   ⇒ Phải chia 1000 tại chỗ truyền, nếu không web hiện sai 1000 lần (109.8 g → "109.80 kg").
  //
  //   Ngoại lệ đang thấy trong DB: `LOCKER_HN_02` ngăn 1 có `current_weight = 0.85`. Đây là
  //   **dữ liệu rác** do bug cũ `weightGrams: 0.85` (kg) bị ghi vào cột gram qua
  //   `ShipperService:168`. Không được lấy giá trị đó làm chuẩn để suy ra đơn vị.
  // GĐ39 — TOÀN BỘ danh sách ngăn của tủ đang xem (shape của `LockerCabinetVisualizer`).
  // `null` = chưa đọc được → component dùng `defaultSlots` (2 ngăn mặc định), không bịa status.
  // Shipper LUÔN thấy đủ ngăn, mọi lúc — không lọc theo ngăn của đơn.
  // GĐ42 — tập `seq` sự kiện Kiosk đã dùng để reload danh sách (chống trùng).
  // Dùng `useRef` chứ không `useState`: đây là bộ nhớ phụ, không tham gia render — nếu để state
  // thì mỗi lần thêm lại kéo thêm một vòng render và có thể kích lại effect poll.
  const processedKioskSeqRef = useRef(new Set());

  const [compartments, setCompartments] = useState(null);

  // GĐ40 — telemetry THẬT theo từng tủ: { [lockerId]: {isVirtual, lastHeartbeat, health} }.
  // `null` = chưa đọc được / lỗi mạng → header sơ đồ ẩn (không bịa số).
  const [telemetryByLocker, setTelemetryByLocker] = useState(null);

  const [sensor, setSensor] = useState({
    weight: null,       // kg — null = chưa đọc được
    doorClosed: null,   // true/false — null = chưa có bản tin
    updatedAt: null,    // thời điểm đọc được lần cuối
    // GĐ29 — trạng thái THẬT của ngăn + chỉ số ngăn. Trước GĐ29 hai field này không tồn tại nên
    // sơ đồ ngăn tủ không có đường nào nhận `status`: `LockerCabinetVisualizer` rơi về
    // `defaultSlots` (`status: 'AVAILABLE'`) và luôn hiện "Ngăn Trống" dù DB đã `OCCUPIED`.
    status: null,       // EMPTY/OCCUPIED/RESERVED/OUT_OF_SERVICE — null = chưa đọc được
    compIndex: null,    // ngăn đang đọc; đổi ngăn phải đọc lại, không giữ số của ngăn cũ
  });

  // Âm thanh Bíp nhận diện mã vạch của đầu đọc GM65
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, audioCtx.currentTime); // Nốt A6 cao, sắc nét
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.13);
    } catch (e) {}
  };

  /**
   * GĐ40 — telemetry THẬT cho header sơ đồ tủ.
   *
   * <p>Trước GĐ40 header hard-code `ESP32 12ms` + `MQTT 1883` — hai con số không đọc từ đâu, và
   * **1883 còn sai sự thật** (backend dùng TLS **8883**). Nay dữ liệu lấy từ chính response
   * `/api/lockers` (`lastHeartbeat`, `isVirtual`), suy bằng `getLockerHealth` của GĐ12.
   *
   * <p><b>KHÔNG gọi `/api/mqtt/status`</b>: endpoint đó 403 với vai trò không phải ADMIN.
   * Lỗi mạng ⇒ state `null` ⇒ header ẩn, **không bịa số**.
   */
  const loadLockerTelemetry = async () => {
    try {
      const res = await lockerApi.getAll();
      const list = res?.data?.data || [];
      if (list.length > 0) setAllLockers(list);
      const byId = {};
      list.forEach((l) => {
        byId[l.lockerId] = {
          isVirtual: l.isVirtual === true,
          lastHeartbeat: l.lastHeartbeat || null,
          health: getLockerHealth(l),
        };
      });
      setTelemetryByLocker(byId);
    } catch {
      setTelemetryByLocker(null); // để header ẩn, không bịa
    }
  };

  useEffect(() => {
    // GĐ13 — KHÔNG còn `store.checkAndScanOverdueOrders()`.
    //
    // Hàm đó quét mảng đơn trong localStorage rồi trả `sweptCount`; con số không liên quan tới DB
    // (việc chuyển đơn sang OVERDUE do `OverdueSchedulerService` ở backend quyết định, mỗi 10 phút).
    // Nay tab shipper chỉ tải danh sách THẬT: đơn chờ nạp qua API, đơn quá hạn qua
    // `shipperApi.getOverdueOrders` (dùng ở tab Thu hồi).
    loadOrders();
    setAllLockers(store.getLockers());
    // GĐ40 — tải danh sách tủ THẬT từ API để có `lastHeartbeat`/`isVirtual` (cache localStorage
    // không có nhịp tim, dùng nó sẽ ra telemetry sai). Chỉ để hiện header sơ đồ, không đổi luồng đơn.
    loadLockerTelemetry();
    // GĐ21 — nạp danh sách khách MỘT LẦN cho hộp chọn "+ Thêm đơn" (không gọi lại mỗi lần bấm).
    // Gộp ThanhChung (Q1) — bản ThanhChung gỡ cả nút lẫn lời gọi này; gắn lại cùng nút.
    loadCustomers();

    const handleUpdate = () => {
      loadOrders();
      setAllLockers(store.getLockers());
    };
    const handleOverdueDetected = () => loadOrders();

    // GĐ42 — lưới an toàn: poll lại danh sách mỗi **10 giây** (trước là 30 giây).
    //
    // Đường CHÍNH để web cập nhật là SỰ KIỆN (poll Kiosk 1,5 s bắt `DEPOSIT_SUCCESS` /
    // `DEPOSIT_LEFT_EMPTY` → tải đơn và cảm biến ngăn ngay, xem effect bên dưới). Nhịp này chỉ để
    // cứu khi mất sự kiện (MQTT rơi, backend restart).
    //
    // ⚠ KHÔNG hạ xuống dưới 10 s (điều cấm #1): `orders/pending` là truy vấn danh sách, gọi quá
    // dày sẽ nặng máy chủ — chữa cháy bằng tải nặng thay vì sửa đúng gốc.
    const scanTimer = setInterval(() => {
      loadOrders();
    }, 10000);

    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    return () => {
      clearInterval(scanTimer);
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    };
  }, [selectedLockerFilter]);

  /**
   * T3 — danh sách đơn chờ nạp lấy từ BACKEND thật (`GET /api/shipper/orders/pending`).
   *
   * <p>Có fallback: API lỗi (mất mạng, 401, backend chưa chạy) thì dùng dữ liệu mô phỏng
   * trong `store` và bật cờ cảnh báo — thà hiện dữ liệu cũ còn hơn trắng trang.
   */
  const loadOrders = async () => {
    const filterLocker = selectedLockerFilter !== 'ALL' ? selectedLockerFilter : null;
    try {
      const res = await shipperApi.getPendingOrders(filterLocker);
      const apiOrders = res?.data?.data || [];
      setOrders(apiOrders);
      setUsingMockData(false);

      const reservedMap = {};
      apiOrders.forEach((o) => {
        if (o.isShipperReserved) {
          reservedMap[o.orderId] = o.compartmentIndex || true;
        }
      });
      setReservedOrderIds(reservedMap);
      setSelectedOrderId((current) =>
        apiOrders.some((order) => order.orderId === current) ? current : null
      );
    } catch (err) {
      // GĐ13 — fallback CÓ KIỂM SOÁT (không phải nguồn chính): bật `usingMockData` để hiện banner
      // "Đang dùng dữ liệu mô phỏng" ở đầu danh sách. Nguồn chính luôn là API ở nhánh try trên.
      console.warn('[ShipperTab] Không gọi được API đơn chờ nạp, dùng dữ liệu mô phỏng:', err?.message);
      setUsingMockData(true);
      // `store.getOrders()` — FALLBACK: chỉ chạy khi API lỗi, và banner `usingMockData` ở trên đã
      // nói rõ với người dùng đây không phải dữ liệu máy chủ.
      const all = store.getOrders();
      setOrders(all);
      const pending = all.filter((o) => o.status === 'PENDING');
      if (pending.length > 0 && !selectedOrderId) {
        setSelectedOrderId(pending[0].orderId);
      }
    }
  };

  const handleSelectPendingOrder = async (orderId) => {
    if (depositFailureInfo?.orderId === orderId) {
      setDepositFailureInfo(null);
      setKioskEvents((prev) => prev.filter((e) => e.orderId !== orderId));
    }

    if (usingMockData) {
      setSelectedOrderId(orderId);
      return true;
    }

    try {
      await shipperApi.claimPendingOrder(orderId);
    } catch (err) {
      setSampleToast(err?.response?.data?.message || 'Không thể nhận đơn này.');
      setTimeout(() => setSampleToast(null), 5000);
      await loadOrders();
      return false;
    }

    setSelectedOrderId(orderId);
    if (!isDepositing) {
      setScannedBarcode(null);
      setIsScanSuccess(false);
    }
    await loadOrders();
    return true;
  };

  /**
   * GĐ21 — nạp danh sách khách MỘT LẦN khi mở tab.
   *
   * <p>Mặc định chọn khách ĐẦU TIÊN backend trả — không tự chọn tên ai trong code. Nếu API lỗi
   * hoặc danh sách rỗng thì để `customersError` bật cờ, nút "+ Thêm đơn" sẽ bị tắt kèm lý do;
   * TUYỆT ĐỐI không rơi về một tên mặc định (đó chính là lỗi thẻ này muốn bỏ).
   */
  const loadCustomers = async () => {
    setLoadingCustomers(true);
    try {
      const res = await shipperApi.getCustomers();
      const list = res?.data?.data || [];
      setCustomers(list);
      setCustomersError(list.length === 0 ? 'Hệ thống chưa có tài khoản khách hàng nào.' : null);
      setSelectedCustomerId((prev) => {
        if (prev != null && list.some((c) => c.userId === prev)) return prev;
        return list.length > 0 ? list[0].userId : null;
      });
    } catch (err) {
      setCustomers([]);
      setSelectedCustomerId(null);
      setCustomersError(
        err?.response?.data?.message
          || 'Không tải được danh sách khách hàng. Kiểm tra backend đang chạy và đăng nhập SHIPPER.'
      );
    } finally {
      setLoadingCustomers(false);
    }
  };

  const handleDeletePendingOrder = async (orderId) => {
    if (!orderId) return;
    try {
      await shipperApi.deletePendingOrder(orderId);
      if (selectedOrderId === orderId) setSelectedOrderId(null);
      await loadOrders();
      setSampleToast(`Đã xoá đơn ${orderId}.`);
      setTimeout(() => setSampleToast(null), 3500);
    } catch (err) {
      setSampleToast(
        err?.response?.data?.message
          || `Không xoá được đơn ${orderId}.`
      );
      setTimeout(() => setSampleToast(null), 5000);
    }
  };

  const handleCreateSampleOrder = async () => {
    const sampleProducts = [
      { name: 'Áo Hoodie PTIT Sinh Viên 2026', price: 280000, size: 'S' },
      { name: 'Tai nghe Bluetooth True Wireless Pro', price: 450000, size: 'S' },
      { name: 'Balo Laptop Chống Nước PTIT', price: 520000, size: 'L' },
      { name: 'Chuột Công Thái Học Không Dây Logitech MX Master', price: 650000, size: 'S' },
      { name: 'Pin Sạc Dự Phòng Polymer 20.000mAh 22.5W', price: 380000, size: 'S' },
      { name: 'Bình Giữ Nhiệt Thông Minh LED 500ml', price: 195000, size: 'S' },
      { name: 'Bàn Phím Cơ Không Dây RGB Low-Profile', price: 850000, size: 'L' },
    ];
    const randProd = sampleProducts[Math.floor(Math.random() * sampleProducts.length)];

    // GĐ21 — bắt buộc có khách được chọn. Không có thì dừng hẳn, KHÔNG rơi về tên mặc định.
    const chosen = customers.find((c) => c.userId === selectedCustomerId) || null;
    if (!chosen) {
      setSampleToast(
        customersError
          ? `Không tạo được đơn: ${customersError}`
          : 'Không tạo được đơn: chưa chọn khách hàng.'
      );
      setTimeout(() => setSampleToast(null), 5000);
      return;
    }

    const chosenLocker = allLockers.find((lk) => lk.lockerId === selectedLockerFilter) || null;
    if (!chosenLocker) {
      setSampleToast('Không tạo được đơn: chưa chọn tủ giao hàng.');
      setTimeout(() => setSampleToast(null), 5000);
      return;
    }

    try {
      // 1. Gửi request tạo đơn hàng thật vào Backend CSDL
      // GĐ72 (#4) — ngày theo giờ máy; toISOString() là UTC nên 00:00–06:59 giờ VN ra hôm qua.
      const today = ngayDiaPhuong();
      const res = await orderApi.checkout({
        customerName: chosen.fullName,
        customerPhone: chosen.phone,
        deliveryType: 'LOCKER',
        lockerId: chosenLocker.lockerId,
        deliveryDate: today,
        productName: randProd.name,
        // GĐ21 (1c) — KHÔNG gửi `requiredSize` nữa: GĐ18 đã bỏ phân biệt size nên field này
        // không còn tác dụng. Backend vẫn nhận (giữ tương thích) nhưng gửi lên chỉ gây hiểu nhầm.
        totalAmount: randProd.price,
        paymentMethod: 'ONLINE_VIETQR',
        paymentStatus: 'PAID',
      });

      if (res?.data?.success && res.data.data) {
        const ord = res.data.data;
        // GĐ13 — ĐÃ XOÁ `store.createOrder({...})` ở đây.
        //
        // `POST /api/orders/checkout` đã tạo đơn THẬT trong CSDL và trả về `ord`. Chép thêm một
        // bản vào localStorage là dựng nguồn sự thật thứ hai: nó khác dần DB (không có cập nhật
        // trạng thái sau đó), và nếu `loadOrders()` lỗi thì UI hiện bản sao cũ này như đơn thật.
        // Đơn mới hiện ra bằng `await loadOrders()` ngay bên dưới — đọc thẳng từ API.
        await loadOrders();
        // GĐ21 — thông báo nêu TÊN KHÁCH VỪA CHỌN, không ghi cứng tên ai.
        setSampleToast(
          `Đã tạo đơn THẬT ${ord.orderId} cho ${chosen.fullName} (${chosen.phone}). Chọn đơn để nhận giao.`
        );
        setTimeout(() => setSampleToast(null), 3500);
        return;
      }

    } catch (err) {
      console.warn('[ShipperTab] Gọi API checkout thất bại, dùng đơn mẫu trong trình duyệt:', err?.message);
      setSampleToast(
        err?.response?.data?.message
          || 'Không tạo được đơn. Máy chủ từ chối hoặc backend không phản hồi.'
      );
      setTimeout(() => setSampleToast(null), 5000);
      return;
    }
  };

  /**
   * T3 — xin mã QR định danh shipper từ BACKEND.
   *
   * <p>Trước đây hàm này tự bịa `'SHIPPER-TOKEN-' + Math.random()` ở client. Token giả đó
   * không tồn tại trong bảng `shipper_identity_tokens`, nên `POST /api/shipper/deposit`
   * (kiểm bằng `tokenRepository.findByDynamicToken`) sẽ luôn từ chối. Nay lấy token thật
   * do backend cấp.
   *
   * <p><b>GĐ15 — token KHÔNG còn hạn 60 giây (user chốt "QR vĩnh viễn").</b> Mỗi lần bấm vẫn
   * tạo một token MỚI; token cũ vẫn dùng được (không bị thu hồi), nên không cần "tạo lại trước
   * khi hết hạn" như trước. Lớp chặn duy nhất còn lại là mỗi token chỉ quét được MỘT lần
   * (`isVerified` ở backend).
   */
  const handleGenerateToken = async () => {
    try {
      const res = await shipperApi.generateToken();
      const token = res?.data?.data?.dynamicToken;
      if (!token) {
        setScanError('Backend không trả mã QR shipper. Vui lòng thử lại.');
        return;
      }
      setDepositFailureInfo(null);
      setDynamicToken(token);
      setShowQrModal(true);
      setScanError(null);
    } catch (err) {
      const msg = err?.response?.data?.message
        || 'Không tạo được mã QR shipper. Kiểm tra đã đăng nhập bằng tài khoản SHIPPER và backend đang chạy.';
      setScanError(msg);
    }
  };

  const handleStartDepositProcess = async (orderId) => {
    const claimed = await handleSelectPendingOrder(orderId);
    if (!claimed) return;
    setDepositStep(1);
    setIsDepositing(true);
    setScannedBarcode(null);
    setIsScanSuccess(false);
    setScanError(null);
  };

  const handleScanBarcode = (code) => {
    setScanError(null);
    setIsScanningActive(true);

    setTimeout(() => {
      setIsScanningActive(false);
      const pendingList = orders.filter((o) => o.status === 'PENDING');
      const filtered = pendingList.filter((o) => {
        if (selectedLockerFilter === 'ALL') return true;
        return o.lockerId === selectedLockerFilter;
      });

      const currentTarget = activeOrder?.orderId || '';
      const targetCode = (code || manualBarcodeInput || currentTarget).trim().toUpperCase();

      if (!targetCode) {
        setScanError('Vui lòng đưa mã vạch bưu kiện vào tầm quét của camera GM65!');
        return;
      }

      // Đối soát mã bưu kiện với danh sách hàng cần giao tại trạm
      const matchedOrder = filtered.find(
        (o) => o.orderId.toUpperCase() === targetCode || targetCode.includes(o.orderId.toUpperCase())
      );

      if (matchedOrder) {
        handleSelectPendingOrder(matchedOrder.orderId).then((claimed) => {
          if (!claimed) return;
          playBeep();
          setScannedBarcode(matchedOrder.orderId);
          setIsScanSuccess(true);
          setManualBarcodeInput('');
          setScanError(null);
        });
      } else {
        setScanError(`Mã kiện hàng "${targetCode}" không hợp lệ hoặc không thuộc trạm tủ này!`);
        setIsScanSuccess(false);
      }
    }, 250);
  };

  const handleProceedDepositStep = (nextStep, order) => {
    setDepositStep(nextStep);
    if (nextStep === 5 && order) {
      // T3: bước 2 đã gọi API THẬT (`POST /api/shipper/deposit`) và backend đã tự cập nhật
      // trạng thái đơn + ngăn + gửi thông báo. Ở đây KHÔNG ghi `store` nữa — nếu vẫn
      // `store.updateOrderStatus(...)` thì trạng thái mô phỏng sẽ đè lên dữ liệu thật
      // và lần `loadOrders()` sau hiển thị sai.
      setReserveMessage({
        type: 'success',
        text: `Đã hoàn tất nạp kiện hàng ${order.orderId}. Trạng thái do backend cập nhật.`,
      });
      setIsDepositing(false);
      setDepositStep(1);
      setScannedBarcode(null);
      setIsScanSuccess(false);
      setScanError(null);
      loadOrders();
    }
  };

  /** T3 — nạp danh sách ngăn của tủ để shipper chọn (gồm ngăn EMPTY và ngăn đang gán cho chính đơn này). */
  const loadReserveCompartments = async (lockerId, currentCompIndex = null) => {
    if (!lockerId) {
      setReserveCompartments([]);
      return;
    }
    setIsLoadingCompartments(true);
    try {
      const res = await lockerApi.getCompartments(lockerId);
      const list = res?.data?.data || [];
      const assignedIdx = currentCompIndex ?? activeOrder?.compartmentIndex;
      setReserveCompartments(
        list.filter((c) => {
          const isSelf = activeOrder?.isShipperReserved === true
            && assignedIdx != null
            && c.compIndex === assignedIdx;
          return String(c.status).toUpperCase() === 'EMPTY' || (isSelf && String(c.status).toUpperCase() === 'RESERVED');
        })
      );
    } catch (err) {
      setReserveCompartments([]);
      setReserveMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không tải được danh sách ngăn của tủ.',
      });
    } finally {
      setIsLoadingCompartments(false);
    }
  };

  /**
   * GĐ5-A — đọc cảm biến THẬT của đúng ngăn đang thao tác.
   *
   * <p>Không dùng giá trị cứng: `currentWeight` là số cân HX711 đọc được, `isDoorClosed` là
   * công tắc từ MC-38, cả hai do thiết bị publish lên và backend ghi vào DB. Gọi lại mỗi 2 giây
   * khi shipper đang ở bước nạp hàng nên UI bám theo phần cứng thật.
   */
  const loadCompartmentSensor = async (lockerId) => {
    if (!lockerId) return null;
    try {
      const res = await lockerApi.getCompartments(lockerId);
      const list = res?.data?.data || [];
      if (!list.length) {
        setCompartments(null);
        setSensor({ weight: null, doorClosed: null, updatedAt: null, status: null, compIndex: null });
        return null;
      }

      // GĐ39 — GIỮ CẢ DANH SÁCH. Trước đây hàm này `find` đúng ngăn của đơn rồi chỉ lưu 1 ngăn,
      // nên sơ đồ chỉ vẽ được 1 slot dù tủ có 2 ngăn (user báo kèm ảnh). Nay lưu toàn bộ để
      // `LockerCabinetVisualizer` vẽ đủ ngăn — component đó vốn render được nhiều slot.
      setCompartments(list.map((c) => ({
        id: c.compIndex,
        status: c.status || null,                 // status THẬT từ API, không suy diễn
        weight: c.currentWeight != null ? Number(c.currentWeight) / 1000 : 0,
        door: c.isDoorClosed === false ? 'OPEN' : 'CLOSED',
      })));

      // `sensor` giữ nguyên ý nghĩa cũ: ngăn ĐANG THAO TÁC (phục vụ ô "Cửa Đang Mở"/"Trọng lượng"
      // và `sensorWeight`). Không đổi hành vi highlight — `activeSlotId` vẫn do caller truyền.
      const compIndex = activeOrder?.compartmentIndex;
      const comp = list.find((c) => c.compIndex === compIndex) || list[0];
      const data = {
        // DB lưu GRAM (xem ghi chú đơn vị ở khối state `sensor`), component hiểu KG → chia 1000.
        weight: comp.currentWeight != null ? Number(comp.currentWeight) / 1000 : 0,
        doorClosed: comp.isDoorClosed != null ? Boolean(comp.isDoorClosed) : null,
        updatedAt: new Date(),
        // GĐ29 — trạng thái thật của ngăn, để sơ đồ hiện đúng nhãn ("Đang Có Hàng" sau khi nạp).
        status: comp.status || null,
        compIndex: comp.compIndex != null ? comp.compIndex : null,
      };
      setSensor(data);
      return data;
    } catch {
      // Mất mạng / 401: giữ giá trị cũ, không xoá trắng để UI không nhảy về 0.
      return null;
    }
  };
  /** T3 — đặt trước ngăn cho đơn đang chọn. */
  const handleReserve = async () => {
    if (!activeOrder) return;
    if (!reserveCompIndex) {
      setReserveMessage({ type: 'error', text: 'Vui lòng chọn một ngăn trống trước khi đặt trước.' });
      return;
    }
    setIsReserving(true);
    setReserveMessage(null);
    try {
      const body = {
        trackingCode: (reserveTrackingCode || activeOrder.trackingCode || activeOrder.orderId || '').trim(),
        compartmentIndex: reserveCompIndex,
        // GĐ21 — thời hạn giữ chỗ do shipper chọn (1 hoặc 2 giờ). Hạn được lưu RIÊNG trên đơn.
        reserveHours: reserveHours,
      };
      const res = await shipperApi.reserveCompartment(activeOrder.orderId, body);
      const data = res?.data?.data;
      const compIdx = data?.compartmentIndex || reserveCompIndex;
      setReservedOrderIds((prev) => ({ ...prev, [activeOrder.orderId]: compIdx }));
      // GĐ21 — hiện giờ hết hạn THẬT lấy từ backend, KHÔNG tự cộng giờ ở client (đồng hồ máy
      // khách lệch máy chủ là chuyện thường, tự cộng sẽ hứa sai giờ).
      const exp = data?.reserveExpiresAt;
      const expText = exp
        ? ` Giữ đến ${new Date(exp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`
        : '';
      setReserveMessage({
        type: 'success',
        text: `Đã đặt trước ngăn #${compIdx} (${reserveHours} giờ).${expText}`,
      });
      setReserveCompIndex(null);
      await loadOrders();
      await loadReserveCompartments(activeOrder.lockerId);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Không đặt trước được ngăn này.';
      setReserveCompIndex(null);
      await Promise.all([
        loadOrders(),
        loadReserveCompartments(activeOrder.lockerId),
      ]);
      setReserveMessage({ type: 'error', text: msg });
    } finally {
      setIsReserving(false);
    }
  };

  /** T3 — huỷ đặt trước, nhả ngăn về trống. */
  const handleCancelReserve = async () => {
    if (!activeOrder) return;
    setIsReserving(true);
    setReserveMessage(null);
    try {
      const res = await shipperApi.cancelReserve(activeOrder.orderId);
      setReservedOrderIds((prev) => {
        const next = { ...prev };
        delete next[activeOrder.orderId];
        return next;
      });
      setReserveMessage({ type: 'success', text: res?.data?.message || 'Đã huỷ đặt trước.' });
      setReserveCompIndex(null);
      await loadOrders();
      await loadReserveCompartments(activeOrder.lockerId);
    } catch (err) {
      setReserveMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không huỷ được đặt trước.',
      });
    } finally {
      setIsReserving(false);
    }
  };

  /**
   * T3 — bước 2: mở cửa/gửi hàng qua API THẬT (`POST /api/shipper/deposit`).
   *
   * <p><b>KHÔNG dùng `store.triggerMqttCommand`</b>: nó gọi `/api/mqtt/command`, endpoint
   * chỉ dành cho ADMIN, token SHIPPER sẽ bị 403.
   */
  const handleOpenDoorAndDeposit = async (order) => {
    if (!order) return;
    if (!dynamicToken) {
      // Dùng `reserveMessage` (render NGOÀI các khối step) chứ không dùng `scanError`
      // (chỉ render trong `depositStep === 1`) — nút này nằm ở bước 2, dùng `scanError`
      // thì shipper bấm mà không thấy thông báo gì.
      setReserveMessage({
        type: 'error',
        text: 'Chưa có mã QR shipper. Bấm "Xác minh danh tính" để lấy mã rồi quét tại tủ trước khi gửi hàng.',
      });
      return;
    }
    setIsReserving(true);
    setReserveMessage(null);
    try {
      // GĐ5-A3 — BỎ số cứng `weightGrams: 0.85`.
      //
      // Trước đây client tự gửi 0.85 cho MỌI kiện hàng, nên `ShipperService:168` ghi số bịa đó
      // vào `current_weight` (cột GRAM) → DB có 0.85 gram cho một kiện thật, và điều kiện
      // "cảm biến phát hiện hàng" (`> 0.05`) lại được kiểm bằng chính số bịa. Bước kiểm cảm
      // biến kép trở nên vô nghĩa.
      //
      // Nay đọc lại cảm biến HX711 ngay trước khi gửi. `sensor.weight` đang là **kg** (đã chia
      // 1000 khi đọc), còn API nhận **gram** → phải NHÂN 1000 để trả về đúng đơn vị gốc của DB.
      // Nếu chưa đọc được thì bỏ hẳn tham số, để backend giữ nguyên giá trị phần cứng đã báo.
      let liveWeightKg = sensor.weight;
      if (liveWeightKg == null) {
        const fresh = await loadCompartmentSensor(order.lockerId);
        liveWeightKg = fresh?.weight ?? null;
      }

      const payload = {
        lockerId: order.lockerId,
        dynamicToken,
        orderId: order.orderId,
        isDoorClosed: true,
      };
      if (liveWeightKg != null) {
        payload.weightGrams = liveWeightKg * 1000; // kg → gram
      }

      const res = await shipperApi.depositPackage(payload);
      setReserveMessage({
        type: 'success',
        text: res?.data?.message || `Đã gửi kiện hàng ${order.orderId} vào ngăn.`,
      });
      await loadOrders();
      // GĐ29 — ĐỌC LẠI CẢM BIẾN NGAY SAU KHI NẠP XONG.
      //
      // Trước GĐ29 chỗ này chỉ `await loadOrders()`. Poll cảm biến (`:711`) chỉ chạy khi
      // `isDepositing && depositStep 2..4`, tức TRƯỚC lúc nạp; nạp xong là poll tắt, nên `sensor`
      // giữ snapshot cũ (`status` chưa có, cân = 0) và sơ đồ đứng yên ở "Ngăn Trống".
      // Backend đã ghi `compartments.status = 'OCCUPIED'` + `current_weight` trong cùng request,
      // nên đọc lại ngay là thấy giá trị mới.
      await loadCompartmentSensor(order.lockerId);
    } catch (err) {
      setReserveMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không gửi được kiện hàng vào tủ.',
      });
    } finally {
      setIsReserving(false);
    }
  };

  // GĐ31b — `PENDING_OPENED` = đơn đang trong phiên nạp (cửa đã mở). Vẫn phải hiện trong danh
  // sách chờ nạp, nếu không shipper mở cửa xong là đơn biến mất và không chốt được.
  const pendingOrders = orders.filter((o) => o.status === 'PENDING' || o.status === 'PENDING_OPENED');
  const depositedOrders = orders.filter((o) => o.status === 'DEPOSITED' || o.status === 'COMPLETED'
    || o.status === 'PICKUP_OPENED');
  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');

  const filteredPending = pendingOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  const activeOrder = orders.find((o) => o.orderId === selectedOrderId)
    || (usingMockData ? filteredPending[0] : null);

  // GĐ57 vòng sửa 1 — BẮT `DEPOSIT_SUCCESS` CỦA ĐƠN ĐANG CHỌN ĐỂ GIỮ THANH Ở BƯỚC 6.
  //
  // <p><b>Vì sao phải "nhớ":</b> sự kiện này kích `loadOrders()`; đơn vừa nạp rời danh sách
  // PENDING nên với đơn CUỐI danh sách `activeOrder` thành `null` và thanh rơi về bước 1 ngay
  // trong cùng khung hình — minh đo được bước 6 chỉ sống ~5 ms. Nay ghi lại mã đơn + thời điểm
  // (thuần hiển thị, không đổi state nghiệp vụ) và giữ bước 6 ít nhất `GIU_BUOC_6_MS`.
  //
  // <p>Sự kiện của ĐƠN KHÁC không kích hoạt (điều cấm #5: không đổi thứ tự/nhãn bước, chỉ hiển thị).
  useEffect(() => {
    if (!kioskEvents.length) return;
    const donDangChon = selectedOrderIdRef.current;
    for (const e of kioskEvents) {
      if (e.type === 'DEPOSIT_LEFT_EMPTY' && !seenDepositLeftRef.current.has(e.seq)) {
        seenDepositLeftRef.current.add(e.seq);
        setDepositLeftInfo({
          orderId: e.orderId || donDangChon || null,
          compartmentIndex: e.compartment ?? null,
          at: new Date(),
        });
        store.refreshNotifications();
      }
      if (e.type !== 'DEPOSIT_SUCCESS') continue;
      if (seenDepositSuccessRef.current.has(e.seq)) continue;
      seenDepositSuccessRef.current.add(e.seq);
      // `orderId` null khi tủ báo nạp xong mà không tìm thấy đơn PENDING của ngăn đó — khi ấy
      // gán cho đơn đang chọn để vẫn có phản hồi cho shipper.
      const maDon = e.orderId || donDangChon;
      if (!maDon) continue;
      if (donDangChon && maDon !== donDangChon) continue;
      setVuaNapXong({ orderId: maDon, at: Date.now() });
      if (vuaNapXongTimerRef.current) clearTimeout(vuaNapXongTimerRef.current);
      vuaNapXongTimerRef.current = setTimeout(() => {
        vuaNapXongTimerRef.current = null;
        setVuaNapXong(null);
      }, GIU_BUOC_6_MS);
    }
  }, [kioskEvents]);

  // GĐ40 — telemetry của ĐÚNG tủ đang hiện sơ đồ (không lẫn tủ khác).
  const telemetry = (activeOrder && telemetryByLocker)
    ? (telemetryByLocker[activeOrder.lockerId] || null)
    : null;

  // T3: mỗi khi đổi đơn đang chọn → nạp lại danh sách ngăn trống + điền sẵn mã vận đơn.
  useEffect(() => {
    if (!activeOrder) {
      setReserveCompartments([]);
      return;
    }
    setReserveTrackingCode(activeOrder.trackingCode || activeOrder.orderId || '');
    setReserveCompIndex(activeOrder.compartmentIndex || null);
    setReserveMessage(null);
    loadReserveCompartments(activeOrder.lockerId, activeOrder.compartmentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.orderId, activeOrder?.lockerId, activeOrder?.compartmentIndex]);

  // GĐ29 — ĐỌC CẢM BIẾN NGAY KHI CHỌN ĐƠN / ĐỔI NGĂN.
  //
  // Trước GĐ29 cảm biến chỉ được đọc (a) trước khi gửi hàng, (b) trong lúc nạp (step 2..4) và
  // (c) sau GĐ29 là sau khi nạp xong. Chỉ CHỌN đơn để xem thì không đọc gì ⇒ `sensor.status` null
  // ⇒ sơ đồ rơi về mặc định "Ngăn Trống". Đọc ở đây để sơ đồ phản ánh trạng thái thật của ngăn
  // ngay khi mở đơn, và đọc lại khi đổi sang ngăn khác (không giữ số của ngăn cũ).
  useEffect(() => {
    loadCompartmentSensor(activeOrder?.lockerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.lockerId, activeOrder?.compartmentIndex]);

  // GĐ5-A1/A2 — POLL cảm biến thật mỗi 2 giây khi đang xem đơn tại một tủ.
  //
  // Cửa và cân có thể đổi trong lúc đơn vẫn `PENDING` (shipper vừa mở/đóng ngăn), trước khi có
  // sự kiện chốt. Không giới hạn theo `isDepositing` vì luồng kiosk không luôn bật state đó trên web.
  // Chỉ theo dõi tủ của đơn đang chọn; cleanup khi đổi tủ/đơn hoặc rời tab.
  useEffect(() => {
    const lockerId = activeOrder?.lockerId;
    if (!lockerId) return undefined;

    loadCompartmentSensor(lockerId);
    const timer = setInterval(() => {
      loadCompartmentSensor(lockerId);
    }, 2000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.lockerId, activeOrder?.orderId]);

  /**
   * GĐ17 — POLL sự kiện Kiosk của tủ thật mỗi 1,5 giây.
   *
   * <p>Chu kỳ 1,5 giây: firmware quét mã xong shipper nhìn màn hình tủ, web phải báo gần như
   * cùng lúc. Nhanh hơn (0,5s) thì 3 request/giây cho mỗi shipper là lãng phí; chậm hơn (3s)
   * thì shipper đã kịp bước sang bước sau.
   *
   * <p>Chỉ poll khi có đơn đang chọn — không có đơn thì không có gì để theo dõi.
   *
   * <p><b>Cleanup bắt buộc:</b> thiếu `clearInterval` thì chuyển tab xong vẫn gọi API mãi, và
   * khi component unmount sẽ setState lên component đã chết (warning của React).
   */
  useEffect(() => {
    // GĐ42 vòng 2 — GIỮ TỦ CUỐI CÙNG đã theo dõi.
    //
    // Vì sao cần: `activeOrder` chỉ là đơn **PENDING** đang chọn. Ngay khi `loadOrders()` chạy
    // (do sự kiện), đơn vừa nạp rời danh sách PENDING ⇒ nếu đó là đơn cuối thì `activeOrder`
    // thành `null` ⇒ effect này **cleanup** và poll Kiosk **dừng hẳn**. Đo thật: `kiosk-events`
    // ngừng sau 2 697 ms, nên sự kiện `DEPOSIT_SUCCESS` (`seq 11`) không bao giờ được đọc — web
    // chỉ cập nhật nhờ nhịp dự phòng 10 s (3,4 s).
    //
    // Nay: nhớ tủ cuối cùng trong ref, để poll tiếp tục sau khi hết đơn PENDING. Chỉ dừng khi
    // component unmount (cleanup ở dưới).
    const lockerIdHienTai = activeOrder?.lockerId || null;
    if (lockerIdHienTai) lastPolledLockerRef.current = lockerIdHienTai;
    const lockerId = lockerIdHienTai || lastPolledLockerRef.current;
    if (!lockerId) {
      return undefined;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await shipperApi.getKioskEvents(lockerId, lastSeqRef.current);
        if (cancelled) return;

        const payload = res?.data?.data;
        if (!payload) return;

        const events = payload.events || [];
        if (events.length > 0) {
          // Nối vào đầu danh sách, chỉ giữ 20 sự kiện gần nhất để UI không phình.
          setKioskEvents((prev) => [...events, ...prev].slice(0, 20));

          // GĐ42 — SỰ KIỆN PHẢI RELOAD DỮ LIỆU, không chỉ nạp danh sách sự kiện.
          //
          // Trước GĐ42 khối này chỉ `setKioskEvents` ⇒ danh sách đơn + KPI **không đổi** dù
          // `DEPOSIT_SUCCESS` về trong 1,5 giây; phải chờ nhịp `loadOrders()` 30 giây (lỗi user báo
          // "nạp hàng xong web đứng yên"). Nay thấy sự kiện chốt là gọi `loadOrders()` NGAY.
          //
          // Chống trùng bằng ref Set (giống `processedKioskSeqRef` của CustomerPickupTab): poll
          // 1,5 giây gặp lại cùng sự kiện nhiều lần, không chặn thì mỗi nhịp gọi API một lần.
          const CO_SU_KIEN_CHOT = ['DEPOSIT_SUCCESS', 'DEPOSIT_LEFT_EMPTY', 'COMPARTMENT_SELECTED'];
          const canReload = events.some((e) => CO_SU_KIEN_CHOT.includes(e.type)
            && !processedKioskSeqRef.current.has(e.seq));
          if (canReload) {
            const orderIdBeingProcessed = selectedOrderIdRef.current
              || activeOrder?.orderId
              || lastSelectedOrderIdRef.current;
            const depositFailure = [...events].reverse().find((e) => (
              e.type === 'DEPOSIT_LEFT_EMPTY'
              && e.orderId === orderIdBeingProcessed
              && !processedKioskSeqRef.current.has(e.seq)
            ));
            events.forEach((e) => {
              if (CO_SU_KIEN_CHOT.includes(e.type)) processedKioskSeqRef.current.add(e.seq);
            });
            if (depositFailure) {
              setDepositFailureInfo({
                orderId: depositFailure.orderId,
                compartmentIndex: depositFailure.compartment,
                message: depositFailure.message,
              });
              setSelectedOrderId(depositFailure.orderId);
              setDynamicToken(null);
              setShowQrModal(false);
              setIsDepositing(false);
              setDepositStep(2);
              setScannedBarcode(null);
              setIsScanSuccess(false);
              setManualBarcodeInput('');
              setScanError(null);
              setVuaNapXong(null);
              if (vuaNapXongTimerRef.current) {
                clearTimeout(vuaNapXongTimerRef.current);
                vuaNapXongTimerRef.current = null;
              }
              setKioskEvents((prev) => prev.filter((e) => e.orderId !== depositFailure.orderId));
              setKioskError(null);
              store.refreshNotifications();
            }
            // Không await: poll phải tiếp tục, và `loadOrders` tự lo state của nó.
            const refreshedOrders = loadOrders();
            if (depositFailure) {
              refreshedOrders.then(() => {
                loadCompartmentSensor(depositFailure.lockerId || lockerId);
              });
            }
          }
        }
        // GĐ42 vòng 2 — mốc `seq` ghi vào REF, không dùng state.
        //
        // Nếu để state và đưa `lastSeq` vào dependency của effect (như bản vòng 1), mỗi nhịp 1,5
        // giây effect bị dựng lại: interval cũ bị clear rồi tạo interval mới, và nhịp vừa bắn có
        // thể rơi vào `cancelled = true` ⇒ sự kiện **không** được xử lý ngay, phải chờ nhịp dự
        // phòng 10 s. Đo thật vòng 2: vẫn **3471 ms / 2964 ms** dù backend đã bắn
        // `DEPOSIT_SUCCESS` (kiểm riêng: `seq: 3` xuất hiện sau 1,2 s).
        if (payload.latestSeq != null) lastSeqRef.current = payload.latestSeq;
        setKioskError(null);
      } catch (err) {
        if (cancelled) return;
        // Không xoá popup đã có; chỉ báo là đang không theo dõi được tủ.
        setKioskError(
          err?.response?.data?.message
            || 'Không đọc được sự kiện từ tủ. Kiểm tra backend đang chạy.'
        );
      }
    };

    poll(); // đọc ngay 1 lần để không trống 1,5 giây đầu
    const timer = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // GĐ42 vòng 2 — CỐ Ý không đưa `lockerId` vào dependency: nếu đưa, mỗi lần danh sách đơn đổi
    // (vd. sau khi nạp xong, `activeOrder` chuyển sang đơn khác/`null`) effect dựng lại và poll
    // gián đoạn đúng lúc cần đọc sự kiện. Poll bám tủ qua `lastPolledLockerRef`; khi đổi tủ thật
    // thì `selectLockerFilter`/chọn đơn vẫn làm effect chạy lại qua `activeOrder?.orderId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.orderId]);

  return (
    <div className="space-y-5 notranslate select-none">
      {/* 4 KPI Metric Cards (Apple Liquid Glass Bento Grid) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span className="uppercase tracking-wider">Tổng đơn ca này</span>
            <div className="w-8 h-8 rounded-2xl bg-blue-500/15 text-blue-600 flex items-center justify-center font-bold">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 mt-1 font-mono">{orders.length}</div>
        </div>

        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-amber-700 font-semibold">
            <span className="uppercase tracking-wider">Chờ nạp vào ngăn</span>
            <div className="w-8 h-8 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center font-bold">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-amber-600 mt-1 font-mono">{pendingOrders.length}</div>
        </div>

        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold">
            <span className="uppercase tracking-wider">Đã nạp thành công</span>
            <div className="w-8 h-8 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-emerald-600 mt-1 font-mono">{depositedOrders.length}</div>
        </div>

        <div
          onClick={() => onNavigateToRecall && onNavigateToRecall()}
          className="liquid-glass-card p-5 rounded-3xl border border-white/80 hover:bg-white/60 shadow-lg cursor-pointer transition hover:-translate-y-0.5 space-y-1"
          title="Chuyển sang tab Thu hồi hàng quá hạn"
        >
          <div className="flex items-center justify-between text-xs text-rose-700 font-semibold">
            <span className="uppercase tracking-wider">Cần thu hồi (24h)</span>
            <div className="w-8 h-8 rounded-2xl bg-rose-500/15 text-rose-600 flex items-center justify-center font-bold animate-pulse">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-rose-600 mt-1 font-mono flex items-center gap-1.5">
            <span>{overdueOrders.length}</span>
            {/* GĐ49c — BỎ thuật ngữ "Zero-Touch" (tiếng Anh, hội đồng hỏi nghĩa). Đổi sang tiếng
                Việt dễ hiểu; tương phản `text-rose-700` trên `bg-rose-50` đạt ≥4.5:1. */}
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 whitespace-nowrap">
              Xem danh sách →
            </span>
          </div>
        </div>
      </div>

      {/* Action Strip: Xác thực danh tính tại Kiosk. GĐ15 — mã QR không còn hạn 60s. */}
      <div className="liquid-glass-card border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm bg-gradient-to-r from-amber-50/80 via-orange-50/40 to-amber-50/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-900 text-xs font-bold uppercase tracking-wide">
            <ShieldCheck className="w-4 h-4 text-amber-700" /> Xác thực danh tính Shipper
          </div>
        </div>

        <button
          onClick={handleGenerateToken}
          className="ios-btn bg-gradient-to-r from-amber-500 via-amber-400 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold px-5 py-2.5 rounded-2xl text-xs shadow-md shadow-amber-500/20 flex items-center gap-2 cursor-pointer whitespace-nowrap transition border border-white/40"
        >
          <QrCode className="w-4 h-4" />
          {/* GĐ15 — mã QR vĩnh viễn nên không còn là "sinh mới 60s". */}
          <span>Xem mã QR định danh</span>
        </button>
      </div>

      {/* GĐ49c — THANH TIẾN TRÌNH 4 BƯỚC Ở ĐẦU KHU LÀM VIỆC.
          CHỈ ĐỌC state có sẵn (điều cấm #1) — không đổi state, không gọi API, không timer.

          ⚠ VÌ SAO KHÔNG DÙNG THẲNG `depositStep`: đo thật cho thấy `handleStartDepositProcess`
          (nơi `setDepositStep(1)` + `setIsDepositing(true)`) **không được gọi ở đâu cả** sau GĐ17,
          nên `depositStep` luôn = 1 dù shipper đã chọn đơn — thanh sẽ đứng nguyên bước 1 mãi.
          Vì thế bước được SUY từ hai nguồn THẬT đang có:
            • `activeOrder` — đã chọn đơn chưa;
            • `kioskEvents` — sự kiện phần cứng đã báo (`SHIPPER_VERIFIED`, `ORDER_VALID`,
              `COMPARTMENT_SELECTED`, `DEPOSIT_SUCCESS`), đúng nguồn mà thanh 3 bước GĐ38 dùng.
          Đây là suy ra từ dữ liệu thật, không phải bịa tiến trình. */}
      <DepositSteps
        buocHienTai={(() => {
          // GĐ57 vòng sửa 1 — ĐANG GIỮ BƯỚC 6 SAU KHI NẠP XONG (≥4 s, xem effect ở trên).
          // Shipper chọn đơn KHÁC thì `selectedOrderId` lệch mã đơn vừa nạp ⇒ nhả ngay, theo đơn mới.
          if (vuaNapXong && (!selectedOrderId || selectedOrderId === vuaNapXong.orderId)) return 6;
          if (depositFailureInfo?.orderId === selectedOrderId) return 2;
          if (!activeOrder) return 1;                       // chưa chọn đơn
          const eventsForActiveOrder = kioskEvents.filter(
            (e) => e.orderId === activeOrder.orderId
          );
          const co = (loai) => eventsForActiveOrder.some((e) => e.type === loai);
          if (co('DEPOSIT_SUCCESS')) return 6;              // tủ đã chốt nạp xong: cả 5 tick
          if (co('COMPARTMENT_SELECTED')) return 5;
          if (co('ORDER_VALID')) return 4;
          if (co('SHIPPER_VERIFIED')) return 3;
          return 2;                                       // đã chọn đơn, chờ quét QR tại tủ
        })()}
      />

      {depositFailureInfo && (
        <div
          role="alert"
          data-testid="deposit-failure"
          className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Nạp hàng thất bại · Đơn {depositFailureInfo.orderId}</p>
            <p className="mt-1">
              {depositFailureInfo.message || 'Ngăn chưa phát hiện kiện hàng.'}
              {' '}Tiến trình đã quay về bước quét QR shipper. Quét lại mã để thử nạp hàng.
            </p>
            {depositFailureInfo.compartmentIndex != null && (
              <p className="mt-1 font-semibold">Ngăn #{depositFailureInfo.compartmentIndex} đã được trả lại.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDepositFailureInfo(null)}
            className="shrink-0 p-1 rounded-lg hover:bg-rose-100 cursor-pointer"
            aria-label="Đóng thông báo nạp hàng thất bại"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* GĐ57 — phản hồi LỖI từ tủ (thay cho khối "Theo dõi tủ thật" đã bỏ): chỉ khi sự kiện MỚI
          NHẤT (seq lớn nhất) của đơn đang chọn không phải loại thành công. Sự kiện thành công tiếp
          theo ⇒ dòng tự mất. Sự kiện không gắn orderId vẫn tính (lỗi quét sai mã chưa biết đơn). */}
      {activeOrder && (() => {
        const lienQuan = kioskEvents.filter((e) => !e.orderId || e.orderId === activeOrder.orderId);
        if (lienQuan.length === 0) return null;
        const moiNhat = lienQuan.reduce((a, b) => ((b.seq ?? 0) > (a.seq ?? 0) ? b : a));
        if (KIOSK_EVENT_THANH_CONG.has(moiNhat.type || '')) return null;
        return (
          <div
            data-testid="kiosk-error-line"
            role="alert"
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {moiNhat.type === 'DEPOSIT_LEFT_EMPTY' && <strong>Nạp hàng thất bại: </strong>}
              {moiNhat.message || moiNhat.type}
            </span>
          </div>
        );
      })()}

      {depositLeftInfo && (
        <div
          data-testid="deposit-left-empty-popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4"
        >
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-rose-200 bg-white">
            <button
              onClick={() => setDepositLeftInfo(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-rose-200">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="text-base font-extrabold text-rose-700">Bạn quên nạp hàng</h3>
            <p className="text-xs text-slate-600 mt-2">
              Ngăn đã trả lại. Vui lòng nạp lại kiện hàng trước khi kết thúc phiên.
            </p>
            <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-200 flex justify-between text-xs">
              <span className="text-slate-500">Mã đơn</span>
              <span className="font-mono font-bold text-slate-900">{depositLeftInfo.orderId || '—'}</span>
            </div>
            <button
              onClick={() => setDepositLeftInfo(null)}
              className="mt-5 w-full py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace (Deposit Flow & Queue) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* PANE 1: PENDING ORDERS LIST (5 cols) */}
        <div className="lg:col-span-5 space-y-3">          <div className="flex flex-wrap items-center justify-between px-1 gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Hàng Chờ Nạp ({filteredPending.length})
            </span>
            <div className="flex items-center gap-2">
              {/* GĐ21 — CHỌN KHÁCH HÀNG cho đơn tạo hộ.
                  Trước đây không có hộp này và hàm tạo đơn ghi cứng "Đoàn Viết Hoàng", nên mọi
                  đơn tạo từ màn shipper đều gán cho đúng một khách dù khách thật là ai. */}
              <select
                value={selectedCustomerId ?? ''}
                onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                disabled={loadingCustomers || customers.length === 0}
                className="text-[11px] bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-xl px-2 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs cursor-pointer max-w-[190px] truncate disabled:opacity-50"
                title={customersError || 'Chọn khách hàng sẽ nhận đơn này'}
              >
                {loadingCustomers && <option value="">Đang tải khách…</option>}
                {!loadingCustomers && customers.length === 0 && (
                  <option value="">Không có khách hàng</option>
                )}
                {customers.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.fullName} · {c.phone}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={handleCreateSampleOrder}
                disabled={loadingCustomers || customers.length === 0}
                className="ios-btn text-[11px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title={customersError || 'Tạo thêm 1 đơn hàng chờ nạp cho khách đã chọn'}
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ Thêm đơn</span>
              </button>

              <select
                value={selectedLockerFilter}
                onChange={(e) => setSelectedLockerFilter(e.target.value)}
                className="text-xs bg-white/90 backdrop-blur-md border border-slate-200/90 rounded-xl px-2.5 py-1 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs cursor-pointer max-w-[150px] truncate"
              >
                <option value="ALL">📍 Tất cả trạm</option>
                {allLockers.map((lk) => (
                  <option key={lk.lockerId} value={lk.lockerId}>
                    {lk.name.replace('Tủ Giao Nhận ', '')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {usingMockData && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 text-amber-800 text-[11px] rounded-xl flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Đang dùng dữ liệu mô phỏng (không gọi được API). Kiểm tra đăng nhập SHIPPER và backend.</span>
            </div>
          )}

          {sampleToast && (
            <div className="p-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-xl flex items-center justify-between animate-in fade-in duration-200 shadow-2xs">
              <div className="flex items-center gap-1.5 font-medium truncate">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="truncate">{sampleToast}</span>
              </div>
              <button
                onClick={() => setSampleToast(null)}
                className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer ml-1"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="space-y-3 max-h-[750px] overflow-y-auto pr-1">
            {filteredPending.length === 0 ? (
              <div className="liquid-glass-card p-10 rounded-3xl border border-white/80 text-center shadow-sm">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800 text-sm">Đã nạp hết hàng!</h4>
                <p className="text-xs text-slate-500 mt-1">Không còn kiện hàng nào chờ nạp tại trạm này.</p>
              </div>
            ) : (
              filteredPending.map((ord) => {
                const isSelected = activeOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => handleSelectPendingOrder(ord.orderId)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'liquid-glass-card border-amber-500/90 ring-2 ring-amber-500/30 shadow-xl shadow-amber-500/15 -translate-y-0.5'
                        : 'liquid-glass-subtle border-white/70 hover:border-white/95 hover:bg-white/60 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50/80 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                        {ord.orderId}
                      </span>
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200">
                        {/* Gộp ThanhChung (Q1) — hàng chờ chỉ có đơn giao cho chính shipper này, do
                            Admin phân công HOẶC do shipper tự tạo; nhãn cũ "Đơn Admin phân công" sai
                            với trường hợp sau. */}
                        Đã giao cho bạn
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-xs truncate">
                      {ord.productName}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100/70">
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" /> {ord.lockerName || 'Chưa chọn tủ'}
                      </span>
                      <span className="font-bold text-slate-700 bg-white/70 px-2 py-0.5 rounded-md text-[10px] border border-white/80">
                        {ord.isShipperReserved
                          ? `Đã đặt trước${ord.compartmentIndex ? ` · Ngăn #${ord.compartmentIndex}` : ''}`
                          : 'Chưa đặt trước'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANE 2: 4-STEP DEPOSIT PROCESS WORKSPACE (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {activeOrder ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md space-y-5">
              {/* Stepper Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md">
                      {activeOrder.orderId}
                    </span>
                    <span className="text-xs text-slate-500">
                      Người nhận: <strong className="text-slate-800">{activeOrder.customerName}</strong> ({activeOrder.customerPhone})
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-1.5">
                    {activeOrder.productName}
                  </h3>
                </div>
              </div>

              {/* Tủ đích do Admin gán. Shipper không được đổi tủ. */}
              <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs uppercase">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span>Tủ giao hàng</span>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 block font-semibold uppercase">Tủ hiện tại</span>
                    <span className="text-sm font-bold text-slate-800">
                      {activeOrder.lockerId
                        ? (activeOrder.lockerName || activeOrder.lockerId)
                        : 'Chưa có tủ — Admin cần phân công tủ'}
                    </span>
                  </div>
                  {activeOrder.lockerId && (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      Đã chốt tuyến
                    </span>
                  )}
                </div>

              </div>

              {/* T3 — PANEL ĐẶT TRƯỚC NGĂN (gọi API thật).
                  GĐ11: ẩn khi đơn CHƯA có tủ — không biết tủ thì không có ngăn nào để giữ. */}
              {!activeOrder.lockerId && (
                <div className="p-3 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-[11px] text-slate-500 flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                  <span>Chọn tủ trước, sau đó mới đặt trước được ngăn.</span>
                </div>
              )}
              {activeOrder.lockerId && (
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs uppercase">
                    <Layers className="w-4 h-4 text-indigo-600" />
                    <span>Đặt trước ngăn tủ</span>
                  </div>
                  <span className="text-[10px] text-indigo-700 font-semibold">
                    {isLoadingCompartments
                      ? 'Đang tải ngăn…'
                      : `${reserveCompartments.filter(
                        (c) => String(c.status).toUpperCase() === 'EMPTY'
                      ).length} ngăn trống`}
                  </span>
                </div>

                <div>
                  <label className="text-[10px] text-slate-600 font-semibold uppercase block mb-1">
                    Mã vận đơn (in trên nhãn)
                  </label>
                  <input
                    type="text"
                    value={reserveTrackingCode}
                    onChange={(e) => setReserveTrackingCode(e.target.value)}
                    placeholder={activeOrder.trackingCode || activeOrder.orderId}
                    className="w-full text-xs bg-white border border-indigo-200 rounded-xl px-3 py-2 font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400/30"
                  />
                </div>

                {/* GĐ21 — CHỌN THỜI HẠN GIỮ CHỖ. Hạn được lưu RIÊNG trên từng đơn; trước đây
                    mọi đơn dùng chung một hằng số 120 phút nên không ai chọn được. */}
                <div>
                  <span className="text-[10px] text-slate-600 font-semibold uppercase block mb-1">
                    Thời hạn giữ chỗ
                  </span>
                  <div className="flex gap-1.5">
                    {[1, 2].map((h) => {
                      const on = reserveHours === h;
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setReserveHours(h)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                            on
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                              : 'bg-white text-slate-700 border-indigo-200 hover:border-indigo-400'
                          }`}
                        >
                          {h} giờ
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] text-slate-600 font-semibold uppercase block mb-1">
                    Chọn ngăn trống
                  </span>
                  {reserveCompartments.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic">
                      {isLoadingCompartments ? 'Đang tải…' : 'Tủ này hiện không còn ngăn trống.'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {reserveCompartments.map((c) => {
                        const idx = c.compIndex;
                        const chosen = reserveCompIndex === idx;
                        return (
                          <button
                            key={c.compartmentId ?? idx}
                            type="button"
                            onClick={() => setReserveCompIndex(idx)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                              chosen
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-white text-slate-700 border-indigo-200 hover:border-indigo-400'
                            }`}
                          >
                            {/* GĐ18 — chỉ hiện số ngăn, bỏ "· S/L" (mọi ngăn dùng được như nhau). */}
                            #{idx}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {reserveMessage && (
                  <div
                    className={`p-2.5 rounded-xl text-[11px] font-medium flex items-start gap-1.5 ${
                      reserveMessage.type === 'success'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                    }`}
                  >
                    {reserveMessage.type === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    )}
                    <span>{reserveMessage.text}</span>
                  </div>
                )}

                <div className="flex gap-2">
                  {reservedOrderIds[activeOrder.orderId] ? (
                    <button
                      type="button"
                      disabled={isReserving}
                      onClick={handleCancelReserve}
                      className="flex-1 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Huỷ đặt trước</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isReserving || !reserveCompIndex}
                      onClick={handleReserve}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>{isReserving ? 'Đang xử lý…' : 'Đặt trước ngăn'}</span>
                    </button>
                  )}
                </div>
              </div>
              )}

              {/* Real-Time Locker Visual Cabinet */}
              <div className="pt-2">
                <LockerCabinetVisualizer
                  lockerName={activeOrder.lockerName}
                  lockerId={activeOrder.lockerId}
                  activeSlotId={activeOrder.compartmentIndex}
                  // GĐ39 — TRUYỀN TOÀN BỘ NGĂN CỦA TỦ.
                  //
                  // Trước GĐ39 chỗ này lọc `sensor.compIndex === activeOrder.compartmentIndex` nên chỉ
                  // đưa xuống ĐÚNG 1 phần tử ⇒ sơ đồ chỉ vẽ 1 ngăn dù tủ có 2 (user báo kèm ảnh).
                  // Shipper LUÔN cần thấy đủ ngăn để biết ngăn nào trống mà chọn; ngăn của đơn vẫn
                  // nổi bật nhờ `activeSlotId` (component tô `ring-2` cho slot khớp, không cần lọc).
                  // `compartments === null` (chưa đọc được) ⇒ component dùng `defaultSlots` (2 ngăn),
                  // KHÔNG bịa status (điều cấm #2).
                  compartments={compartments}
                  // GĐ40 — telemetry THẬT thay cho "ESP32 12ms"/"MQTT 1883" hard-code.
                  telemetry={telemetry}
                  // GĐ5-A2 — CẢM BIẾN CỬA THẬT (MC-38) từ `isDoorClosed`.
                  //
                  // Chọn phương án (b) của thẻ: dùng dữ liệu thật, FALLBACK theo bước UI khi
                  // CHƯA có bản tin. Lý do bắt buộc phải fallback: thiết bị chỉ publish trạng
                  // thái khi có thay đổi; nếu shipper bấm "Mở cửa" mà MQTT im lặng (mất mạng,
                  // tủ chưa gửi), `isDoorClosed` vẫn là `true` từ lần đọc trước → UI hiện CLOSED
                  // trong khi cửa vừa được lệnh mở, nhìn như nút bấm không tác dụng.
                  // Vì vậy: có dữ liệu thật thì tin dữ liệu thật; chưa có thì mới tạm bám theo
                  // bước nghiệp vụ (2–3 = đang mở). Cả hai trường hợp đều KHÔNG bịa số cân.
                  doorState={
                    sensor.doorClosed != null
                      ? (sensor.doorClosed ? 'CLOSED' : 'OPEN')
                      : (depositStep === 2 || depositStep === 3 ? 'OPEN' : 'CLOSED')
                  }
                  // GĐ5-A1 — TRỌNG LƯỢNG THẬT (HX711). Đơn vị kg, khớp `sensorWeight` của
                  // component. Không còn số cứng 0.85. Chưa đọc được thì 0 (không bịa).
                  sensorWeight={sensor.weight != null ? sensor.weight : 0}
                  compact={true}
                />
              </div>
            </div>
          ) : (
            /* GĐ49c — THU GỌN ô trống: trước đây `p-12` + icon 12 đơn vị chiếm gần nửa cột phải
               trong khi chẳng có thông tin gì. Nay gọn + có hướng dẫn ngắn đúng 3 việc cần làm. */
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-5 text-center">
              <Package className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
              <p className="font-semibold text-slate-800 text-xs">Chưa chọn kiện hàng nào để nạp</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Chọn một đơn ở cột «Hàng Chờ Nạp» bên trái để bắt đầu: chọn đơn → quét mã QR shipper
                tại tủ → bỏ kiện vào ngăn → đóng cửa để hệ thống xác nhận.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* GĐ15 — Modal QR Định Danh Shipper (mã VĨNH VIỄN, không đếm ngược) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl relative border border-slate-200 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-amber-200 shadow-2xs">
              <Truck className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Định Danh Shipper</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Tài khoản: <strong className="text-slate-900">{currentUser?.fullName}</strong>
            </p>

            <div className="bg-white p-3.5 rounded-2xl border border-slate-200 inline-block my-3 shadow-md">
              <QRCodeSVG value={dynamicToken} size={180} />
            </div>

            {/* GĐ15 — KHÔNG còn đếm ngược. Mã QR shipper là VĨNH VIỄN (user chốt). */}
            <div className="mb-4" />

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
