import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { store } from '../services/store';
import { shipperApi } from '../services/api';
import {
  AlertTriangle, CheckCircle2, DoorOpen, Weight,
  Check, MapPin, User, Timer, PackageX, Truck, RefreshCw,
  BellRing, X, QrCode, ShieldCheck, Unlock, Lock,
  Sparkles, CheckCheck, Radio, Volume2, ArrowRight
} from 'lucide-react';

export default function ShipperRecallTab({ currentUser, onNavigateToDeposit }) {
  const [orders, setOrders] = useState([]);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');
  const [selectedRecallOrderId, setSelectedRecallOrderId] = useState(null);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [alertNotice, setAlertNotice] = useState(null);

  // ===== BƯỚC 1: XÁC THỰC DANH TÍNH SHIPPER TẠI KIOSK (GIỐNG Y HỆT LUỒNG NẠP HÀNG) =====
  const [dynamicToken, setDynamicToken] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  // ===== BƯỚC 2 -> 4: QUY TRÌNH THU HỒI 1 CHẠM & CẢM BIẾN TỰ ĐỘNG =====
  // recallPhase: 'IDLE' | 'DOOR_OPEN' | 'PROCESSING' | 'SUCCESS' | 'FAILSAFE_ERROR'
  const [recallPhase, setRecallPhase] = useState('IDLE');
  const [doorSensorState, setDoorSensorState] = useState('CLOSED'); // 'CLOSED' | 'OPEN'
  const [loadcellWeight, setLoadcellWeight] = useState(0.85); // KG
  const [failsafeMessage, setFailsafeMessage] = useState(null);
  const [successRecallInfo, setSuccessRecallInfo] = useState(null);

  // ===== HIỆU ỨNG ÂM THANH WEB AUDIO API =====
  // 1. Tiếng "tách" chốt điện Solenoid 12V
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

  // 2. Tiếng Ting-Ting hoàn tất (C6 -> E6)
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

  // 3. Tiếng cảnh báo Fail-safe (Trầm - cảnh báo)
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

  // ===== LOAD DỮ LIỆU TỪ STORE =====
  const loadOrders = () => {
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
  };

  useEffect(() => {
    // Quét tự động ngay khi mở tab
    const initialScan = store.checkAndScanOverdueOrders();
    setLastScanTime(new Date().toLocaleTimeString('vi-VN'));
    loadOrders();

    if (initialScan.sweptCount > 0) {
      setAlertNotice(`Phát hiện ${initialScan.sweptCount} bưu kiện quá hạn cần thu hồi để giải phóng ô tủ.`);
    }

    const handleUpdate = () => loadOrders();
    const handleOverdueDetected = (e) => {
      loadOrders();
      if (e.detail?.count > 0) {
        setAlertNotice(`Phát hiện ${e.detail.count} bưu kiện vừa quá hạn lưu kho tại trạm tủ!`);
      }
    };

    // Tác vụ Daemon định kỳ 30 giây
    const scanTimer = setInterval(() => {
      const scanResult = store.checkAndScanOverdueOrders();
      setLastScanTime(new Date().toLocaleTimeString('vi-VN'));
      if (scanResult.sweptCount > 0) {
        loadOrders();
      }
    }, 30000);

    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    return () => {
      clearInterval(scanTimer);
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_overdue_detected', handleOverdueDetected);
    };
  }, []);

  // Countdown timer cho mã QR động 60s (Giống y hệt luồng nạp hàng ShipperTab)
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const handleGenerateToken = () => {
    const token = 'SHIPPER-TOKEN-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now();
    setDynamicToken(token);
    setTimeLeft(60);
    setShowQrModal(true);
  };

  // Bộ lọc danh sách quá hạn
  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');
  const filteredOverdue = overdueOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  const activeRecallOrder =
    orders.find((o) => o.orderId === selectedRecallOrderId) || filteredOverdue[0] || null;

  // Cập nhật trọng lượng giả định khi đổi đơn hàng được chọn
  useEffect(() => {
    if (activeRecallOrder) {
      const weight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
      setLoadcellWeight(weight);
      setDoorSensorState('CLOSED');
      setRecallPhase('IDLE');
      setFailsafeMessage(null);
    }
  }, [selectedRecallOrderId]);

  // ===== XỬ LÝ BƯỚC 2: CHẠM 1 NÚT MỞ SOLENOID =====
  const handleOneTouchUnlockSolenoid = () => {
    if (!activeRecallOrder) return;
    playSolenoidSound();
    setDoorSensorState('OPEN');
    setRecallPhase('DOOR_OPEN');
    setFailsafeMessage(null);
    // Trọng lượng trong tủ ban đầu khi có hàng
    const initialWeight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
    setLoadcellWeight(initialWeight);
  };

  // ===== XỬ LÝ BƯỚC 3 & 4: CẢM BIẾN KÉP TỰ ĐỘNG (ZERO-TOUCH) =====
  // 1. Thao tác chuẩn: Shipper đã lấy hàng và đẩy sập cánh cửa
  const handleSimulateRetrieveAndClose = () => {
    if (!activeRecallOrder) return;

    // Cửa đóng sập + Khay cân không tải (0.00 KG)
    setDoorSensorState('CLOSED');
    setLoadcellWeight(0.00);
    setRecallPhase('PROCESSING');
    setFailsafeMessage(null);

    // Cảm biến kép tự động thẩm định và giải phóng ô tủ sau 1.2s (Zero-Touch)
    setTimeout(async () => {
      try {
        await shipperApi.recallOverdue(activeRecallOrder.orderId);
      } catch (e) {
        console.warn('Backend API offline, cập nhật qua store local:', e.message);
      }

      const now = new Date();
      store.updateOrderStatus(activeRecallOrder.orderId, 'COMPLETED', {
        returnedAt: now.toISOString(),
        note: 'Đã thu hồi về kho qua cảm biến kép tự động (Zero-Touch)',
      });

      // 1. Thông báo cho khách hàng
      store.addNotification({
        phone: activeRecallOrder.customerPhone,
        orderId: activeRecallOrder.orderId,
        title: 'Bưu kiện đã được thu hồi về kho bãi',
        message: `Đơn hàng ${activeRecallOrder.orderId} tại ${activeRecallOrder.lockerName} đã được Shipper thu hồi về kho do vượt quá hạn lưu kho 24h00. Vui lòng liên hệ hotline/quản trị viên để nhận lại bưu phẩm.`,
        type: 'RECALL_CUSTOMER',
      });

      // 2. Thông báo cho Shipper
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

      // Sau 3.5 giây tự động trở về IDLE để tiếp tục đơn khác
      setTimeout(() => {
        setRecallPhase('IDLE');
        setSuccessRecallInfo(null);
      }, 3500);
    }, 1200);
  };

  // 2. Tình huống an toàn (Fail-safe): Quên lấy hàng mà đã đóng sập cửa
  const handleSimulateForgetPackageAndClose = () => {
    if (!activeRecallOrder) return;

    // Cửa đóng nhưng cân nặng vẫn còn > 0.05 KG
    const currentWeight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
    setDoorSensorState('CLOSED');
    setLoadcellWeight(currentWeight);
    setRecallPhase('PROCESSING');

    setTimeout(() => {
      // Phát hiện bất thường: Cửa đóng nhưng còn hàng!
      playWarningChime();
      // Tự động bung mở lại Solenoid
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
        <div className="bg-rose-600 text-white p-3.5 px-4 rounded-xl shadow-lg flex items-center justify-between gap-3 animate-in slide-in-from-top duration-300">
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <BellRing className="w-4 h-4 animate-bounce shrink-0" />
            <span>{alertNotice}</span>
          </div>
          <button
            onClick={() => setAlertNotice(null)}
            className="p-1 hover:bg-rose-700 rounded-md transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 4 KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-rose-300 bg-rose-50/70 shadow-xs">
          <span className="text-[11px] font-semibold text-rose-700 uppercase">Quá hạn cần thu hồi</span>
          <div className="text-2xl font-bold text-rose-600 mt-1 font-mono flex items-center justify-between">
            <span>{overdueOrders.length}</span>
            {overdueOrders.length > 0 && (
              <span className="text-[10px] font-sans font-bold bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full uppercase animate-pulse">
                Khẩn cấp
              </span>
            )}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Khu vực lọc trạm tủ</span>
          <div className="text-base font-bold text-slate-800 mt-1 truncate">
            {selectedLockerFilter === 'ALL'
              ? 'Tất cả trạm tủ'
              : selectedLockerFilter === 'LOCKER_HN_01'
              ? 'Trạm KTX A1'
              : 'Trạm Thư viện'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Daemon quét tự động</span>
          <div className="text-xs font-mono font-bold text-slate-700 mt-2 flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
            <span>30s/lần ({lastScanTime || 'Vừa xong'})</span>
          </div>
        </div>

        <div
          onClick={onNavigateToDeposit}
          className="bg-white hover:bg-amber-50/40 p-4 rounded-xl border border-amber-200 shadow-xs cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-700 uppercase">Cổng nạp hàng</span>
            <Truck className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xs font-semibold text-slate-700 mt-1 flex items-center gap-1">
            <span>Chuyển sang nạp tủ ➔</span>
          </div>
        </div>
      </div>

      {/* ACTION STRIP: XÁC THỰC DANH TÍNH TẠI MÀN HÌNH KIOSK (GIỐNG Y HỆT LUỒNG NẠP HÀNG SHIPPER TAB) */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-amber-800 text-xs font-bold uppercase">
            <ShieldCheck className="w-4 h-4" /> Xác thực danh tính tại màn hình Kiosk
          </div>
          <p className="text-xs text-slate-600">
            Tạo mã QR động 60 giây và hướng vào Module camera GM65 của trạm tủ để bắt đầu quyền thu hồi hàng.
          </p>
        </div>

        <button
          onClick={handleGenerateToken}
          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs shadow-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <QrCode className="w-4 h-4" />
          <span>Tạo mã QR xác minh 60s</span>
        </button>
      </div>

      {/* SPLIT-PANE WORKSPACE: Trái = Danh sách quá hạn, Phải = Trạm thu hồi 1 chạm */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* CỘT TRÁI: DANH SÁCH BƯU KIỆN QUÁ HẠN (5 Cột) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Hàng quá hạn ({filteredOverdue.length})
            </span>

            {/* Bộ lọc trạm */}
            <div className="flex gap-1">
              {[
                { id: 'ALL', label: 'Tất cả' },
                { id: 'LOCKER_HN_01', label: 'KTX A1' },
                { id: 'LOCKER_HN_02', label: 'Thư viện' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedLockerFilter(f.id)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    selectedLockerFilter === f.id
                      ? 'bg-rose-900 text-white font-bold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
            {filteredOverdue.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-800">Không có bưu kiện nào bị quá hạn lưu kho!</p>
                <p className="text-[11px] text-slate-500 mt-1">Toàn bộ ngăn tủ đang phục vụ an toàn và hiệu quả.</p>
              </div>
            ) : (
              filteredOverdue.map((ord) => {
                const isSelected = activeRecallOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => {
                      setSelectedRecallOrderId(ord.orderId);
                      setRecallPhase('IDLE');
                      setDoorSensorState('CLOSED');
                      setFailsafeMessage(null);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer bg-white ${
                      isSelected
                        ? 'border-rose-500 ring-2 ring-rose-500/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                        {ord.orderId}
                      </span>
                      <span className="bg-rose-100 text-rose-700 text-[10px] font-extrabold px-2 py-0.5 rounded uppercase">
                        Quá hạn 24h
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">
                        {ord.lockerName} — Ngăn #{ord.compartmentIndex}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-slate-500">
                        Size {ord.compartmentSize}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{ord.customerName}</span>
                        <span className="font-mono text-slate-400">({ord.customerPhone})</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-600 font-mono text-[11px]">
                        <Weight className="w-3 h-3 text-slate-400" />
                        <span>{ord.weight ? `${ord.weight} kg` : '0.85 kg'}</span>
                      </div>
                    </div>

                    {ord.expiryDeadline && (
                      <div className="mt-1.5 text-[10px] text-rose-600 font-medium flex items-center gap-1">
                        <Timer className="w-3 h-3 shrink-0" />
                        <span>Hạn lấy: {new Date(ord.expiryDeadline).toLocaleTimeString('vi-VN')} {new Date(ord.expiryDeadline).toLocaleDateString('vi-VN')}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CỘT PHẢI: BÀN LÀM VIỆC THU HỒI 1 CHẠM (7 Cột) */}
        <div className="lg:col-span-7 space-y-4">
          {activeRecallOrder ? (
            <div className="bg-white rounded-2xl border border-rose-200 shadow-xs overflow-hidden">
              {/* Header Thẻ Kiện Hàng Cần Thu Hồi */}
              <div className="bg-rose-50/80 border-b border-rose-200/80 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-rose-800 bg-white border border-rose-200 px-2.5 py-0.5 rounded-lg shadow-2xs">
                      {activeRecallOrder.orderId}
                    </span>
                    <span className="text-[11px] bg-rose-600 text-white font-bold px-2 py-0.5 rounded-md uppercase">
                      Thu hồi 1 chạm (Zero-Touch)
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900 text-base mt-2 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-rose-600" />
                    {activeRecallOrder.lockerName} — Ngăn #{activeRecallOrder.compartmentIndex}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Khách hàng: <span className="font-semibold text-slate-800">{activeRecallOrder.customerName}</span> ({activeRecallOrder.customerPhone})
                  </p>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-rose-200/60">
                  <span className="text-[11px] text-slate-500">Ngăn tủ & Kích thước</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-bold font-mono text-rose-800 bg-white px-2.5 py-1 rounded-lg border border-rose-200 text-xs">
                      Size {activeRecallOrder.compartmentSize}
                    </span>
                    <span className="font-bold font-mono text-slate-700 bg-white px-2 py-1 rounded-lg border border-slate-200 text-xs">
                      {activeRecallOrder.weight || '0.85'} kg
                    </span>
                  </div>
                </div>
              </div>

              {/* KHU VỰC THAO TÁC THEO CÁC BƯỚC */}
              <div className="p-5 sm:p-6 space-y-5">
                {/* 1. KHI Ở TRẠNG THÁI IDLE: CHẠM 1 NÚT MỞ SOLENOID */}
                {recallPhase === 'IDLE' && (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-rose-100 text-rose-700 shrink-0">
                        <DoorOpen className="w-5 h-5" />
                      </div>
                      <div className="text-xs space-y-1">
                        <div className="font-bold text-slate-900">
                          Bước 2: Kích hoạt mở ngăn #{activeRecallOrder.compartmentIndex}
                        </div>
                        <p className="text-slate-600 leading-relaxed">
                          Mã OTP của khách hàng đã tự động hết hiệu lực sau 24h. Shipper được quyền mở chốt điện 12V Solenoid chỉ với 1 chạm duy nhất.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleOneTouchUnlockSolenoid}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-3.5 px-5 rounded-xl text-sm transition shadow-sm cursor-pointer flex items-center justify-center gap-2 group"
                    >
                      <Unlock className="w-5 h-5 group-hover:scale-110 transition-transform" />
                      <span>Mở ngăn thu hồi [Ngăn #{activeRecallOrder.compartmentIndex}]</span>
                    </button>
                  </div>
                )}

                {/* 2. KHI CỬA ĐÃ MỞ (DOOR_OPEN): HƯỚNG DẪN LẤY HÀNG & CẢM BIẾN TỰ ĐỘNG */}
                {(recallPhase === 'DOOR_OPEN' || recallPhase === 'FAILSAFE_ERROR') && (
                  <div className="space-y-5">
                    {/* Hướng dẫn không cần bấm nút */}
                    <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-2xl p-4.5">
                      <div className="flex items-start gap-3">
                        <div className="p-2.5 bg-emerald-600 text-white rounded-xl shrink-0 shadow-xs">
                          <DoorOpen className="w-6 h-6 animate-pulse" />
                        </div>
                        <div className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-emerald-900 text-sm">
                              CỬA NGĂN #{activeRecallOrder.compartmentIndex} ĐÃ BẬT MỞ
                            </span>
                            <span className="bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                              Không cần bấm nút
                            </span>
                          </div>
                          <p className="text-slate-700 mt-1 leading-relaxed font-medium">
                            👉 Shipper lấy bưu kiện ra ngoài và <strong>đẩy sập cánh cửa tủ lại (tiếng "tách")</strong>. Bạn <strong>không cần bấm bất kỳ nút nào trên màn hình</strong>, hệ thống cảm biến kép sẽ tự động hoàn tất 100%!
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Cảnh báo Fail-Safe nếu phát hiện lỗi */}
                    {failsafeMessage && (
                      <div className="bg-rose-50 border-2 border-rose-500 rounded-xl p-4 text-xs text-rose-800 animate-in fade-in duration-200">
                        <div className="flex items-start gap-2.5 font-bold text-rose-900">
                          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                          <span>CẢNH BÁO AN TOÀN TỰ ĐỘNG (FAIL-SAFE)</span>
                        </div>
                        <p className="mt-1.5 leading-relaxed text-[11px] text-rose-700">
                          {failsafeMessage}
                        </p>
                      </div>
                    )}

                    {/* Bảng tín hiệu cảm biến thời gian thực */}
                    <div className="bg-slate-900 text-white rounded-xl p-4 space-y-3 font-mono text-xs">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="text-slate-400 flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-ping" />
                          Tín hiệu cảm biến thời gian thực:
                        </span>
                        <span className="text-[11px] text-emerald-400 font-sans font-bold">Online</span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                          <span className="text-[10px] text-slate-400 block">1. Cảm biến từ MC-38</span>
                          <span className={`text-xs font-bold mt-1 inline-block ${
                            doorSensorState === 'OPEN' ? 'text-amber-400' : 'text-emerald-400'
                          }`}>
                            {doorSensorState === 'OPEN' ? 'ĐANG MỞ (OPEN)' : 'ĐÃ ĐÓNG KÍN (CLOSED)'}
                          </span>
                        </div>

                        <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700">
                          <span className="text-[10px] text-slate-400 block">2. Cảm biến lực HX711</span>
                          <span className={`text-xs font-bold mt-1 inline-block ${
                            loadcellWeight > 0.05 ? 'text-amber-400' : 'text-emerald-400'
                          }`}>
                            {loadcellWeight.toFixed(2)} KG {loadcellWeight > 0.05 ? '(CÓ HÀNG)' : '(RỖNG 0.00)'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bộ điều khiển mô phỏng thao tác thực địa (Hardware Simulation Strip) */}
                    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                          Giả lập thao tác thực địa của Shipper tại Kiosk:
                        </span>
                        <span className="text-[10px] text-slate-500 italic">Thao tác mô phỏng</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {/* Nút giả lập Thao tác chuẩn: Lấy hàng & Đóng sập cửa */}
                        <button
                          onClick={handleSimulateRetrieveAndClose}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold p-3 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Đã lấy hàng & Đóng sập cửa (0.00 KG)</span>
                        </button>

                        {/* Nút giả lập Fail-safe: Quên lấy hàng mà đóng sập cửa */}
                        <button
                          onClick={handleSimulateForgetPackageAndClose}
                          className="bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold p-3 rounded-xl text-xs transition shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <AlertTriangle className="w-4 h-4 text-rose-600" />
                          <span>Thử đóng cửa khi quên lấy ({activeRecallOrder.weight || '0.85'}kg)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. KHI ĐANG XỬ LÝ TỰ ĐỘNG (PROCESSING) */}
                {recallPhase === 'PROCESSING' && (
                  <div className="p-8 text-center space-y-3 bg-slate-50 rounded-xl border border-slate-200">
                    <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
                    <h4 className="text-sm font-bold text-slate-900">
                      Cảm biến kép đang tự động thẩm định...
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                      MC-38 đã đóng kín. Loadcell HX711 đang kiểm tra trạng thái không tải (0.00 KG) và chuẩn bị giải phóng ô tủ.
                    </p>
                  </div>
                )}

                {/* 4. KHI THU HỒI HOÀN TẤT THÀNH CÔNG (SUCCESS) */}
                {recallPhase === 'SUCCESS' && successRecallInfo && (
                  <div className="p-6 bg-emerald-50 border-2 border-emerald-400 rounded-2xl text-center space-y-3 animate-in zoom-in-95 duration-200">
                    <div className="w-12 h-12 bg-emerald-600 text-white rounded-full flex items-center justify-center mx-auto shadow-sm">
                      <Check className="w-6 h-6 stroke-[3]" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-emerald-950">
                        Thu Hồi & Giải Phóng Ngăn Tủ Thành Công!
                      </h4>
                      <p className="text-xs text-emerald-800 mt-1">
                        Kiện hàng <span className="font-mono font-bold">{successRecallInfo.orderId}</span> đã được thu hồi. Ngăn #{successRecallInfo.compartmentIndex} ({successRecallInfo.lockerName}) đã chuyển thành <span className="font-bold underline">EMPTY</span> sẵn sàng nhận đơn mới.
                      </p>
                    </div>
                    <div className="pt-2 text-[11px] text-emerald-700 font-medium">
                      Hệ thống tự động đồng bộ sang tài khoản Khách hàng và Quản trị viên...
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* KHI CHƯA CHỌN ĐƠN HÀNG NÀO */
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <PackageX className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn kiện hàng cần thu hồi</h4>
              <p className="text-xs text-slate-500 mt-1">Chọn một kiện hàng quá hạn từ danh sách bên trái để tiến hành thu hồi.</p>
            </div>
          )}
        </div>
      </div>

      {/* SHIPPER QR MODAL (GIỐNG Y HỆT LUỒNG NẠP HÀNG SHIPPER TAB) */}
      {showQrModal && dynamicToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl relative border border-slate-200">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center mx-auto mb-2 border border-amber-200">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Định Danh Shipper</h3>
            <p className="text-xs text-slate-500">Đưa mã trước camera GM65 của tủ để xác nhận danh tính</p>

            <div className="bg-white p-3 rounded-xl border border-slate-200 inline-block my-3 shadow-xs relative">
              <QRCodeSVG value={dynamicToken} size={180} />
              {timeLeft <= 0 && (
                <div className="absolute inset-0 bg-white/90 backdrop-blur-xs flex items-center justify-center rounded-xl">
                  <span className="text-xs font-bold text-rose-600">MÃ ĐÃ HẾT HẠN</span>
                </div>
              )}
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between text-xs font-semibold mb-1">
                <span className="flex items-center gap-1 text-slate-600">
                  <Timer className={`w-3.5 h-3.5 ${timeLeft <= 10 ? 'text-rose-600' : 'text-amber-600'}`} />
                  Hiệu lực còn lại:
                </span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${
                  timeLeft <= 10 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {timeLeft}s
                </span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    timeLeft <= 10 ? 'bg-rose-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${(timeLeft / 60) * 100}%` }}
                />
              </div>
            </div>

            {timeLeft <= 0 ? (
              <button
                onClick={handleGenerateToken}
                className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Tạo mã QR mới
              </button>
            ) : (
              <button
                onClick={() => setShowQrModal(false)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Đã quét xong & Đóng
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
