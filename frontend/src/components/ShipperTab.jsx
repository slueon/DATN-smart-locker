import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
// GĐ15 — KHÔNG còn CircularTimer ở file này (mã QR shipper giờ vĩnh viễn, không đếm ngược).
// File `CircularTimer.jsx` VẪN GIỮ vì `CustomerPickupTab` + `ShipperRecallTab` còn dùng cho OTP khách.
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { shipperApi, lockerApi, orderApi } from '../services/api';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, Box, AlertCircle, X,
  DoorOpen, Weight, Layers, ArrowRight, User, PackageX,
  Barcode, ScanLine, Scan, Camera, Sparkles, ChevronRight,
  Shield, Volume2, Cpu, Clock, PlusCircle, Radio
} from 'lucide-react';

export default function ShipperTab({ currentUser, onNavigateToRecall }) {
  const [orders, setOrders] = useState([]);
  const [allLockers, setAllLockers] = useState([]);
  const [sampleToast, setSampleToast] = useState(null);
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
   * <p><b>Vì sao `lastSeq`:</b> backend dùng `seq` tăng đơn điệu. Mỗi lần poll gửi `after=lastSeq`
   * thì chỉ nhận sự kiện MỚI → popup không phát lại. Lần đầu `lastSeq = null` → backend trả
   * `events: []` + `latestSeq`, nên mở tab không hiện lại popup của lần test trước.
   */
  const [kioskEvents, setKioskEvents] = useState([]);
  const [lastSeq, setLastSeq] = useState(null);
  const [kioskError, setKioskError] = useState(null);

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
  const [isReserving, setIsReserving] = useState(false);
  const [isLoadingCompartments, setIsLoadingCompartments] = useState(false);
  // Đơn đã đặt trước hay chưa: backend KHÔNG trả `shipperReservedAt`, nên suy ra từ
  // việc `reserve` có bị 400 "đã được đặt trước" hay không, hoặc từ lần reserve thành công.
  const [reservedOrderIds, setReservedOrderIds] = useState({});
  const [usingMockData, setUsingMockData] = useState(false);

  // GĐ11 — SHIPPER CHỌN TỦ GIAO HÀNG.
  //
  // Mô hình mới: khách chỉ nhận hàng, đơn có thể ra đời mà chưa gán tủ (`lockerId = null`).
  // Shipper tự chọn tủ; backend lọc sẵn tủ khả dụng (còn ngăn trống đúng cỡ, không bảo trì,
  // nhịp tim < 5 phút, lấp đầy < 80%) nhưng danh sách đó CHỈ là gợi ý.
  const [suggestLockers, setSuggestLockers] = useState([]);
  const [isLoadingSuggest, setIsLoadingSuggest] = useState(false);
  const [showSuggestPanel, setShowSuggestPanel] = useState(false);
  // Bấm thẻ tủ lần 1 chỉ mở hộp xác nhận (0 request); bấm "Xác nhận" mới gọi API.
  const [pendingAssignLocker, setPendingAssignLocker] = useState(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState(null);

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
  const [sensor, setSensor] = useState({
    weight: null,       // kg — null = chưa đọc được
    doorClosed: null,   // true/false — null = chưa có bản tin
    updatedAt: null,    // thời điểm đọc được lần cuối
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

  useEffect(() => {
    // GĐ13 — KHÔNG còn `store.checkAndScanOverdueOrders()`.
    //
    // Hàm đó quét mảng đơn trong localStorage rồi trả `sweptCount`; con số không liên quan tới DB
    // (việc chuyển đơn sang OVERDUE do `OverdueSchedulerService` ở backend quyết định, mỗi 10 phút).
    // Nay tab shipper chỉ tải danh sách THẬT: đơn chờ nạp qua API, đơn quá hạn qua
    // `shipperApi.getOverdueOrders` (dùng ở tab Thu hồi).
    loadOrders();
    setAllLockers(store.getLockers());

    const handleUpdate = () => {
      loadOrders();
      setAllLockers(store.getLockers());
    };
    const handleOverdueDetected = () => loadOrders();

    // Poll lại danh sách từ API mỗi 30 giây (backend tự quét theo lịch riêng của nó).
    const scanTimer = setInterval(() => {
      loadOrders();
    }, 30000);

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

      if (apiOrders.length > 0) {
        const reservedMap = {};
        apiOrders.forEach((o) => {
          if (o.isShipperReserved) {
            reservedMap[o.orderId] = o.compartmentIndex || true;
          }
        });
        setReservedOrderIds((prev) => ({ ...reservedMap, ...prev }));

        if (!selectedOrderId) {
          setSelectedOrderId(apiOrders[0].orderId);
        }
      }
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

    try {
      // 1. Gửi request tạo đơn hàng thật vào Backend CSDL
      const today = new Date().toISOString().split('T')[0];
      const res = await orderApi.checkout({
        customerName: 'Đoàn Viết Hoàng',
        customerPhone: '0988123456',
        deliveryType: 'LOCKER',
        lockerId: 'LOCKER_HN_01',
        deliveryDate: today,
        productName: randProd.name,
        requiredSize: randProd.size,
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
        setSelectedOrderId(ord.orderId);
        setSampleToast(`Đã tạo đơn THẬT ${ord.orderId} cho Đoàn Viết Hoàng (0988123456) trên máy chủ.`);
        setTimeout(() => setSampleToast(null), 3500);
        return;
      }
    } catch (err) {
      console.warn('[ShipperTab] Gọi API checkout thất bại, dùng đơn mẫu trong trình duyệt:', err?.message);
    }

    // 2. GĐ13 — FALLBACK DEMO: không tạo được đơn thật thì sinh một đơn MẪU trong localStorage.
    //
    // Đây là dữ liệu MẪU để demo luồng UI, KHÔNG phải đơn trong CSDL: nó không có trong
    // `GET /api/shipper/orders/pending`, không thể nạp hàng thật, và biến mất khi xoá cache.
    // Thông báo bên dưới phải nói rõ điều đó — trước đây nó báo y hệt nhánh thành công
    // ("Đã thêm đơn …"), nên người xem demo tưởng đã tạo được đơn thật.
    const newOrd = store.generateSamplePendingOrder('LOCKER_HN_01');
    await loadOrders();
    setSelectedOrderId(newOrd.orderId);
    setSampleToast(
      `Đã tạo đơn MẪU ${newOrd.orderId} trên trình duyệt này (chỉ để xem giao diện — KHÔNG có trong CSDL, không nạp hàng thật được).`
    );
    setTimeout(() => setSampleToast(null), 5000);
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
      setDynamicToken(token);
      setShowQrModal(true);
      setScanError(null);
    } catch (err) {
      const msg = err?.response?.data?.message
        || 'Không tạo được mã QR shipper. Kiểm tra đã đăng nhập bằng tài khoản SHIPPER và backend đang chạy.';
      setScanError(msg);
    }
  };

  const handleStartDepositProcess = (orderId) => {
    setSelectedOrderId(orderId);
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
        playBeep();
        setSelectedOrderId(matchedOrder.orderId);
        setScannedBarcode(matchedOrder.orderId);
        setIsScanSuccess(true);
        setManualBarcodeInput('');
        setScanError(null);
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
          const isSelf = assignedIdx != null && c.compIndex === assignedIdx;
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
  const loadCompartmentSensor = async (lockerId, compIndex) => {
    if (!lockerId || compIndex == null) return null;
    try {
      const res = await lockerApi.getCompartments(lockerId);
      const list = res?.data?.data || [];
      const comp = list.find((c) => c.compIndex === compIndex);
      if (!comp) {
        setSensor({ weight: null, doorClosed: null, updatedAt: null });
        return null;
      }
      const data = {
        // DB lưu GRAM (xem ghi chú đơn vị ở khối state `sensor`), component hiểu KG → chia 1000.
        weight: comp.currentWeight != null ? Number(comp.currentWeight) / 1000 : 0,
        doorClosed: comp.isDoorClosed != null ? Boolean(comp.isDoorClosed) : null,
        updatedAt: new Date(),
      };
      setSensor(data);
      return data;
    } catch {
      // Mất mạng / 401: giữ giá trị cũ, không xoá trắng để UI không nhảy về 0.
      return null;
    }
  };

  /**
   * GĐ11 — tải danh sách tủ gợi ý cho đơn đang chọn.
   *
   * <p>Chỉ gọi khi người dùng bấm "Đổi tủ / Chọn tủ" (không tự gọi khi mở tab) để không đốt
   * request cho mọi đơn, và để mỗi lần mở là một lần lấy trạng thái tủ mới nhất.
   */
  const loadSuggestLockers = async (orderId) => {
    if (!orderId) return;
    setIsLoadingSuggest(true);
    setAssignMessage(null);
    try {
      const res = await shipperApi.getSuggestLockers(orderId);
      setSuggestLockers(res?.data?.data || []);
    } catch (err) {
      setSuggestLockers([]);
      setAssignMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không tải được danh sách tủ gợi ý.',
      });
    } finally {
      setIsLoadingSuggest(false);
    }
  };

  const handleOpenSuggestPanel = async () => {
    if (!activeOrder) return;
    setShowSuggestPanel(true);
    setPendingAssignLocker(null);
    await loadSuggestLockers(activeOrder.orderId);
  };

  /**
   * GĐ11 — chốt tủ cho đơn.
   *
   * <p>Hai bước: bấm thẻ tủ chỉ đặt `pendingAssignLocker` (KHÔNG gọi API), bấm "Xác nhận" trong
   * hộp thoại mới thật sự gọi `assignLocker`. Đổi tủ là thao tác làm thay đổi ngăn vật lý của tủ
   * nên phải xác nhận rõ tủ cũ → tủ mới.
   */
  const handleConfirmAssignLocker = async () => {
    if (!activeOrder || !pendingAssignLocker) return;
    setIsAssigning(true);
    setAssignMessage(null);
    try {
      const res = await shipperApi.assignLocker(activeOrder.orderId, {
        lockerId: pendingAssignLocker.lockerId,
      });
      const data = res?.data?.data;
      setAssignMessage({
        type: 'success',
        text: `Đã chốt tuyến: ${data?.lockerName || pendingAssignLocker.name}`
          + (data?.compartmentIndex ? ` · Ngăn #${data.compartmentIndex}` : ''),
      });
      setPendingAssignLocker(null);
      setShowSuggestPanel(false);
      await loadOrders();
      await loadReserveCompartments(data?.lockerId || pendingAssignLocker.lockerId, data?.compartmentIndex);
    } catch (err) {
      // 409 = tủ đích vừa hết ngăn / đang bảo trì / mất nhịp tim. Backend đã rollback: ngăn cũ
      // ở tủ trước vẫn còn RESERVED, nên chỉ cần báo lỗi và cho shipper chọn tủ khác.
      setAssignMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không chốt được tủ này. Vui lòng chọn tủ khác.',
      });
      setPendingAssignLocker(null);
      await loadSuggestLockers(activeOrder.orderId);
    } finally {
      setIsAssigning(false);
    }
  };

  /** T3 — đặt trước ngăn cho đơn đang chọn. */
  const handleReserve = async () => {    if (!activeOrder) return;
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
      };
      const res = await shipperApi.reserveCompartment(activeOrder.orderId, body);
      const compIdx = res?.data?.data?.compartmentIndex || reserveCompIndex;
      setReservedOrderIds((prev) => ({ ...prev, [activeOrder.orderId]: compIdx }));
      setReserveMessage({ type: 'success', text: `Đã đặt trước ngăn #${compIdx}` });
      setReserveCompIndex(null);
      await loadOrders();
      await loadReserveCompartments(activeOrder.lockerId);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Không đặt trước được ngăn này.';
      // Backend không trả `shipperReservedAt`; nếu 400 báo "đã được đặt trước" thì
      // đánh dấu đơn này là đã đặt trước để hiện nút huỷ.
      if (typeof msg === 'string' && msg.toLowerCase().includes('đã được đặt trước')) {
        setReservedOrderIds((prev) => ({ ...prev, [activeOrder.orderId]: activeOrder.compartmentIndex || true }));
      }
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
        const fresh = await loadCompartmentSensor(order.lockerId, order.compartmentIndex);
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
    } catch (err) {
      setReserveMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không gửi được kiện hàng vào tủ.',
      });
    } finally {
      setIsReserving(false);
    }
  };

  const pendingOrders = orders.filter((o) => o.status === 'PENDING');
  const depositedOrders = orders.filter((o) => o.status === 'DEPOSITED' || o.status === 'COMPLETED');
  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');

  const filteredPending = pendingOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  const activeOrder = orders.find((o) => o.orderId === selectedOrderId) || filteredPending[0] || null;

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

  // GĐ5-A1/A2 — POLL cảm biến thật mỗi 2 giây trong lúc shipper đang nạp hàng.
  //
  // Chỉ poll khi đang ở bước 2..4 (đã mở cửa → đặt hàng → kiểm cảm biến), vì đó là lúc số cân
  // và trạng thái cửa thực sự thay đổi. Tắt poll ở bước khác để không gọi API vô ích.
  // Có cleanup `clearInterval` — thiếu nó thì chuyển tab xong vẫn tiếp tục gọi API mãi.
  useEffect(() => {
    const compIndex = activeOrder?.compartmentIndex;
    if (!activeOrder?.lockerId || compIndex == null) return undefined;

    const shouldPoll = isDepositing && depositStep >= 2 && depositStep <= 4;
    if (!shouldPoll) return undefined;

    // Đọc ngay 1 lần rồi mới hẹn chu kỳ, để UI không trống 2 giây đầu.
    loadCompartmentSensor(activeOrder.lockerId, compIndex);
    const timer = setInterval(() => {
      loadCompartmentSensor(activeOrder.lockerId, compIndex);
    }, 2000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.lockerId, activeOrder?.compartmentIndex, isDepositing, depositStep]);

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
    if (!activeOrder?.lockerId) {
      return undefined;
    }

    const lockerId = activeOrder.lockerId;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await shipperApi.getKioskEvents(lockerId, lastSeq);
        if (cancelled) return;

        const payload = res?.data?.data;
        if (!payload) return;

        const events = payload.events || [];
        if (events.length > 0) {
          // Nối vào đầu danh sách, chỉ giữ 20 sự kiện gần nhất để UI không phình.
          setKioskEvents((prev) => [...events, ...prev].slice(0, 20));
        }
        // Luôn cập nhật latestSeq, kể cả khi không có sự kiện: nếu chỉ cập nhật khi có sự kiện
        // thì lần poll sau vẫn hỏi từ mốc cũ → nhận lại đúng những sự kiện vừa xử lý.
        if (payload.latestSeq != null) {
          setLastSeq(payload.latestSeq);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.lockerId, lastSeq]);

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
            <span className="text-xs font-bold text-rose-600 bg-rose-50/80 px-2 py-0.5 rounded-full border border-rose-200">
              Zero-Touch →
            </span>
          </div>
        </div>
      </div>

      {/* Action Strip: Xác thực danh tính tại Kiosk. GĐ15 — mã QR không còn hạn 60s. */}
      <div className="liquid-glass-card border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm bg-gradient-to-r from-amber-50/80 via-orange-50/40 to-amber-50/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-900 text-xs font-bold uppercase tracking-wide">
            <ShieldCheck className="w-4 h-4 text-amber-700" /> Xác thực danh tính Shipper tại Kiosk
          </div>
          <p className="text-xs text-slate-600 max-w-xl leading-relaxed">
            Quét mã QR tại trạm tủ để cấp quyền nạp kiện hàng.
          </p>
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

      {/* Main Workspace (Deposit Flow & Queue) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* PANE 1: PENDING ORDERS LIST (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between px-1 gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Hàng Chờ Nạp ({filteredPending.length})
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCreateSampleOrder}
                className="ios-btn text-[11px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                title="Tạo thêm 1 đơn hàng chờ nạp mẫu cho Shipper"
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
                    onClick={() => {
                      setSelectedOrderId(ord.orderId);
                      if (!isDepositing) {
                        setScannedBarcode(null);
                        setIsScanSuccess(false);
                      }
                    }}
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
                        Chờ nạp
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-xs truncate">
                      {ord.productName}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100/70">
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" /> {ord.lockerName}
                      </span>
                      <span className="font-bold text-slate-700 bg-white/70 px-2 py-0.5 rounded-md text-[10px] border border-white/80">
                        Ngăn #{ord.compartmentIndex} ({ord.compartmentSize})
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

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block font-semibold">Vị trí ngăn chỉ định</span>
                  <span className={`font-extrabold text-sm ${activeOrder.lockerId ? 'text-blue-600' : 'text-amber-600'}`}>
                    {activeOrder.lockerId
                      ? `Ngăn #${activeOrder.compartmentIndex} (Size ${activeOrder.compartmentSize || (activeOrder.compartmentIndex === 1 ? 'S' : 'L')})`
                      : 'Chưa gán tủ'}
                  </span>
                </div>
              </div>

              {/* GĐ11 — KHỐI "CHỌN TỦ GIAO HÀNG" (đặt TRƯỚC panel đặt trước ngăn).
                  Đơn chưa có tủ là chuyện bình thường từ GĐ11: khách chỉ nhận hàng, shipper chọn tủ.
                  Đặt trước ngăn phải ẩn khi chưa có tủ, vì không biết tủ nào thì không có ngăn để giữ. */}
              <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs uppercase">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span>Chọn tủ giao hàng</span>
                  </div>
                  <button
                    type="button"
                    onClick={showSuggestPanel ? () => setShowSuggestPanel(false) : handleOpenSuggestPanel}
                    className="text-[11px] font-bold bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    {showSuggestPanel ? 'Đóng danh sách' : (activeOrder.lockerId ? 'Đổi tủ' : 'Chọn tủ')}
                  </button>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[10px] text-slate-500 block font-semibold uppercase">Tủ hiện tại</span>
                    <span className="text-sm font-bold text-slate-800">
                      {activeOrder.lockerId
                        ? (activeOrder.lockerName || activeOrder.lockerId)
                        : 'Chưa có tủ — chọn tủ bên dưới'}
                    </span>
                  </div>
                  {activeOrder.lockerId && (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      <CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-0.5" />
                      Đã chốt tuyến
                    </span>
                  )}
                </div>

                {assignMessage && (
                  <div
                    className={`p-2.5 rounded-xl text-[11px] font-medium flex items-start gap-1.5 ${
                      assignMessage.type === 'success'
                        ? 'bg-emerald-100 border border-emerald-300 text-emerald-800'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                    }`}
                  >
                    {assignMessage.type === 'success'
                      ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    <span>{assignMessage.text}</span>
                  </div>
                )}

                {showSuggestPanel && (
                  <div className="space-y-2">
                    {isLoadingSuggest ? (
                      <p className="text-[11px] text-slate-500 italic flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Đang tải tủ khả dụng…
                      </p>
                    ) : suggestLockers.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic">
                        Không có tủ nào đủ điều kiện nhận kiện này (cần ngăn trống, tủ đang hoạt động và chưa kín).
                      </p>
                    ) : (
                      suggestLockers.map((lk) => {
                        const isCurrent = lk.isSuggestedByOrder || lk.lockerId === activeOrder.lockerId;
                        return (
                          <div
                            key={lk.lockerId}
                            className={`p-3 rounded-xl border bg-white ${
                              isCurrent ? 'border-emerald-400 ring-1 ring-emerald-200' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-slate-900 truncate">{lk.name}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                      Tủ đề xuất
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-500 truncate">{lk.address}</p>
                                <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold">
                                  <span className="text-slate-700">
                                    {lk.availableCompartments}/{lk.totalCompartments} ngăn trống
                                  </span>
                                  <span
                                    className={
                                      lk.healthLabel === 'Online'
                                        ? 'text-emerald-600'
                                        : lk.healthLabel === 'Không rõ'
                                        ? 'text-amber-600'
                                        : 'text-rose-600'
                                    }
                                  >
                                    · {lk.healthLabel}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isAssigning}
                                onClick={() => setPendingAssignLocker(lk)}
                                className="shrink-0 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-60"
                              >
                                Chọn tủ này
                              </button>
                            </div>

                            {/* Xác nhận 2 bước: bấm "Chọn tủ này" chỉ mở hộp thoại này — 0 request. */}
                            {pendingAssignLocker?.lockerId === lk.lockerId && (
                              <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                                <p className="text-[11px] text-slate-700">
                                  Chuyển đơn từ{' '}
                                  <strong>{activeOrder.lockerName || 'chưa có tủ'}</strong> sang{' '}
                                  <strong>{lk.name}</strong>?
                                  <span className="block text-[10px] text-slate-500 mt-0.5">
                                    Ngăn cũ chỉ được nhả khi đang giữ chỗ (RESERVED). Nếu tủ mới hết ngăn,
                                    đơn giữ nguyên tủ cũ.
                                  </span>
                                </p>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={isAssigning}
                                    onClick={handleConfirmAssignLocker}
                                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold py-1.5 rounded-lg transition cursor-pointer disabled:opacity-60"
                                  >
                                    {isAssigning ? 'Đang chốt…' : 'Xác nhận chốt tủ'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isAssigning}
                                    onClick={() => setPendingAssignLocker(null)}
                                    className="px-3 bg-white border border-slate-300 text-slate-700 text-[11px] font-bold py-1.5 rounded-lg transition cursor-pointer"
                                  >
                                    Huỷ
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
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
                      : `${reserveCompartments.length} ngăn trống`}
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
                            #{idx}{c.size ? ` · ${c.size}` : ''}
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

              {/* GĐ17 — THEO DÕI TỦ THẬT (thay thanh 4 bước mô phỏng) */}
              {!isDepositing && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Radio className="w-5 h-5 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Theo dõi tủ thật — {activeOrder.lockerName || activeOrder.lockerId}
                      </span>
                    </div>
                    <span className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      Đang lắng nghe
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Thao tác trực tiếp trên màn hình cảm ứng của tủ. Web tự hiện kết quả khi tủ báo về
                    — không cần bấm gì ở đây.
                  </p>

                  {kioskError && (
                    <div className="p-3 bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{kioskError}</span>
                    </div>
                  )}

                  {kioskEvents.length === 0 ? (
                    <div className="p-6 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950 text-center">
                      <ScanLine className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs text-slate-400 font-semibold">
                        Chờ thao tác tại tủ…
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Bước 1: quét mã QR shipper tại tủ · Bước 2: quét mã vận đơn · Bước 3: chọn ngăn
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {kioskEvents.map((ev) => {
                        // `type` là tên do backend đặt (SHIPPER_VERIFIED, ORDER_VALID, ...).
                        const ok = /VERIFIED|VALID|SUCCESS|SELECTED/.test(ev.type || '');
                        return (
                          <div
                            key={`${ev.seq}-${ev.type}`}
                            className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                              ok
                                ? 'bg-emerald-950/40 border-emerald-500/40'
                                : 'bg-rose-950/40 border-rose-500/40'
                            }`}
                          >
                            {ok
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              : <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                            <div className="min-w-0">
                              <p className={`font-bold ${ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                                {ev.message || ev.type}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {ev.type}
                                {ev.orderId ? ` · ${ev.orderId}` : ''}
                                {ev.compartment ? ` · Ngăn #${ev.compartment}` : ''}
                                {ev.at
                                  ? ` · ${new Date(ev.at).toLocaleTimeString('vi-VN')}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Real-Time Locker Visual Cabinet */}
              <div className="pt-2">
                <LockerCabinetVisualizer
                  lockerName={activeOrder.lockerName}
                  lockerId={activeOrder.lockerId}
                  activeSlotId={activeOrder.compartmentIndex}
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
            <div className="bg-white rounded-3xl border border-slate-200/90 p-12 text-center">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn kiện hàng nào để nạp</h4>
              <p className="text-xs text-slate-500 mt-1">Chọn đơn bên danh sách để kích hoạt quy trình nạp tủ 4 bước.</p>
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
            <div className="my-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Mã QR cố định — dùng được nhiều lần, không cần tạo lại</span>
            </div>

            <p className="text-[11px] text-slate-500 mb-4 px-2">
              Đưa mã QR này trước camera GM65 của tủ để mở khóa quyền nạp hàng.
            </p>

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
