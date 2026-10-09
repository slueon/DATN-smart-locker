import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { store } from '../services/store';
import { shipperApi } from '../services/api';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, Box, AlertCircle, X,
  DoorOpen, Weight, Layers, ArrowRight, User, PackageX,
  Barcode, ScanLine, Scan, Camera
} from 'lucide-react';

export default function ShipperTab({ currentUser, onNavigateToRecall }) {
  const [orders, setOrders] = useState([]);
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
    // 1. Tự động kiểm tra đơn hàng khi mở tab
    store.checkAndScanOverdueOrders();
    loadOrders();

    const handleUpdate = () => loadOrders();

    // 2. Lắng nghe cập nhật đơn hàng
    const handleOverdueDetected = () => {
      loadOrders();
    };

    // 3. Tác vụ Daemon ngầm định kỳ 30 giây tự động đồng bộ dữ liệu
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
      {/* 4 KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Tổng đơn ca này</span>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{orders.length}</div>
        </div>

        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50/60 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700 uppercase">Chờ nạp vào ngăn</span>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{pendingOrders.length}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-700 uppercase">Đã nạp thành công</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{depositedOrders.length}</div>
        </div>

        <div
          onClick={() => onNavigateToRecall && onNavigateToRecall()}
          className="p-4 rounded-xl border border-rose-200 bg-white hover:border-rose-400 hover:bg-rose-50/50 shadow-xs cursor-pointer transition"
          title="Chuyển sang tab Thu hồi hàng quá hạn"
        >
          <span className="text-[11px] font-semibold text-rose-700 uppercase">Quá hạn cần thu hồi</span>
          <div className="text-2xl font-bold text-rose-600 mt-1 font-mono flex items-center justify-between">
            <span>{overdueOrders.length}</span>
            {overdueOrders.length > 0 && (
              <span className="text-[10px] font-sans font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full uppercase animate-pulse">
                Khẩn cấp
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Strip: Kiosk Identification 60s */}
      <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-amber-800 text-xs font-bold uppercase">
            <ShieldCheck className="w-4 h-4" /> Xác thực danh tính tại màn hình Kiosk
          </div>
          <p className="text-xs text-slate-600">
            Tạo mã QR động 60 giây và hướng vào Module camera GM65 của trạm tủ để bắt đầu quyền nạp hàng.
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

      {/* SPLIT-PANE WORKSPACE: Left = Queue, Right = Deposit Station */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: DISPATCH QUEUE (5 Columns) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Hàng cần giao ({filteredPending.length})
            </span>

            {/* Locker Filter */}
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
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
            {filteredPending.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-800">Toàn bộ bưu kiện đã được nạp an toàn!</p>
              </div>
            ) : (
              filteredPending.map((ord) => {
                const isSelected = activeOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => {
                      setSelectedOrderId(ord.orderId);
                      setDepositStep(1);
                      setIsDepositing(false);
                      setScannedBarcode(null);
                      setIsScanSuccess(false);
                      setScanError(null);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer bg-white ${
                      isSelected
                        ? 'border-amber-500 ring-2 ring-amber-500/10 shadow-xs'
                        : 'border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.2 rounded">
                        {ord.orderId}
                      </span>
                      <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.2 rounded">
                        Chờ nạp
                      </span>
                    </div>

                    <h4 className="font-semibold text-slate-900 text-xs truncate">
                      {ord.productName || 'Kiện hàng Smart Locker'}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
                      <span>{ord.lockerName}</span>
                      <span className="font-semibold text-blue-700 bg-blue-50 px-2 py-0.2 rounded">
                        Ngăn #{ord.compartmentIndex} ({ord.compartmentSize})
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: ACTIVE DEPOSIT STATION & SENSOR WORKBENCH (7 Columns) */}
        <div className="lg:col-span-7 space-y-4">
          {activeOrder ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
              {/* Active Parcel Info */}
              <div className="pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      {activeOrder.orderId}
                    </span>
                    <span className="text-xs text-slate-400">
                      Điểm đến: <strong className="text-slate-800">{activeOrder.lockerName}</strong>
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-1">
                    {activeOrder.productName || 'Kiện hàng Smart Locker'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Người nhận: <strong className="text-slate-800">{activeOrder.customerName}</strong> ({activeOrder.customerPhone})
                  </p>
                </div>

                <div className="text-right">
                  <span className="bg-blue-50 text-blue-700 font-bold px-3 py-1 rounded-lg border border-blue-200 text-xs block">
                    Ngăn #{activeOrder.compartmentIndex} (Size {activeOrder.compartmentSize})
                  </span>
                </div>
              </div>

              {/* DUAL-SENSOR DEPOSIT STEPPER WIZARD WITH GM65 BARCODE SCAN */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-blue-600" />
                    Quy Trình Nạp Hàng 4 Bước Cảm Biến Kép
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
                    Bước {depositStep} / 4
                  </span>
                </div>

                {/* 4 Steps Stepper Indicator */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  {[
                    { step: 1, label: '1. Quét mã kiện (GM65)' },
                    { step: 2, label: '2. Mở Solenoid' },
                    { step: 3, label: '3. Đặt & Đóng tủ' },
                    { step: 4, label: '4. Cảm biến kép' },
                  ].map((s) => {
                    const isDone = depositStep > s.step;
                    const isCurrent = depositStep === s.step;

                    return (
                      <div
                        key={s.step}
                        className={`p-2 rounded-xl border transition-all ${
                          isDone
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold'
                            : isCurrent
                            ? 'bg-blue-600 border-blue-600 text-white font-bold shadow-xs'
                            : 'bg-white border-slate-200 text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {isDone ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <span className="font-mono text-[11px]">{s.step}</span>
                          )}
                          <span className="text-[11px] hidden sm:inline">{s.label.split('. ')[1]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* STEP 1: SCAN PARCEL BARCODE VIA GM65 */}
                {depositStep === 1 && (
                  <div className="space-y-4 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200">
                        <Barcode className="w-5 h-5" />
                      </div>
                      <div className="text-xs flex-1">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-slate-900 text-sm">
                            Bước 1: Quét mã vạch kiện hàng (Module GM65 Tracking Scan)
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                            GM65 SCANNER ONLINE
                          </span>
                        </div>
                        <p className="text-slate-500 mt-1 leading-relaxed">
                          Đưa mã Barcode hoặc QR Code in trên tem bưu kiện vào tầm quét của Module GM65 để hệ thống đối soát mã vận đơn và phân bổ ngăn tủ chính xác.
                        </p>
                      </div>
                    </div>

                    {/* Scanner Viewfinder Box */}
                    <div className="bg-slate-950 rounded-2xl p-4 sm:p-5 text-white relative overflow-hidden border border-slate-800 shadow-inner">
                      <div className="py-4 text-center space-y-3">
                        <div className="relative inline-block px-12 py-5 border-2 border-dashed border-blue-400/50 rounded-xl bg-blue-950/20">
                          <Barcode className="w-16 h-10 text-blue-400 mx-auto opacity-80" />
                          {/* Animated Red Laser Scan Line */}
                          <div className="absolute inset-x-0 top-1/2 h-0.5 bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-pulse" />
                          <div className="text-[10px] font-mono text-slate-400 mt-1 uppercase tracking-wider">
                            Vùng nhận diện mã GM65
                          </div>
                        </div>

                        {isScanSuccess && scannedBarcode ? (
                          <div className="bg-emerald-500/20 border border-emerald-500/40 rounded-xl p-3 max-w-md mx-auto text-center animate-in zoom-in-95">
                            <div className="text-xs font-bold text-emerald-300 flex items-center justify-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              ĐÃ XÁC THỰC MÃ KIỆN: <span className="font-mono text-white text-sm">{scannedBarcode}</span>
                            </div>
                            <p className="text-[11px] text-emerald-200/90 mt-1">
                              Trùng khớp hoàn toàn với {activeOrder.lockerName} — Chỉ định: <strong>Ngăn #{activeOrder.compartmentIndex} (Size {activeOrder.compartmentSize})</strong>
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-xs text-slate-300">
                              Bưu kiện cần nạp: <span className="font-mono font-bold text-amber-400">{activeOrder.orderId}</span> ({activeOrder.customerName})
                            </p>
                            {scanError && (
                              <div className="text-rose-400 text-xs font-semibold flex items-center justify-center gap-1 mt-1">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>{scanError}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Barcode Manual Input & Trigger */}
                      <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center gap-2">
                        <input
                          type="text"
                          value={manualBarcodeInput}
                          onChange={(e) => setManualBarcodeInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleScanBarcode()}
                          placeholder={`Nhập/Paste mã vận đơn (VD: ${activeOrder.orderId})`}
                          className="w-full sm:flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                        />
                        <button
                          onClick={() => handleScanBarcode(activeOrder.orderId)}
                          disabled={isScanningActive}
                          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
                        >
                          <ScanLine className={`w-3.5 h-3.5 ${isScanningActive ? 'animate-spin' : ''}`} />
                          <span>{isScanningActive ? 'Đang quét...' : `Quét mã (${activeOrder.orderId})`}</span>
                        </button>
                      </div>
                    </div>

                    {/* Step 1 Action Button */}
                    {isScanSuccess ? (
                      <button
                        onClick={() => handleProceedDepositStep(2, activeOrder)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
                      >
                        <span>Mã bưu kiện hợp lệ ➔ Chuyển sang Bước 2: Kích hoạt mở chốt Solenoid (Ngăn #{activeOrder.compartmentIndex})</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleScanBarcode(activeOrder.orderId)}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
                      >
                        <ScanLine className="w-4 h-4 text-blue-400" />
                        <span>Kích hoạt Module GM65 quét mã bưu kiện</span>
                      </button>
                    )}
                  </div>
                )}

                {/* STEP 2: OPEN SOLENOID LOCK */}
                {depositStep === 2 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200">
                        <DoorOpen className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900 text-sm">Bước 2: Kích hoạt mở khóa chốt điện Solenoid</h4>
                        <p className="text-slate-600 mt-1 leading-relaxed">
                          Mã bưu kiện <strong>{activeOrder.orderId}</strong> đã xác thực hợp lệ. Hệ thống gửi lệnh kích Relay 12V để bật mở chốt khóa của <strong>Ngăn #{activeOrder.compartmentIndex}</strong> tại trạm <strong>{activeOrder.lockerName}</strong>.
                        </p>
                        <div className="mt-2.5 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-[11px]">
                          💡 Cửa ngăn tủ sẽ tự động bung nhẹ. Vui lòng đứng trước ngăn #{activeOrder.compartmentIndex}.
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(3, activeOrder)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
                    >
                      <DoorOpen className="w-4 h-4" />
                      <span>Xác nhận cửa đã mở ➔ Bước 3: Đặt bưu kiện vào ngăn</span>
                    </button>
                  </div>
                )}

                {/* STEP 3: PUT IN PARCEL & CLOSE DOOR */}
                {depositStep === 3 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                        <Box className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900 text-sm">Bước 3: Đặt bưu kiện vào ngăn & Đóng kín cửa tủ</h4>
                        <p className="text-slate-600 mt-1 leading-relaxed">
                          Đặt gói hàng <strong>{activeOrder.orderId}</strong> vào chính giữa khay cân Loadcell HX711. Dùng tay đẩy chặt cánh cửa tủ cho đến khi chốt nam châm MC-38 tiếp xúc khít.
                        </p>
                        <div className="mt-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[11px] space-y-1">
                          <div className="font-semibold text-slate-900">Quy chuẩn an toàn:</div>
                          <div>• Đảm bảo gói hàng không bị kẹp vào mép cánh tủ</div>
                          <div>• Khay cảm biến lực cân tải trọng sẽ tự động đo lường ngay khi cửa đóng</div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(4, activeOrder)}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Đã đặt hàng & Đóng kín cửa ➔ Kích hoạt kiểm tra cảm biến kép</span>
                    </button>
                  </div>
                )}

                {/* STEP 4: DUAL SENSOR VERIFICATION */}
                {depositStep === 4 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200">
                        <Weight className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900 text-sm">Bước 4: Xác thực cảm biến kép thành công (Dual-Sensor Verification)</h4>
                        <div className="mt-2.5 space-y-1.5 bg-white p-3 rounded-xl border border-slate-200 text-[11px] font-mono">
                          <div className="flex justify-between text-emerald-700">
                            <span>1. Cảm biến từ tính MC-38:</span>
                            <span className="font-bold">ĐÃ ĐÓNG KÍN (CLOSED)</span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>2. Cảm biến tải trọng Loadcell HX711:</span>
                            <span className="font-bold">0.85 KG (HỢP LỆ &gt; 0.05 KG)</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-2">
                          Cảm biến kép xác nhận kiện hàng đã được lưu trữ an toàn trong ngăn tủ. Hệ thống sẵn sàng kích hoạt hạn lưu kho 24h00 và gửi mã OTP/QR nhận hàng đến khách hàng.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(5, activeOrder)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Hoàn tất nạp hàng ➔ Kích hoạt hạn lưu 24h & Gửi thông báo đến khách hàng</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-12 text-center">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn đơn hàng nào</h4>
              <p className="text-xs text-slate-500 mt-1">Chọn một kiện hàng từ danh sách bên trái để tiến hành nạp.</p>
            </div>
          )}

        </div>
      </div>

      {/* Shipper QR Modal */}
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
