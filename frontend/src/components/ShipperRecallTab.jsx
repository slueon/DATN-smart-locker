import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CircularTimer from './CircularTimer';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { shipperApi } from '../services/api';
import {
  AlertTriangle, CheckCircle2, DoorOpen, Weight,
  Check, MapPin, User, Timer, PackageX, Truck, RefreshCw,
  BellRing, X, QrCode, ShieldCheck, Unlock, Lock,
  Sparkles, CheckCheck, Radio, Volume2, ArrowRight,
  Shield, AlertCircle, ChevronRight
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
  const [timeLeft, setTimeLeft] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  // ===== BƯỚC 2 -> 4: QUY TRÌNH THU HỒI 1 CHẠM & CẢM BIẾN TỰ ĐỘNG =====
  const [recallPhase, setRecallPhase] = useState('IDLE'); // 'IDLE' | 'DOOR_OPEN' | 'PROCESSING' | 'SUCCESS' | 'FAILSAFE_ERROR'
  const [doorSensorState, setDoorSensorState] = useState('CLOSED'); // 'CLOSED' | 'OPEN'
  const [loadcellWeight, setLoadcellWeight] = useState(0.85); // KG
  const [failsafeMessage, setFailsafeMessage] = useState(null);
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
    const initialScan = store.checkAndScanOverdueOrders();
    setLastScanTime(new Date().toLocaleTimeString('vi-VN'));
    loadOrders();
    setAllLockers(store.getLockers());

    if (initialScan.sweptCount > 0) {
      setAlertNotice(`Phát hiện ${initialScan.sweptCount} bưu kiện quá hạn cần thu hồi để giải phóng ô tủ.`);
    }

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

  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');
  const filteredOverdue = overdueOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  const activeRecallOrder =
    orders.find((o) => o.orderId === selectedRecallOrderId) || filteredOverdue[0] || null;

  useEffect(() => {
    if (activeRecallOrder) {
      const weight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
      setLoadcellWeight(weight);
      setDoorSensorState('CLOSED');
      setRecallPhase('IDLE');
      setFailsafeMessage(null);
    }
  }, [selectedRecallOrderId]);

  // BƯỚC 2: CHẠM 1 NÚT MỞ SOLENOID
  const handleOneTouchUnlockSolenoid = () => {
    if (!activeRecallOrder) return;
    playSolenoidSound();
    setDoorSensorState('OPEN');
    setRecallPhase('DOOR_OPEN');
    setFailsafeMessage(null);
    const initialWeight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
    setLoadcellWeight(initialWeight);
  };

  // BƯỚC 3 & 4: CẢM BIẾN KÉP TỰ ĐỘNG (ZERO-TOUCH)
  const handleSimulateRetrieveAndClose = () => {
    if (!activeRecallOrder) return;

    setDoorSensorState('CLOSED');
    setLoadcellWeight(0.00);
    setRecallPhase('PROCESSING');
    setFailsafeMessage(null);

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

    const currentWeight = activeRecallOrder.weight ? parseFloat(activeRecallOrder.weight) : 0.85;
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
            className="ios-btn bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold px-5 py-3 rounded-2xl text-xs shadow-lg shadow-amber-500/25 flex items-center gap-2 cursor-pointer transition whitespace-nowrap active:scale-95 border border-amber-400/30"
          >
            <QrCode className="w-4 h-4" />
            <span>Mã QR Shipper</span>
          </button>
        </div>
      </div>

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
                        Ngăn #{ord.compartmentIndex} ({ord.compartmentSize})
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
                    Ngăn #{activeRecallOrder.compartmentIndex} ({activeRecallOrder.compartmentSize})
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
                  <span className="text-xs bg-white/20 backdrop-blur-md font-mono px-3 py-1 rounded-xl border border-white/30 font-bold">
                    Zero-Touch ✓
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
                  <button
                    onClick={handleOneTouchUnlockSolenoid}
                    className="ios-btn w-full bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-bold py-3.5 px-4 rounded-2xl text-xs transition shadow-lg shadow-rose-500/25 flex items-center justify-center gap-2 cursor-pointer active:scale-95 border border-rose-400/30"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>Mở Cửa Ngăn #{activeRecallOrder.compartmentIndex}</span>
                  </button>
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

            <div className="flex flex-col items-center justify-center my-2">
              <CircularTimer
                secondsLeft={timeLeft}
                totalSeconds={60}
                size={70}
                strokeWidth={5}
                label="Hiệu Lực"
              />
            </div>

            <p className="text-[11px] text-slate-500 mb-5 px-2">
              Quét mã tại trạm tủ để mở quyền thu hồi.
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
