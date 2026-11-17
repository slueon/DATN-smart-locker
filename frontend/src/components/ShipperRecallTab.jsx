import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
// GĐ41 — KHÔNG còn CircularTimer ở file này (mã QR shipper là mã cố định, không đếm ngược).
// File `CircularTimer.jsx` VẪN GIỮ vì `CustomerPickupTab` còn dùng cho OTP khách.
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { shipperApi, lockerApi } from '../services/api';
import {
  AlertTriangle, CheckCircle2, DoorOpen, Weight,
  Check, MapPin, User, Timer, PackageX, Truck, RefreshCw,
  BellRing, X, QrCode, ShieldCheck, Unlock, Lock,
  Sparkles, CheckCheck, Radio, Volume2, ArrowRight,
  Shield, AlertCircle, ChevronRight, XCircle
} from 'lucide-react';

export default function ShipperRecallTab({ currentUser, onNavigateToDeposit }) {
  const [orders, setOrders] = useState([]);
  const [allLockers, setAllLockers] = useState([]);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');
  const [selectedRecallOrderId, setSelectedRecallOrderId] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [alertNotice, setAlertNotice] = useState(null);

  // ===== BƯỚC 1: XÁC THỰC DANH TÍNH SHIPPER TẠI KIOSK =====
  const [dynamicToken, setDynamicToken] = useState(null);
  // GĐ41 — BỎ state `timeLeft` và vòng đếm ngược 60 giây. Mã QR shipper là mã CỐ ĐỊNH (GĐ33),
  // dùng được nhiều lần, nên đếm ngược vừa sai sự thật vừa khiến shipper tưởng phải tạo lại.
  // Cũng bỏ luôn token tự bịa ở client: mã thật lấy từ `/api/shipper/token/generate`. 
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);

  /**
   * GĐ44 — "shipper ĐÃ QUÉT QR THÀNH CÔNG tại tủ" hay chưa.
   *
   * <p><b>Vì sao KHÔNG dùng `dynamicToken != null`:</b> `generateToken` chỉ **cấp** mã; phải quét ở
   * tủ thì backend mới đặt `isVerified = true` và bắn `SHIPPER_VERIFIED`. Dùng `dynamicToken` thì
   * nút hiện ngay khi bấm lấy QR — sai yêu cầu user (điều cấm #2).
   *
   * <p>Nguồn sự thật duy nhất: sự kiện Kiosk `SHIPPER_VERIFIED` của ĐÚNG tủ đang chọn.
   */
  const [shipperVerified, setShipperVerified] = useState(false);
  const [verifyRejectedReason, setVerifyRejectedReason] = useState(null);
  /** Mốc `seq` sự kiện Kiosk đã xử lý — chống xử lý lại cùng sự kiện mỗi nhịp 1,5 giây. */
  /**
   * Mốc `seq` sự kiện Kiosk đã đọc — dùng `useRef` (không phải state) để effect poll KHÔNG chạy
   * lại mỗi khi mốc đổi. Nếu để state + đưa vào dependency thì mỗi 1,5 giây lại sinh thêm một
   * interval (đo được 352 request/5s thay vì 3–4).
   */
  const kioskSeqRef = useRef(null);
  const processedKioskSeqRef = useRef(new Set());

  // ===== BƯỚC 2 -> 4: QUY TRÌNH THU HỒI 1 CHẠM & CẢM BIẾN TỰ ĐỘNG =====
  const [recallPhase, setRecallPhase] = useState('IDLE'); // 'IDLE' | 'DOOR_OPEN' | 'PROCESSING' | 'SUCCESS' | 'FAILSAFE_ERROR'
  const [doorSensorState, setDoorSensorState] = useState('CLOSED'); // 'CLOSED' | 'OPEN'
  const [loadcellWeight, setLoadcellWeight] = useState(0); // KG
  // GĐ5 — khối lượng THẬT đọc từ cảm biến HX711, dùng làm mốc khi vào quy trình thu hồi.
  //
  // Vì sao KHÔNG dùng `activeRecallOrder.weight` nữa: `OrderDTO.OrderResponse` **không có**
  // trường `weight` (xem `ShipperService.getOverdueOrders` — chỉ set orderId/customer/locker/
  // compartment/status/…), nên `activeRecallOrder.weight` LUÔN `undefined` và code cũ rơi
  // vào số bịa `0.85`. Nay đọc `compartments.current_weight` qua `lockerApi.getCompartments`
  // và quy đổi gram → kg (DB lưu gram theo `MqttService:1069`).
  const [sensorWeightKg, setSensorWeightKg] = useState(null);
  const [failsafeMessage, setFailsafeMessage] = useState(null);
  /** GĐ46 — lỗi khi gửi lệnh mở cửa (tủ không nhận / broker chưa kết nối / token hết hiệu lực). */
  const [doorOpenError, setDoorOpenError] = useState(null);
  const [successRecallInfo, setSuccessRecallInfo] = useState(null);

  // ===== HIỆU ỨNG ÂM THANH WEB AUDIO API =====
  const playSolenoidSound = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } catch (e) {}
  };

  const playSuccessChime = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.23);

      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1318.5, now + 0.14);
      gain2.gain.setValueAtTime(0.22, now + 0.14);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.42);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.14);
      osc2.stop(now + 0.43);
    } catch (e) {}
  };

  const playWarningChime = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(310, now + 0.12);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    } catch (e) {}
  };

  /**
   * GĐ5-C2 — danh sách đơn quá hạn lấy từ API THẬT thay vì localStorage.
   *
   * <p>`GET /api/shipper/overdue-orders` trả **đúng** các đơn `OVERDUE`
   * (`ShipperService.getOverdueOrders` lọc `findByStatus("OVERDUE")`), nên KHÔNG cần filter lại
   * theo status như code cũ. Bộ lọc theo TỦ ở dưới (`filteredOverdue`, theo `selectedLockerFilter`)
   * vẫn giữ nguyên — đó là lọc phía UI, độc lập với nguồn dữ liệu.
   *
   * <p>Tham số `lockerId`: truyền `null` khi đang chọn "Tất cả trạm" để backend trả đơn quá hạn
   * của MỌI tủ; truyền mã tủ khi đã chọn một trạm cụ thể.
   */
  const loadOrders = async () => {
    const lockerId = selectedLockerFilter !== 'ALL' ? selectedLockerFilter : null;
    try {
      const res = await shipperApi.getOverdueOrders(lockerId);
      const overdue = res?.data?.data || [];
      // Vẫn giữ toàn bộ `orders` = danh sách quá hạn, vì `overdueOrders` phía dưới tính từ đây.
      setOrders(overdue);

      if (overdue.length > 0) {
        if (!selectedRecallOrderId || !overdue.some((o) => o.orderId === selectedRecallOrderId)) {
          setSelectedRecallOrderId(overdue[0].orderId);
        }
      } else {
        setSelectedRecallOrderId(null);
      }
    } catch (err) {
      // GĐ13 — FALLBACK CÓ KIỂM SOÁT: chỉ chạy khi API lỗi (mất mạng/401) để trang không trắng.
      // Nguồn chính là `shipperApi.getOverdueOrders` ở nhánh try trên; dữ liệu dưới đây là cache
      // trình duyệt và có thể đã cũ — đừng coi là danh sách quá hạn thật.
      console.warn('[ShipperRecallTab] Không tải được đơn quá hạn từ API, dùng cache trình duyệt:', err?.message);
      const all = store.getOrders();
      setOrders(all);
      const overdue = all.filter((o) => o.status === 'OVERDUE');
      if (overdue.length > 0) {
        if (!selectedRecallOrderId || !overdue.some((o) => o.orderId === selectedRecallOrderId)) {
          setSelectedRecallOrderId(overdue[0].orderId);
        }
      } else {
        setSelectedRecallOrderId(null);
      }
    }
  };

  useEffect(() => {
    // GĐ13 — KHÔNG còn `store.checkAndScanOverdueOrders()`.
    //
    // Hàm đó quét mảng đơn trong localStorage rồi trả `sweptCount`; con số báo cho shipper là của
    // trình duyệt, còn DB thì do `OverdueSchedulerService` (Spring, mỗi 10 phút) quyết định. Hai
    // bên lệch nhau và không ai biết tin bên nào. Nay chỉ đọc đơn quá hạn THẬT qua
    // `GET /api/shipper/overdue-orders`; ai chuyển đơn sang OVERDUE là việc của backend.
    setLastScanTime(new Date().toLocaleTimeString('vi-VN'));
    loadOrders();
    setAllLockers(store.getLockers());

    const handleUpdate = () => {
      loadOrders();
      setAllLockers(store.getLockers());
    };
    const handleOverdueDetected = (e) => {
      loadOrders();
      if (e.detail?.count > 0) {
        setAlertNotice(`Phát hiện ${e.detail.count} bưu kiện vừa quá hạn lưu kho tại trạm tủ!`);
      }
    };

    // Poll lại danh sách từ API mỗi 30 giây (backend tự quét theo lịch riêng của nó).
    const scanTimer = setInterval(() => {
      loadOrders();
      setLastScanTime(new Date().toLocaleTimeString('vi-VN'));
    }, 30000);

    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    return () => {
      clearInterval(scanTimer);
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    };
    // GĐ5-C2 — thêm `selectedLockerFilter` vào dependency: khi shipper đổi trạm, danh sách quá
    // hạn phải gọi lại API với `lockerId` mới (backend lọc theo tủ), không dùng lại kết quả cũ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLockerFilter]);

  /**
   * GĐ41 — lấy mã QR THẬT từ backend, giống hệt tab nạp tủ (`ShipperTab.handleGenerateToken`).
   *
   * <p>Trước GĐ41 hàm này **tự bịa** `'SHIPPER-TOKEN-' + Math.random()… + Date.now()` ngay trên
   * trình duyệt. Đo thật: `shipper_identity_tokens` **0 dòng** mang tiền tố đó (toàn bộ 32 token
   * thật là `SHIP-…`) ⇒ đem quét ở tủ luôn bị "Mã QR Shipper không hợp lệ". Điều cấm #1: không
   * được tự sinh token ở client dưới bất kỳ dạng nào.
   */
  const handleGenerateToken = async () => {
    setTokenError(null);
    setTokenLoading(true);
    // GĐ44 — BẤM LẤY QR = MỞ PHIÊN MỚI ⇒ phải reset cờ đã xác thực.
    //
    // Backend `generateDynamicToken` (GĐ33) reset `isVerified = false` để phiên quét lại từ đầu.
    // Nếu UI không reset, nút "Mở Cửa Ngăn" vẫn hiện nhưng bấm sẽ ra 400 "chưa được quét xác
    // thực" — nút chết, tệ hơn ẩn.
    setShipperVerified(false);
    setVerifyRejectedReason(null);
    try {
      const res = await shipperApi.generateToken();
      const ma = res?.data?.data?.dynamicToken;
      if (!ma) {
        // API trả 200 nhưng thiếu mã ⇒ báo lỗi thật, KHÔNG bịa mã thay thế.
        setTokenError('Máy chủ không trả về mã QR. Vui lòng thử lại.');
        return;
      }
      setDynamicToken(ma);
      setShowQrModal(true);
    } catch (err) {
      // Hiện nguyên văn message backend; không báo thành công giả.
      setTokenError(err?.response?.data?.message || 'Không lấy được mã QR shipper. Vui lòng thử lại.');
    } finally {
      setTokenLoading(false);
    }
  };

  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');
  const filteredOverdue = overdueOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  const activeRecallOrder =
    orders.find((o) => o.orderId === selectedRecallOrderId) || filteredOverdue[0] || null;

  /**
   * GĐ44 — POLL SỰ KIỆN KIOSK ĐỂ BIẾT SHIPPER ĐÃ QUÉT QR THÀNH CÔNG.
   *
   * <p>Trước GĐ44 trang này **không** poll Kiosk (chỉ `loadOrders` mỗi 30 s), nên không có nguồn nào
   * để biết đã xác thực — đo thật: **0 request** `/kiosk-events` trong 5 giây.
   *
   * <p><b>Bốn ràng buộc:</b>
   * <ol>
   *   <li><b>Lần poll đầu bỏ trống `after`</b> ⇒ backend trả `events: []` + `latestSeq`. Nếu gửi
   *       `after` cũ thì mở tab là nút hiện ra vì sự kiện của lần trước (lỗi im lặng).</li>
   *   <li>Luôn cập nhật `latestSeq` **kể cả khi không có sự kiện** (bài học `ShipperTab`).</li>
   *   <li>Chống trùng bằng `Set` các `seq` đã xử lý (`processedKioskSeqRef`).</li>
   *   <li>Nhịp **1,5 giây** — cùng nhịp hai tab kia, KHÔNG tạo nhịp rời rạc mới. Chỉ poll SỰ KIỆN,
   *       tuyệt đối không gọi `loadOrders()` theo nhịp này (điều cấm #5).</li>
   * </ol>
   *
   * <p>Đổi đơn ⇒ `lockerId`/`orderId` đổi ⇒ effect chạy lại và reset cờ (đơn khác tủ ⇒ phiên xác
   * thực khác). Cleanup `clearInterval` khi unmount.
   */
  useEffect(() => {
    const lockerId = activeRecallOrder?.lockerId;
    const orderId = activeRecallOrder?.orderId;
    if (!lockerId || !orderId) return undefined;

    // Đổi đơn đang chọn ⇒ mở phiên mới: chưa xác thực, quên mốc cũ của tủ trước.
    setShipperVerified(false);
    setVerifyRejectedReason(null);
    kioskSeqRef.current = null;
    processedKioskSeqRef.current = new Set();

    let cancelled = false;

    const poll = async () => {
      try {
        // Lần đầu `kioskSeqRef.current` là null ⇒ KHÔNG gửi `after` ⇒ backend chỉ trả mốc, không
        // trả sự kiện cũ (nếu gửi `after` cũ thì mở tab là nút hiện ra vì sự kiện lần trước).
        const res = await shipperApi.getKioskEvents(lockerId, kioskSeqRef.current);
        if (cancelled) return;
        const payload = res?.data?.data;
        if (!payload) return;

        const events = payload.events || [];
        // Chỉ quan tâm sự kiện xác thực của ĐÚNG tủ này (lớp kiểm thứ hai sau backend).
        const verified = [...events].reverse().find((e) => e.type === 'SHIPPER_VERIFIED'
          && (!e.lockerId || e.lockerId === lockerId)
          && !processedKioskSeqRef.current.has(e.seq));
        const rejected = [...events].reverse().find((e) => e.type === 'SHIPPER_REJECTED'
          && (!e.lockerId || e.lockerId === lockerId)
          && !processedKioskSeqRef.current.has(e.seq));

        if (verified) {
          events.forEach((e) => processedKioskSeqRef.current.add(e.seq));
          setShipperVerified(true);
          setVerifyRejectedReason(null);
        } else if (rejected) {
          events.forEach((e) => processedKioskSeqRef.current.add(e.seq));
          // Giữ ẩn nút + nói rõ lý do (backend đã viết sẵn câu tiếng Việt trong `message`).
          setShipperVerified(false);
          setVerifyRejectedReason(rejected.message || 'Xác thực shipper không thành công.');
        }

        // GĐ44 — mốc `seq` dùng `useRef`, KHÔNG dùng state.
        //
        // Nếu để state và đưa vào dependency của effect, mỗi lần cập nhật mốc (1,5 giây/lần) effect
        // chạy lại → tạo THÊM một interval → request nhân lên theo cấp số (đo được **352 request
        // trong 5 giây** thay vì 3–4). Dùng ref thì effect chỉ chạy lại khi đổi đơn/tủ.
        if (payload.latestSeq != null) kioskSeqRef.current = payload.latestSeq;
      } catch {
        // Mất mạng/quyền: im lặng bỏ nhịp này — KHÔNG bật nút khi chưa chắc chắn.
      }
    };

    poll(); // đọc ngay, không trống 1,5 giây đầu
    const timer = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRecallOrder?.lockerId, activeRecallOrder?.orderId]);


  useEffect(() => {
    if (!activeRecallOrder) {
      setSensorWeightKg(null);
      setLoadcellWeight(0);
      return undefined;
    }
    setDoorSensorState('CLOSED');
    setRecallPhase('IDLE');
    setFailsafeMessage(null);
    // GĐ46 — lỗi mở cửa của đơn TRƯỚC không được hiện sang đơn mới.
    setDoorOpenError(null);

    const lockerId = activeRecallOrder.lockerId;
    const compIndex = activeRecallOrder.compartmentIndex;
    if (!lockerId || compIndex == null) {
      setSensorWeightKg(null);
      setLoadcellWeight(0);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await lockerApi.getCompartments(lockerId);
        if (cancelled) return;
        const comp = (res?.data?.data || []).find((c) => c.compIndex === compIndex);
        // DB gram → UI kg.
        const kg = comp?.currentWeight != null ? Number(comp.currentWeight) / 1000 : 0;
        setSensorWeightKg(kg);
        setLoadcellWeight(kg);
      } catch {
        if (cancelled) return;
        // Mất mạng: không bịa số, để 0 và UI hiện "—".
        setSensorWeightKg(null);
        setLoadcellWeight(0);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecallOrderId, activeRecallOrder?.lockerId, activeRecallOrder?.compartmentIndex]);

  // BƯỚC 2: CHẠM 1 NÚT MỞ SOLENOID
  //
  // GĐ46 — TRƯỚC ĐÂY HÀM NÀY KHÔNG GỬI LỆNH NÀO XUỐNG TỦ: chỉ `playSolenoidSound()` (Web Audio ở
  // client) rồi `setRecallPhase('DOOR_OPEN')`. Hệ quả đo được: bấm nút thì giao diện báo "cửa đang
  // mở", shipper mở cánh cửa thật nhưng tủ vẫn KHOÁ — và lệnh mở duy nhất của luồng thu hồi lại
  // nằm ở cuối `recallOverduePackage`, tức phải bấm "Đã Lấy Hàng & Đóng Cửa" mới có lệnh.
  //
  // Nay: gọi API THẬT `POST /api/shipper/recall-overdue/open` (SecurityConfig: chỉ SHIPPER), thành
  // công mới phát tiếng + sang `DOOR_OPEN`; lỗi thì Ở LẠI `IDLE` và hiện message của server —
  // đúng cách AdminTab báo "cửa VẪN ĐANG ĐÓNG" ở nút mở khẩn cấp.
  const [openingDoor, setOpeningDoor] = useState(false);

  const handleOneTouchUnlockSolenoid = async () => {
    if (!activeRecallOrder || openingDoor) return;
    setOpeningDoor(true);
    setFailsafeMessage(null);

    let message;
    try {
      await shipperApi.openForRecall(activeRecallOrder.orderId, dynamicToken);
    } catch (e) {
      message = e?.response?.data?.message
        || 'Không gửi được lệnh mở cửa tới tủ. Cửa VẪN ĐANG ĐÓNG — vui lòng thử lại.';
    } finally {
      setOpeningDoor(false);
    }

    if (message) {
      // Báo lỗi NGAY TRONG panel điều khiển: `FAILSAFE_ERROR` là banner cảnh báo đỏ đã có sẵn,
      // nhưng nó gắn với phase và sẽ mất khi shipper bấm lại. Dùng `doorOpenError` riêng để hiện
      // ở nhánh IDLE mà không phá luồng phase hiện tại.
      setDoorOpenError(message);
      return;   // KHÔNG phát tiếng solenoid, KHÔNG sang DOOR_OPEN
    }

    setDoorOpenError(null);
    playSolenoidSound();
    setDoorSensorState('OPEN');
    setRecallPhase('DOOR_OPEN');
    // Mốc khối lượng để so sánh ở bước fail-safe: lấy đúng số cân đã đọc được.
    setLoadcellWeight(sensorWeightKg != null ? sensorWeightKg : 0);
  };

  // BƯỚC 3 & 4: CẢM BIẾN KÉP TỰ ĐỘNG (ZERO-TOUCH)
  const handleSimulateRetrieveAndClose = () => {
    if (!activeRecallOrder) return;

    setDoorSensorState('CLOSED');
    setLoadcellWeight(0.00);
    setRecallPhase('PROCESSING');
    setFailsafeMessage(null);

    setTimeout(async () => {
      // GĐ13 — API là đường DUY NHẤT. Trước đây `catch` chỉ `console.warn` rồi vẫn chạy tiếp
      // `store.updateOrderStatus(...)` bên dưới, nên khi backend lỗi (403/409/mất mạng) giao diện
      // vẫn hiện "đã thu hồi thành công" và đổi trạng thái trong localStorage — tiến trình giả.
      // Nay lỗi thì DỪNG: hiện message thật, không ghi gì, không thêm thông báo thành công.
      try {
        // GĐ41 — GỬI KÈM `dynamicToken`: backend nay bắt buộc xác thực QR shipper (đồng bộ với
        // `depositPackage`). Chưa quét mã thì `dynamicToken` còn `null` → backend trả 400 với câu
        // "Vui lòng quét mã QR xác thực danh tính Shipper…", hiện nguyên văn cho shipper.
        await shipperApi.recallOverdue(activeRecallOrder.orderId, dynamicToken);
      } catch (e) {
        setFailsafeMessage(
          e?.response?.data?.message
            || 'Không thu hồi được qua máy chủ. Kiện hàng VẪN trong tủ — vui lòng thử lại.'
        );
        setRecallPhase('PENDING');
        return;
      }

      // Thông báo trong phiên trình duyệt — KHÔNG phải thông báo hệ thống (backend không có bảng
      // notifications). Giữ lại để shipper thấy phản hồi ngay; mất khi xoá cache.
      store.addNotification({
        phone: activeRecallOrder.customerPhone,
        orderId: activeRecallOrder.orderId,
        title: 'Bưu kiện đã được thu hồi về kho bãi',
        message: `Đơn hàng ${activeRecallOrder.orderId} tại ${activeRecallOrder.lockerName} đã được Shipper thu hồi về kho do vượt quá hạn lưu kho 24h00. Vui lòng liên hệ hotline/quản trị viên để nhận lại bưu phẩm.`,
        type: 'RECALL_CUSTOMER',
      });

      store.addNotification({
        targetRole: 'SHIPPER',
        role: 'SHIPPER',
        phone: '0900000002',
        orderId: activeRecallOrder.orderId,
        title: 'Đã giải phóng ngăn tủ thành công',
        message: `Đã thu hồi thành công bưu kiện ${activeRecallOrder.orderId} tại ${activeRecallOrder.lockerName} - Ngăn #${activeRecallOrder.compartmentIndex}. Ngăn tủ đã được giải phóng thành EMPTY sẵn sàng nhận đơn mới!`,
        type: 'RECALL_SUCCESS',
      });

      playSuccessChime();
      setSuccessRecallInfo({
        orderId: activeRecallOrder.orderId,
        compartmentIndex: activeRecallOrder.compartmentIndex,
        lockerName: activeRecallOrder.lockerName,
      });
      setRecallPhase('SUCCESS');
      loadOrders();

      setTimeout(() => {
        setRecallPhase('IDLE');
        setSuccessRecallInfo(null);
      }, 3500);
    }, 1200);
  };

  // Tình huống an toàn (Fail-safe): Quên lấy hàng mà đã đóng sập cửa
  const handleSimulateForgetPackageAndClose = () => {
    if (!activeRecallOrder) return;

    // Mô phỏng: hàng vẫn còn trong ngăn → khối lượng giữ nguyên số cân THẬT đã đọc được
    // (trước đây là `0.85` bịa). Nếu chưa đọc được cảm biến thì 0 — khi đó fail-safe sẽ
    // không kích hoạt, đúng hơn là kích hoạt dựa trên số bịa.
    const currentWeight = sensorWeightKg != null ? sensorWeightKg : 0;
    setDoorSensorState('CLOSED');
    setLoadcellWeight(currentWeight);
    setRecallPhase('PROCESSING');

    setTimeout(() => {
      playWarningChime();
      setDoorSensorState('OPEN');
      setRecallPhase('FAILSAFE_ERROR');
      setFailsafeMessage(
        `CHƯA LẤY BƯU KIỆN! Cảm biến Loadcell HX711 phát hiện vật nặng ${currentWeight} kg (> 0.05 kg) trong ngăn. Hệ thống đã tự động bung mở lại chốt Solenoid ngăn #${activeRecallOrder.compartmentIndex}. Vui lòng lấy kiện hàng ra!`
      );
    }, 1000);
  };

  return (
    <div className="space-y-5 notranslate select-none">
      {/* Toast thông báo nếu có bưu kiện quá hạn mới */}
      {alertNotice && (
        <div className="bg-rose-500/90 backdrop-blur-xl text-white p-4 rounded-2xl shadow-xl shadow-rose-500/20 border border-rose-400/50 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-3 text-xs font-bold">
            <BellRing className="w-5 h-5 animate-bounce shrink-0" />
            <span>{alertNotice}</span>
          </div>
          <button
            onClick={() => setAlertNotice(null)}
            className="p-1 hover:bg-rose-600/60 rounded-lg transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Banner: Overdue Radar Summary (Apple Liquid Glass) */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-rose-500/10 via-amber-500/10 to-blue-500/10 backdrop-blur-2xl p-6 sm:p-8 border border-white/80 shadow-[0_8px_32px_rgba(244,63,94,0.08)] flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-700 border border-rose-500/20 backdrop-blur-md">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
            <span>Đơn Quá Hạn Lưu Kho</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
            Thu Hồi Hàng Quá Hạn
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Thu hồi hàng quá hạn 24h để giải phóng ngăn tủ phục vụ đơn mới.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
          <div className="text-center sm:text-right bg-white/60 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-white/80 shadow-2xs">
            <span className="text-[11px] text-slate-500 block font-semibold">Bưu kiện cần thu hồi</span>
            <span className="text-2xl font-extrabold text-rose-600 font-mono">
              {overdueOrders.length} kiện
            </span>
          </div>
          <button
            onClick={handleGenerateToken}
            disabled={tokenLoading}
            className="ios-btn bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold px-5 py-3 rounded-2xl text-xs shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer transition whitespace-nowrap active:scale-95 border border-amber-400/30 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <QrCode className="w-4 h-4" />
            <span>{tokenLoading ? 'Đang lấy mã…' : 'Mã QR Shipper'}</span>
          </button>
        </div>
      </div>

      {/* GĐ41 — lỗi lấy mã phải HIỆN, không im lặng báo thành công giả. */}
      {tokenError && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <span>{tokenError}</span>
        </div>
      )}

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* PANE 1: OVERDUE LIST (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh Sách Quá Hạn ({filteredOverdue.length})
            </span>
            <select
              value={selectedLockerFilter}
              onChange={(e) => setSelectedLockerFilter(e.target.value)}
              className="text-xs bg-white/80 backdrop-blur-md border border-white/90 rounded-xl px-3 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500/30 shadow-xs cursor-pointer max-w-[150px] truncate"
            >
              <option value="ALL">📍 Tất cả trạm</option>
              {allLockers.map((lk) => (
                <option key={lk.lockerId} value={lk.lockerId}>
                  {lk.name.replace('Tủ Giao Nhận ', '')}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3 max-h-[750px] overflow-y-auto pr-1">
            {filteredOverdue.length === 0 ? (
              <div className="liquid-glass-card p-10 rounded-3xl border border-white/90 text-center shadow-sm">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                <h4 className="font-bold text-slate-800 text-sm">Không còn đơn quá hạn</h4>
                <p className="text-xs text-slate-500 mt-1">Toàn bộ ngăn tủ đang vận hành đúng tiến độ lưu kho.</p>
              </div>
            ) : (
              filteredOverdue.map((ord) => {
                const isSelected = activeRecallOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => setSelectedRecallOrderId(ord.orderId)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'liquid-glass-card border-rose-500/80 ring-2 ring-rose-500/30 shadow-lg -translate-y-0.5'
                        : 'liquid-glass-subtle border-white/80 hover:border-slate-300 hover:bg-white/80 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200/80 px-2.5 py-0.5 rounded-lg">
                        {ord.orderId}
                      </span>
                      <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full animate-pulse border border-rose-200">
                        Quá hạn 24h
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-xs truncate">
                      {ord.productName}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100/80">
                      <span className="flex items-center gap-1 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" /> {ord.lockerName}
                      </span>
                      <span className="font-bold text-rose-700 bg-rose-50/80 px-2 py-0.5 rounded-md text-[10px] border border-rose-200">
                        {/* GĐ19 — bỏ `({compartmentSize})`: mọi ngăn dùng được như nhau (GĐ18). */}
                        Ngăn #{ord.compartmentIndex}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANE 2: RECALL WORKSPACE & REAL-TIME SENSORS (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/*
            GĐ49c — THANH 4 BƯỚC THU HỒI, **CHỈ ĐỌC** state có sẵn (điều cấm #1):
              • bước 1 "Chọn đơn quá hạn": chưa có `activeRecallOrder`
              • bước 2 "Quét QR": đã chọn đơn nhưng `shipperVerified === false`
              • bước 3 "Mở cửa ngăn": đã xác thực, chưa mở (`recallPhase` còn `IDLE`)
              • bước 4 "Lấy hàng & đóng cửa": `DOOR_OPEN` / `PROCESSING` / `SUCCESS`
            KHÔNG đổi điều kiện hiện nút mở ngăn của GĐ44 (điều cấm #3) và KHÔNG đổi nhịp poll
            (điều cấm #4) — component này chỉ hiển thị.
          */}
          {(() => {
            const buocThuHoi = !activeRecallOrder
              ? 1
              : !shipperVerified
              ? 2
              : (recallPhase === 'DOOR_OPEN' || recallPhase === 'PROCESSING' || recallPhase === 'SUCCESS')
              ? 4
              : 3;
            const buoc = [
              { n: 1, nhan: 'Chọn đơn quá hạn' },
              { n: 2, nhan: 'Quét QR shipper' },
              { n: 3, nhan: 'Mở cửa ngăn' },
              { n: 4, nhan: 'Lấy hàng & đóng cửa' },
            ];
            return (
              <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="recall-steps" data-buoc={buocThuHoi}>
                {buoc.map((b) => {
                  const xong = b.n < buocThuHoi;
                  const dang = b.n === buocThuHoi;
                  return (
                    <li
                      key={b.n}
                      data-testid={`recall-step-${b.n}`}
                      data-done={xong ? '1' : '0'}
                      data-active={dang ? '1' : '0'}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${
                        dang
                          ? 'bg-rose-600 border-rose-600 text-white'
                          : xong
                          ? 'bg-white border-emerald-300 text-emerald-800'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                          dang
                            ? 'bg-white text-rose-700'
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
          })()}

          {activeRecallOrder ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-6 sm:p-8 shadow-xl space-y-6">
              {/* Active Recall Order Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200/60">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-0.5 rounded-lg">
                      {activeRecallOrder.orderId}
                    </span>
                    <span className="text-xs text-slate-500">
                      Khách hàng: <strong className="text-slate-800">{activeRecallOrder.customerName}</strong> ({activeRecallOrder.customerPhone})
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-1.5">
                    {activeRecallOrder.productName}
                  </h3>
                </div>

                <div className="text-right bg-white/60 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/80 shadow-2xs">
                  <span className="text-[10px] text-slate-500 block font-semibold">Vị trí ngăn tủ</span>
                  <span className="text-rose-600 font-extrabold text-sm">
                    {/* GĐ19 — bỏ cỡ ngăn, xem ghi chú phía trên. */}
                    Ngăn #{activeRecallOrder.compartmentIndex}
                  </span>
                </div>
              </div>

              {/* Success Notification Banner */}
              {recallPhase === 'SUCCESS' && successRecallInfo && (
                <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-500/20 border border-emerald-400/40 animate-in zoom-in-95 duration-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-7 h-7" />
                    <div>
                      <h4 className="font-extrabold text-sm">Thu Hồi & Giải Phóng Ngăn Tủ Thành Công!</h4>
                      <p className="text-xs opacity-95">
                        Kiện {successRecallInfo.orderId} tại Ngăn #{successRecallInfo.compartmentIndex} đã được giải phóng thành EMPTY.
                      </p>
                    </div>
                  </div>
                  {/* GĐ49c — BỎ "Zero-Touch" (thuật ngữ tiếng Anh không rõ nghĩa với người dùng). */}
                  <span className="text-xs bg-white/20 font-mono px-3 py-1 rounded-xl border border-white/30 font-bold">
                    Đã thu hồi ✓
                  </span>
                </div>
              )}

              {/* Failsafe Error Warning Banner */}
              {recallPhase === 'FAILSAFE_ERROR' && failsafeMessage && (
                <div className="p-4 rounded-2xl bg-rose-50/90 backdrop-blur-md border border-rose-400 text-rose-900 shadow-xl shadow-rose-500/10 animate-in shake duration-300 space-y-2">
                  <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>Cảnh Báo Fail-Safe Tự Động Kích Hoạt</span>
                  </div>
                  <p className="text-xs leading-relaxed font-semibold">
                    {failsafeMessage}
                  </p>
                </div>
              )}

              {/* 4-Step Interactive Action Console */}
              <div className="p-5 rounded-3xl liquid-glass-subtle border border-white/80 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 uppercase tracking-wider">
                    Bảng Điều Khiển Thu Hồi 1-Chạm
                  </span>
                  <span className="text-slate-500 font-mono text-[11px] bg-white/60 px-2 py-0.5 rounded-md border border-white/80">
                    Phase: {recallPhase}
                  </span>
                </div>

                {/* Phase Actions */}
                {recallPhase === 'IDLE' && (
                  shipperVerified ? (
                    // GĐ44 — CHỈ khi shipper đã quét QR thành công tại tủ mới hiện nút mở ngăn.
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full w-fit mx-auto">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Đã xác thực shipper
                      </div>
                      <button
                        onClick={handleOneTouchUnlockSolenoid}
                        disabled={openingDoor}
                        className="ios-btn w-full bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 disabled:from-slate-400 disabled:to-slate-500 disabled:cursor-not-allowed text-white font-bold py-3.5 px-4 rounded-2xl text-xs transition shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95 border border-rose-400/30"
                      >
                        <Unlock className="w-4 h-4" />
                        <span>
                          {openingDoor
                            ? 'Đang gửi lệnh mở cửa…'
                            : `Mở Cửa Ngăn #${activeRecallOrder.compartmentIndex}`}
                        </span>
                      </button>
                      {doorOpenError && (
                        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-[11px] font-semibold text-rose-800">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{doorOpenError}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    // GĐ44 — CHƯA xác thực: KHÔNG render nút mở ngăn, chỉ hướng dẫn.
                    <div className="p-4 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-300 text-center space-y-2">
                      <Lock className="w-6 h-6 text-slate-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">
                        Quét mã QR Shipper tại tủ để mở khoá thao tác thu hồi
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Đang chờ xác thực tại tủ…
                      </p>
                      {verifyRejectedReason && (
                        <p className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-2.5 py-1.5">
                          {verifyRejectedReason}
                        </p>
                      )}
                    </div>
                  )
                )}

                {(recallPhase === 'DOOR_OPEN' || recallPhase === 'FAILSAFE_ERROR') && (
                  <div className="space-y-3">
                    <div className="p-3.5 bg-amber-50/90 backdrop-blur-md rounded-2xl border border-amber-200 text-xs text-amber-900 font-medium flex items-center gap-2.5">
                      <DoorOpen className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Lấy kiện hàng ra và đẩy sập cánh cửa.</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={handleSimulateRetrieveAndClose}
                        className="ios-btn bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold py-3.5 px-4 rounded-2xl text-xs transition shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 cursor-pointer border border-emerald-400/30"
                      >
                        <Check className="w-4 h-4" />
                        <span>Đã Lấy Hàng & Đóng Cửa</span>
                      </button>

                      <button
                        onClick={handleSimulateForgetPackageAndClose}
                        className="ios-btn bg-white/80 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-white/90 hover:border-rose-300 font-semibold py-3.5 px-4 rounded-2xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                        title="Thử nghiệm kịch bản an toàn khi shipper quên lấy kiện hàng"
                      >
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                        <span>Thử Quên Lấy Hàng (Fail-safe)</span>
                      </button>
                    </div>
                  </div>
                )}

                {recallPhase === 'PROCESSING' && (
                  <div className="py-6 text-center space-y-2">
                    <RefreshCw className="w-7 h-7 text-blue-600 animate-spin mx-auto" />
                    <p className="text-xs font-bold text-slate-800">Đang kiểm tra cảm biến...</p>
                  </div>
                )}
              </div>

              {/* Real-time Physical Locker Visual Cabinet */}
              <div className="pt-2">
                <LockerCabinetVisualizer
                  lockerName={activeRecallOrder.lockerName}
                  lockerId={activeRecallOrder.lockerId}
                  activeSlotId={activeRecallOrder.compartmentIndex}
                  doorState={doorSensorState}
                  sensorWeight={loadcellWeight}
                  compact={true}
                />
              </div>
            </div>
          ) : (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-12 text-center shadow-lg">
              <PackageX className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn đơn hàng quá hạn</h4>
              <p className="text-xs text-slate-500 mt-1">Chọn đơn quá hạn bên danh sách để kích hoạt quy trình thu hồi.</p>
            </div>
          )}
        </div>
      </div>

      {/* Shipper Token Modal (Apple Liquid Glass) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-7 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-2 rounded-xl hover:bg-slate-100/60 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-amber-300/40 shadow-xs">
              <Truck className="w-7 h-7" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Định Danh Shipper</h3>
            <p className="text-xs text-slate-500 mt-1">
              Tài khoản: <strong className="text-slate-900">{currentUser?.fullName}</strong>
            </p>

            <div className="bg-white p-4 rounded-3xl border border-white/90 inline-block my-4 shadow-xl">
              <QRCodeSVG value={dynamicToken} size={180} />
            </div>

            {/* GĐ41 — BỎ vòng đếm ngược 60 giây. Mã QR shipper là mã CỐ ĐỊNH (GĐ33) nên đếm ngược
                vừa sai sự thật vừa khiến shipper tưởng phải tạo lại mã. Thay bằng khối nói rõ. */}
            <div className="my-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
              Mã QR cố định — dùng được nhiều lần, không cần tạo lại
            </div>

            <p className="text-[11px] text-slate-500 mb-5 px-2">
              Đưa mã QR này trước camera GM65 của tủ để mở khóa quyền thu hồi.
            </p>

            <button
              onClick={() => setShowQrModal(false)}
              className="ios-btn w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer shadow-lg shadow-slate-900/20"
            >
              Đóng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
