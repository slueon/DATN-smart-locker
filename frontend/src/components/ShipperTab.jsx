import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { store } from '../services/store';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, Box, AlertCircle, X,
  DoorOpen, Weight, Layers, ArrowRight, User
} from 'lucide-react';

export default function ShipperTab({ currentUser }) {
  const [orders, setOrders] = useState([]);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Token QR 60s
  const [dynamicToken, setDynamicToken] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  // Deposit Stepper State
  const [depositStep, setDepositStep] = useState(1);
  const [isDepositing, setIsDepositing] = useState(false);

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => loadOrders();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => window.removeEventListener('smart_locker_store_updated', handleUpdate);
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
  };

  const handleProceedDepositStep = (nextStep, order) => {
    setDepositStep(nextStep);
    if (nextStep === 4 && order) {
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

      setIsDepositing(false);
      setDepositStep(1);
      loadOrders();
    }
  };

  const handleReturnOverdue = (order) => {
    if (window.confirm(`Xác nhận thu hồi bưu kiện ${order.orderId} tại Ngăn #${order.compartmentIndex} về kho bãi?`)) {
      store.updateOrderStatus(order.orderId, 'COMPLETED', {
        returnedAt: new Date().toISOString(),
        note: 'Đã thu hồi do quá hạn lưu kho',
      });
      alert(`Đã thu hồi bưu kiện ${order.orderId} và giải phóng Ngăn #${order.compartmentIndex} thành công!`);
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

        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700 uppercase">Chờ nạp vào ngăn</span>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{pendingOrders.length}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-700 uppercase">Đã nạp thành công</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{depositedOrders.length}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs">
          <span className="text-[11px] font-semibold text-rose-700 uppercase">Quá hạn cần thu hồi</span>
          <div className="text-2xl font-bold text-rose-600 mt-1 font-mono">{overdueOrders.length}</div>
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

              {/* DUAL-SENSOR DEPOSIT STEPPER WIZARD */}
              <div className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Quy Trình Nạp Hàng Cảm Biến Kép (IoT Workbench)
                  </span>
                  <span className="text-[11px] font-mono font-semibold text-blue-600">
                    Bước {depositStep} / 4
                  </span>
                </div>

                {/* Step Indicators */}
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4].map((s) => (
                    <div
                      key={s}
                      className={`h-1.5 rounded-full flex-1 transition-all ${
                        depositStep >= s ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>

                {/* Step 1: Open Solenoid */}
                {depositStep === 1 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200">
                        <DoorOpen className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900">Bước 1: Kích hoạt mở khóa chốt điện Solenoid</h4>
                        <p className="text-slate-500 mt-0.5 leading-relaxed">
                          Relay 12V sẽ kích mở chốt cơ của <strong>Ngăn #{activeOrder.compartmentIndex}</strong>. Cửa bật mở nhẹ.
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(2, activeOrder)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer"
                    >
                      Xác nhận cửa đã mở ➔ Tiến hành bỏ kiện hàng
                    </button>
                  </div>
                )}

                {/* Step 2: Put in Parcel & Close Door */}
                {depositStep === 2 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-200">
                        <Box className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900">Bước 2: Bỏ bưu kiện vào ngăn & Khép cửa tủ</h4>
                        <p className="text-slate-500 mt-0.5 leading-relaxed">
                          Đặt gói hàng lên mặt bàn cân Load cell. Đóng kín cánh cửa tủ cho đến khi chốt kêu "tách".
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(3, activeOrder)}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer"
                    >
                      Đã đóng kín cửa ➔ Kích hoạt kiểm tra cảm biến kép
                    </button>
                  </div>
                )}

                {/* Step 3: Dual Sensor Verification */}
                {depositStep === 3 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200">
                        <Weight className="w-5 h-5" />
                      </div>
                      <div className="text-xs">
                        <h4 className="font-bold text-slate-900">Bước 3: Xác thực cảm biến kép thành công</h4>
                        <div className="mt-2 space-y-1 bg-white p-2.5 rounded-lg border border-slate-200 text-[11px] font-mono">
                          <div className="flex justify-between text-emerald-700">
                            <span>1. Cảm biến từ MC-38:</span>
                            <span className="font-bold">ĐÃ ĐÓNG KÍN (CLOSED)</span>
                          </div>
                          <div className="flex justify-between text-emerald-700">
                            <span>2. Cảm biến tải trọng HX711:</span>
                            <span className="font-bold">0.85 KG (HỢP LỆ)</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleProceedDepositStep(4, activeOrder)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs transition shadow-xs cursor-pointer"
                    >
                      Hoàn tất nạp hàng ➔ Kích hoạt hạn lưu 24h & Gửi thông báo
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

          {/* Overdue Parcels Recall Drawer */}
          {overdueOrders.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <h4 className="font-bold text-xs uppercase tracking-wider">
                  Bưu kiện quá hạn cần thu hồi về kho ({overdueOrders.length})
                </h4>
              </div>

              <div className="space-y-2">
                {overdueOrders.map((ord) => (
                  <div
                    key={ord.orderId}
                    className="p-3 rounded-xl bg-white border border-rose-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-rose-700">{ord.orderId}</span>
                      <p className="font-semibold text-slate-800 mt-0.5">{ord.lockerName} - Ngăn #{ord.compartmentIndex}</p>
                      <p className="text-[11px] text-slate-500">Khách: {ord.customerName}</p>
                    </div>

                    <button
                      onClick={() => handleReturnOverdue(ord)}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs py-1.5 px-3 rounded-lg transition cursor-pointer"
                    >
                      Thu hồi về kho
                    </button>
                  </div>
                ))}
              </div>
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
