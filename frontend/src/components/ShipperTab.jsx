import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CircularTimer from './CircularTimer';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { shipperApi } from '../services/api';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, Box, AlertCircle, X,
  DoorOpen, Weight, Layers, ArrowRight, User, PackageX,
  Barcode, ScanLine, Scan, Camera, Sparkles, ChevronRight,
  Shield, Volume2, Cpu, Clock, PlusCircle
} from 'lucide-react';

export default function ShipperTab({ currentUser, onNavigateToRecall }) {
  const [orders, setOrders] = useState([]);
  const [allLockers, setAllLockers] = useState([]);
  const [sampleToast, setSampleToast] = useState(null);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Token QR 60s
  const [dynamicToken, setDynamicToken] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  // Deposit Stepper State (1: Scan Barcode, 2: Solenoid Open, 3: Put & Close, 4: Dual Sensor)
  const [depositStep, setDepositStep] = useState(1);
  const [isDepositing, setIsDepositing] = useState(false);

  // GM65 Scanner State
  const [scannedBarcode, setScannedBarcode] = useState(null);
  const [isScanSuccess, setIsScanSuccess] = useState(false);
  const [manualBarcodeInput, setManualBarcodeInput] = useState('');
  const [scanError, setScanError] = useState(null);
  const [isScanningActive, setIsScanningActive] = useState(false);

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
    store.checkAndScanOverdueOrders();
    loadOrders();
    setAllLockers(store.getLockers());

    const handleUpdate = () => {
      loadOrders();
      setAllLockers(store.getLockers());
    };
    const handleOverdueDetected = () => loadOrders();

    // Tác vụ Daemon ngầm định kỳ 30 giây tự động đồng bộ dữ liệu
    const scanTimer = setInterval(() => {
      const scanResult = store.checkAndScanOverdueOrders();
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

  const loadOrders = () => {
    const all = store.getOrders();
    setOrders(all);

    const pending = all.filter((o) => o.status === 'PENDING');
    if (pending.length > 0 && !selectedOrderId) {
      setSelectedOrderId(pending[0].orderId);
    }
  };

  const handleCreateSampleOrder = () => {
    const newOrd = store.generateSamplePendingOrder(selectedLockerFilter !== 'ALL' ? selectedLockerFilter : null);
    loadOrders();
    setSelectedOrderId(newOrd.orderId);
    setSampleToast(`Đã thêm đơn hàng ${newOrd.orderId} (${newOrd.productName}) chờ nạp!`);
    setTimeout(() => setSampleToast(null), 3500);
  };

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
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      store.updateOrderStatus(order.orderId, 'DEPOSITED', {
        depositedAt: now.toISOString(),
        expiryDeadline: tomorrow.toISOString(),
      });

      store.addNotification({
        phone: order.customerPhone,
        orderId: order.orderId,
        title: 'Bưu kiện đã về Tủ!',
        message: `Đơn hàng ${order.orderId} đã được Shipper gửi vào ${order.lockerName} - Ngăn #${order.compartmentIndex}. Hạn chót lấy hàng: 24h00 ngày mai.`,
        type: 'DEPOSITED',
      });

      alert(`Nạp kiện hàng ${order.orderId} thành công! Ngăn #${order.compartmentIndex} (${order.lockerName}) đã được khóa chốt.`);
      setIsDepositing(false);
      setDepositStep(1);
      setScannedBarcode(null);
      setIsScanSuccess(false);
      setScanError(null);
      loadOrders();
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

      {/* Action Strip: Kiosk Identification 60s */}
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
          <span>Sinh Mã QR Shipper 60s</span>
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
                  <span className="text-blue-600 font-extrabold text-sm">
                    Ngăn #{activeOrder.compartmentIndex} (Size {activeOrder.compartmentSize})
                  </span>
                </div>
              </div>

              {/* 4-Step Visual Progress Bar */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  { step: 1, label: '1. Quét mã kiện' },
                  { step: 2, label: '2. Mở cửa tủ' },
                  { step: 3, label: '3. Bỏ kiện hàng' },
                  { step: 4, label: '4. Kiểm tra cảm biến' },
                ].map((s) => (
                  <div
                    key={s.step}
                    className={`p-2.5 rounded-xl border text-[11px] font-bold transition-all ${
                      depositStep === s.step
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-500/20'
                        : depositStep > s.step
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                    }`}
                  >
                    {s.label}
                  </div>
                ))}
              </div>

              {/* STEP 1: SCAN BARCODE (GM65 LASER SIMULATION) */}
              {depositStep === 1 && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Camera className="w-5 h-5 text-blue-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Camera Quét Mã Đang Hoạt Động
                      </span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </div>

                  {/* Laser Scanning Frame Viewport */}
                  <div className="relative h-44 rounded-xl border-2 border-dashed border-slate-700 bg-slate-950 flex flex-col items-center justify-center overflow-hidden">
                    {/* Laser Red Beam Line */}
                    <div className="absolute inset-x-4 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-laser-sweep" />

                    <Barcode className="w-20 h-20 text-slate-600 opacity-60 mb-2" />
                    <span className="text-xs font-mono text-slate-300 z-10 font-bold">
                      {isScanningActive ? 'Đang nhận diện mã vạch...' : activeOrder.orderId}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-1 z-10">
                      Hướng mã vạch vào vùng quét
                    </span>
                  </div>

                  {scanError && (
                    <div className="p-3 bg-rose-950/50 border border-rose-500/40 text-rose-300 text-xs rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{scanError}</span>
                    </div>
                  )}

                  {isScanSuccess && (
                    <div className="p-3 bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Nhận diện thành công: <strong>{scannedBarcode}</strong></span>
                      </div>
                      <span className="font-bold text-emerald-400">Khớp trạm tủ ✓</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleScanBarcode(activeOrder.orderId)}
                      className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <ScanLine className="w-4 h-4" />
                      <span>Quét Mã Kiện ({activeOrder.orderId})</span>
                    </button>
                    {isScanSuccess && (
                      <button
                        type="button"
                        onClick={() => handleProceedDepositStep(2, activeOrder)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-5 rounded-xl text-xs transition cursor-pointer flex items-center gap-1.5"
                      >
                        <span>Tiếp Tục</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* STEP 2: OPEN SOLENOID LOCK */}
              {depositStep === 2 && (
                <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-4">
                  <div className="flex items-center gap-2.5 text-amber-900 font-bold text-xs uppercase">
                    <DoorOpen className="w-5 h-5 text-amber-600" />
                    <span>Bước 2: Mở cửa ngăn #{activeOrder.compartmentIndex}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Mã kiện hợp lệ. Nhấn nút để mở chốt cửa ngăn #{activeOrder.compartmentIndex}.
                  </p>

                  <button
                    onClick={() => handleProceedDepositStep(3, activeOrder)}
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold py-3.5 px-4 rounded-xl text-xs transition shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <DoorOpen className="w-4 h-4" />
                    <span>Mở Cửa Ngăn #{activeOrder.compartmentIndex}</span>
                  </button>
                </div>
              )}

              {/* STEP 3: PUT ITEM & CLOSE DOOR */}
              {depositStep === 3 && (
                <div className="p-5 rounded-2xl bg-blue-50/70 border border-blue-200 space-y-4">
                  <div className="flex items-center gap-2.5 text-blue-900 font-bold text-xs uppercase">
                    <Box className="w-5 h-5 text-blue-600" />
                    <span>Bước 3: Bỏ kiện hàng vào ngăn và đóng kín cửa</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Đặt <strong className="text-slate-800">{activeOrder.productName}</strong> vào ngăn #{activeOrder.compartmentIndex} và đóng chặt cửa.
                  </p>

                  <button
                    onClick={() => handleProceedDepositStep(4, activeOrder)}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl text-xs transition shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Xác Nhận Đã Đóng Cửa</span>
                  </button>
                </div>
              )}

              {/* STEP 4: DUAL-SENSOR VALIDATION & FINALIZE */}
              {depositStep === 4 && (
                <div className="p-5 rounded-2xl bg-emerald-50/70 border border-emerald-200 space-y-4">
                  <div className="flex items-center gap-2.5 text-emerald-900 font-bold text-xs uppercase">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>Bước 4: Xác thực cảm biến ngăn tủ</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-white rounded-xl border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase block font-semibold">Cảm biến cửa</span>
                      <span className="font-bold text-emerald-600 flex items-center gap-1 mt-1">
                        <Check className="w-3.5 h-3.5" /> Đã đóng kín cửa
                      </span>
                    </div>

                    <div className="p-3 bg-white rounded-xl border border-emerald-200">
                      <span className="text-[10px] text-slate-500 uppercase block font-semibold">Trọng lượng</span>
                      <span className="font-bold text-emerald-600 flex items-center gap-1 mt-1">
                        <Weight className="w-3.5 h-3.5" /> 0.85 kg (Đã có hàng)
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleProceedDepositStep(5, activeOrder)}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3.5 px-4 rounded-xl text-xs transition shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Hoàn Tất & Gửi Thông Báo Khách</span>
                  </button>
                </div>
              )}

              {/* Real-Time Locker Visual Cabinet */}
              <div className="pt-2">
                <LockerCabinetVisualizer
                  lockerName={activeOrder.lockerName}
                  lockerId={activeOrder.lockerId}
                  activeSlotId={activeOrder.compartmentIndex}
                  doorState={depositStep === 2 || depositStep === 3 ? 'OPEN' : 'CLOSED'}
                  sensorWeight={depositStep >= 3 ? 0.85 : 0.0}
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

      {/* Modal QR Định Danh Shipper 60s với CircularTimer */}
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

            {/* Circular Timer for Shipper 60s */}
            <div className="flex flex-col items-center justify-center my-2">
              <CircularTimer
                secondsLeft={timeLeft}
                totalSeconds={60}
                size={70}
                strokeWidth={5}
                label="Hiệu Lực"
              />
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
