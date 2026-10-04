import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { store } from '../services/store';
import {
  Truck, QrCode, Timer, ShieldCheck, CheckCircle2, AlertTriangle,
  RefreshCw, MapPin, Package, Check, ArrowRight, Box, AlertCircle, X,
  DoorOpen, Weight
} from 'lucide-react';

export default function ShipperTab({ currentUser }) {
  const [orders, setOrders] = useState([]);
  const [selectedLockerFilter, setSelectedLockerFilter] = useState('ALL');

  // Token QR 60s
  const [dynamicToken, setDynamicToken] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showQrModal, setShowQrModal] = useState(false);

  // Deposit Simulation Modal (Quá trình bỏ hàng vào tủ với cảm biến kép)
  const [depositModalOrder, setDepositModalOrder] = useState(null);
  const [depositStep, setDepositStep] = useState(1); // 1: Mở khóa, 2: Đang bỏ hàng, 3: Cảm biến kép xác nhận, 4: Hoàn tất

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => loadOrders();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => window.removeEventListener('smart_locker_store_updated', handleUpdate);
  }, []);

  const loadOrders = () => {
    setOrders(store.getOrders());
  };

  // Đồng hồ đếm ngược 60s của Token Shipper
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

  // Sinh mã QR động 60s
  const handleGenerateToken = () => {
    const token = 'SHIPPER-TOKEN-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now();
    setDynamicToken(token);
    setTimeLeft(60);
    setShowQrModal(true);
  };

  // Bắt đầu quá trình nạp hàng vào ngăn tủ
  const handleStartDeposit = (order) => {
    setDepositModalOrder(order);
    setDepositStep(1); // Bước 1: Mở khóa Solenoid
  };

  // Mô phỏng từng bước của cảm biến kép tại tủ
  const handleProceedDepositStep = (nextStep) => {
    setDepositStep(nextStep);
    if (nextStep === 4) {
      // Hoàn tất: Cập nhật trạng thái đơn thành DEPOSITED
      const now = new Date();
      // Hạn chót: 24h00 ngày hôm sau
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      store.updateOrderStatus(depositModalOrder.orderId, 'DEPOSITED', {
        depositedAt: now.toISOString(),
        expiryDeadline: tomorrow.toISOString(),
      });

      // Tạo thông báo cho khách hàng
      store.addNotification({
        phone: depositModalOrder.customerPhone,
        orderId: depositModalOrder.orderId,
        title: 'Kiện hàng đã về Tủ!',
        message: `Đơn hàng ${depositModalOrder.orderId} đã được Shipper giao vào ${depositModalOrder.lockerName} - Ngăn #${depositModalOrder.compartmentIndex}. Hạn chót lấy hàng: 24h00 ngày mai.`,
        type: 'DEPOSITED',
      });
    }
  };

  // Thu hồi đơn hàng quá hạn
  const handleReturnOverdue = (order) => {
    if (window.confirm(`Xác nhận thu hồi bưu kiện ${order.orderId} tại Ngăn #${order.compartmentIndex} về kho bãi?`)) {
      store.updateOrderStatus(order.orderId, 'COMPLETED', {
        returnedAt: new Date().toISOString(),
        note: 'Đã thu hồi do quá hạn lưu kho',
      });
      alert(`Đã thu hồi bưu kiện ${order.orderId} và giải phóng Ngăn #${order.compartmentIndex} thành công!`);
    }
  };

  // Thống kê ca làm việc
  const pendingOrders = orders.filter((o) => o.status === 'PENDING');
  const depositedOrders = orders.filter((o) => o.status === 'DEPOSITED' || o.status === 'COMPLETED');
  const overdueOrders = orders.filter((o) => o.status === 'OVERDUE');

  // Lọc theo tủ
  const filteredPending = pendingOrders.filter((o) => {
    if (selectedLockerFilter === 'ALL') return true;
    return o.lockerId === selectedLockerFilter;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 notranslate">
      {/* Tiêu đề */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 flex items-center justify-center gap-2">
          <Truck className="w-8 h-8 text-amber-500" /> Cổng Quản Lý Giao Hàng Của Shipper
        </h1>
        <p className="mt-2 text-slate-600 text-sm">
          Xác thực danh tính 2 bước bằng mã QR động 60s và nạp kiện hàng vào Tủ thông minh an toàn với cảm biến kép.
        </p>
      </div>

      {/* 4 THẺ THỐNG KÊ CA LÀM VIỆC */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Tổng đơn ca hôm nay
          </span>
          <div className="text-2xl font-black text-slate-800 mt-1">{orders.length}</div>
          <span className="text-[11px] text-slate-500 mt-1 block">Toàn bộ tuyến tủ PTIT</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-amber-200 bg-amber-50/30 shadow-sm">
          <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block">
            Chờ nạp vào tủ
          </span>
          <div className="text-2xl font-black text-amber-600 mt-1">{pendingOrders.length}</div>
          <span className="text-[11px] text-amber-700/70 mt-1 block">Cần giao ngay</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-emerald-200 bg-emerald-50/30 shadow-sm">
          <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block">
            Đã nạp thành công
          </span>
          <div className="text-2xl font-black text-emerald-600 mt-1">{depositedOrders.length}</div>
          <span className="text-[11px] text-emerald-700/70 mt-1 block">Đã vào tủ an toàn</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-rose-200 bg-rose-50/30 shadow-sm">
          <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wider block">
            Đơn quá hạn cần thu hồi
          </span>
          <div className="text-2xl font-black text-rose-600 mt-1">{overdueOrders.length}</div>
          <span className="text-[11px] text-rose-700/70 mt-1 block">Cần giải phóng ngăn</span>
        </div>
      </div>

      {/* BANNER HÀNH ĐỘNG CHÍNH: NÚT XÁC MINH DANH TÍNH TẠI TỦ */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl mb-8 flex flex-col md:flex-row items-center justify-between gap-6 border border-indigo-900">
        <div className="space-y-2 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 text-amber-400 text-xs font-black uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4" /> BƯỚC 1: XÁC THỰC DANH TÍNH SHIPPER
          </div>
          <h2 className="text-xl sm:text-2xl font-black">
            Bạn Đang Đứng Trước Tủ Thông Minh?
          </h2>
          <p className="text-xs text-slate-300 max-w-xl">
            Bấm nút dưới đây để sinh <strong>Mã QR Định Danh Động có hiệu lực 60 giây</strong>. Đưa mã này trước camera Module GM65 trên tủ để mở quyền nạp hàng.
          </p>
        </div>

        <button
          onClick={handleGenerateToken}
          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-6 py-4 rounded-2xl shadow-lg shadow-amber-500/30 flex items-center gap-2.5 transition text-sm shrink-0"
        >
          <QrCode className="w-5 h-5" />
          <span>📱 XÁC MINH DANH TÍNH TẠI TỦ</span>
        </button>
      </div>

      {/* DANH SÁCH KIỆN HÀNG CẦN NẠP VÀO TỦ (BƯỚC 2) */}
      <div className="space-y-4 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Package className="w-5 h-5 text-indigo-600" /> Danh Sách Kiện Hàng Cần Giao Vào Tủ
            </h3>
            <p className="text-xs text-slate-500">Các đơn hàng đã được khách đặt trước điểm tủ và ngăn tủ tương ứng</p>
          </div>

          {/* Lọc theo trạm tủ */}
          <div className="flex gap-1.5">
            {[
              { id: 'ALL', label: 'Tất Cả Tủ' },
              { id: 'LOCKER_HN_01', label: 'Tủ KTX A1' },
              { id: 'LOCKER_HN_02', label: 'Tủ Thư Viện' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedLockerFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                  selectedLockerFilter === f.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredPending.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-700">Tất cả kiện hàng trong ca đã được nạp vào tủ!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredPending.map((ord) => (
              <div
                key={ord.orderId}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    {ord.orderId}
                  </span>
                  <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                    CHỜ NẠP TỦ
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-800 line-clamp-1">
                    {ord.productName || 'Kiện hàng Smart Locker'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Khách nhận: <strong>{ord.customerName}</strong> ({ord.customerPhone})
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Điểm tủ đến:</span>
                    <strong className="text-slate-800">{ord.lockerName || 'Tủ KTX A1'}</strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Ngăn tủ chỉ định:</span>
                    <span className="bg-indigo-600 text-white font-extrabold px-2 py-0.5 rounded-full text-[10px]">
                      Ngăn #{ord.compartmentIndex || 2} (Size {ord.compartmentSize || 'M'})
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleStartDeposit(ord)}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 transition"
                >
                  <Box className="w-4 h-4" />
                  <span>Bỏ Hàng Vào Ngăn #{ord.compartmentIndex || 2}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DANH SÁCH BƯU KIỆN QUÁ HẠN CẦN THU HỒI */}
      {overdueOrders.length > 0 && (
        <div className="bg-rose-50/50 border border-rose-200 rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="w-5 h-5 text-rose-600" />
            <h3 className="font-bold text-sm">Danh Sách Bưu Kiện Quá Hạn Cần Thu Hồi</h3>
          </div>
          <p className="text-xs text-rose-600">
            Các kiện hàng này đã lưu kho vượt mốc 24h00 ngày hôm sau. Shipper cần đến tủ thu hồi để giải phóng ngăn cho khách hàng mới.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {overdueOrders.map((ord) => (
              <div key={ord.orderId} className="bg-white p-4 rounded-2xl border border-rose-200 shadow-sm flex items-center justify-between">
                <div>
                  <span className="font-mono text-xs font-bold text-rose-600">{ord.orderId}</span>
                  <p className="text-xs text-slate-700 font-semibold mt-0.5">{ord.lockerName} - Ngăn #{ord.compartmentIndex}</p>
                  <p className="text-[11px] text-slate-400">Khách: {ord.customerName}</p>
                </div>
                <button
                  onClick={() => handleReturnOverdue(ord)}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs py-2 px-3.5 rounded-xl shadow-sm transition"
                >
                  Thu Hồi Kiện Hàng
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= MODAL MÃ QR ĐỊNH DANH ĐỘNG 60S ================= */}
      {showQrModal && dynamicToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl relative border border-slate-100">
            <button
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-black text-slate-800">Mã QR Định Danh Shipper</h3>
            <p className="text-xs text-slate-500">Mã động xác thực với camera Module GM65 tại tủ</p>

            {/* Mã QR */}
            <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-amber-300 inline-block my-4 shadow-sm relative">
              <QRCodeSVG value={dynamicToken} size={180} />
              {timeLeft <= 0 && (
                <div className="absolute inset-0 bg-white/90 backdrop-blur-xs flex items-center justify-center rounded-2xl">
                  <span className="text-xs font-bold text-rose-600">MÃ ĐÃ HẾT HẠN</span>
                </div>
              )}
            </div>

            {/* Đồng hồ đếm ngược 60s */}
            <div className="mb-4">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-amber-600">
                <Timer className="w-4 h-4" />
                <span>Hiệu lực còn lại: {timeLeft} giây</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-1.5">
                <div
                  className="bg-amber-500 h-full transition-all duration-1000"
                  style={{ width: `${(timeLeft / 60) * 100}%` }}
                />
              </div>
            </div>

            {timeLeft <= 0 ? (
              <button
                onClick={handleGenerateToken}
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" /> Tạo Mã QR Mới
              </button>
            ) : (
              <button
                onClick={() => setShowQrModal(false)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs transition"
              >
                Đã Quét Xong & Đóng
              </button>
            )}
          </div>
        </div>
      )}

      {/* ================= MODAL MÔ PHỎNG NẠP HÀNG TỦ IOT (CẢM BIẾN KÉP) ================= */}
      {depositModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border-4 border-slate-700 rounded-3xl max-w-md w-full p-6 text-white shadow-2xl relative">
            <button
              onClick={() => setDepositModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center mb-5 pb-3 border-b border-slate-800">
              <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider block">
                MÔ PHỎNG QUY TRÌNH NẠP HÀNG TẠI TỦ IOT
              </span>
              <h3 className="text-base font-bold text-white mt-1">
                {depositModalOrder.lockerName} - Ngăn #{depositModalOrder.compartmentIndex}
              </h3>
            </div>

            {/* Bước 1: Mở khóa Solenoid */}
            {depositStep === 1 && (
              <div className="text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center mx-auto text-indigo-400">
                  <DoorOpen className="w-8 h-8" />
                </div>
                <h4 className="text-sm font-bold text-white">Khóa Solenoid Đang Bật Mở...</h4>
                <p className="text-xs text-slate-300">
                  Hệ thống gửi lệnh mở khóa <strong>Ngăn #{depositModalOrder.compartmentIndex}</strong>. Đèn tín hiệu tại ngăn sáng xanh.
                </p>

                <button
                  onClick={() => handleProceedDepositStep(2)}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-indigo-600/30"
                >
                  Xác nhận cửa đã mở ➔ Tiến hành bỏ hàng
                </button>
              </div>
            )}

            {/* Bước 2: Bỏ hàng vào ngăn */}
            {depositStep === 2 && (
              <div className="text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto text-amber-400">
                  <Box className="w-8 h-8" />
                </div>
                <h4 className="text-sm font-bold text-white">Shipper Bỏ Kiện Hàng Vào Ngăn</h4>
                <p className="text-xs text-slate-300">
                  Đơn hàng <strong>{depositModalOrder.orderId}</strong> được đặt gọn gàng trong ngăn tủ. Shipper đẩy cánh cửa tủ đóng chặt lại.
                </p>

                <button
                  onClick={() => handleProceedDepositStep(3)}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition shadow-md shadow-amber-500/30"
                >
                  Đã đóng cửa tủ ➔ Kích hoạt cảm biến kép
                </button>
              </div>
            )}

            {/* Bước 3: Cảm biến kép xác nhận */}
            {depositStep === 3 && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 mb-2">
                    <Weight className="w-8 h-8" />
                  </div>
                  <h4 className="text-sm font-bold text-white">Xác Thực Cảm Biến Kép (Dual-Sensor)</h4>
                </div>

                <div className="space-y-2 bg-slate-800 p-4 rounded-2xl border border-slate-700 text-xs">
                  <div className="flex items-center justify-between text-emerald-300">
                    <span>1. Cảm biến cửa từ MC-38:</span>
                    <strong className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> ĐÃ ĐÓNG KÍN</strong>
                  </div>
                  <div className="flex items-center justify-between text-emerald-300">
                    <span>2. Cảm biến tải trọng Load cell HX711:</span>
                    <strong className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 0.85 KG (HỢP LỆ)</strong>
                  </div>
                </div>

                <button
                  onClick={() => handleProceedDepositStep(4)}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-md shadow-emerald-600/30"
                >
                  Hoàn Tất Nạp Hàng & Kích Hoạt Lưu Kho 24h
                </button>
              </div>
            )}

            {/* Bước 4: Hoàn tất */}
            {depositStep === 4 && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mx-auto">
                  <Check className="w-8 h-8 stroke-[3]" />
                </div>
                <h4 className="text-lg font-black text-emerald-400">
                  NẠP HÀNG THÀNH CÔNG!
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Đơn hàng <strong>{depositModalOrder.orderId}</strong> đã được lưu kho an toàn trong Ngăn #{depositModalOrder.compartmentIndex}.
                  Mốc lưu kho đến hết 24h00 ngày hôm sau đã được kích hoạt và gửi thông báo cho khách hàng.
                </p>

                <button
                  onClick={() => setDepositModalOrder(null)}
                  className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition"
                >
                  Đóng & Tiếp Tục Ca Giao
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
