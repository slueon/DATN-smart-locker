import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { store } from '../services/store';
import {
  Package, Clock, CheckCircle2, AlertTriangle, QrCode,
  Search, MapPin, Sparkles, Bell, X, AlertCircle, Timer,
  RefreshCw, ShieldCheck
} from 'lucide-react';

export default function CustomerPickupTab({ currentUser }) {
  const [orders, setOrders] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, PENDING, DEPOSITED, COMPLETED, OVERDUE
  const [searchQuery, setSearchQuery] = useState('');

  // Modal QR nhận hàng động (Rolling QR Code 60s)
  const [qrModalOrder, setQrModalOrder] = useState(null);
  const [qrToken, setQrToken] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(60);

  // Tải danh sách đơn hàng từ store
  useEffect(() => {
    loadOrders();
    const handleUpdate = () => loadOrders();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => window.removeEventListener('smart_locker_store_updated', handleUpdate);
  }, [currentUser]);

  const loadOrders = () => {
    const all = store.getOrders();
    // Lọc theo số điện thoại của người dùng nếu có
    if (currentUser?.phone) {
      setOrders(all.filter((o) => !o.customerPhone || o.customerPhone === currentUser.phone));
    } else {
      setOrders(all);
    }
  };

  // Sinh mã QR động mới
  const generateDynamicQr = (order) => {
    if (!order) return;
    const token = `PKUP-${order.orderId}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    setQrToken(token);
    setQrTimeLeft(60);
  };

  // Mở modal QR
  const handleOpenQrModal = (order) => {
    setQrModalOrder(order);
    generateDynamicQr(order);
  };

  // Đồng hồ đếm ngược 60 giây tự động reset mã QR mới
  useEffect(() => {
    if (!qrModalOrder) return;
    const interval = setInterval(() => {
      setQrTimeLeft((prev) => {
        if (prev <= 1) {
          generateDynamicQr(qrModalOrder);
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [qrModalOrder]);

  // Tính toán thời gian đếm ngược đến 24h00 ngày hôm sau
  const calculateRemainingTime = (expiryDeadline) => {
    if (!expiryDeadline) return { label: 'Không xác định', color: 'slate', isOverdue: false };
    const deadline = new Date(expiryDeadline).getTime();
    const now = new Date().getTime();
    const diffMs = deadline - now;

    if (diffMs <= 0) {
      return { label: 'ĐÃ QUÁ HẠN LƯU KHO', color: 'rose', isOverdue: true };
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    let color = 'emerald'; // > 12h
    if (hours < 2) {
      color = 'rose'; // < 2h (khẩn cấp)
    } else if (hours < 6) {
      color = 'amber'; // < 6h (cảnh báo)
    }

    return {
      label: `Còn lại ${hours} giờ ${minutes} phút (Đến 24h00 mai)`,
      color,
      isOverdue: false,
    };
  };

  // Yêu cầu mã OTP gửi về tài khoản web (hiển thị ở Chuông Thông Báo)
  const handleRequestOtp = (order) => {
    const newOtp = store.requestOtpForOrder(order.orderId);
    if (newOtp) {
      alert(`Đã gửi mã OTP (${newOtp}) về Hộp Thư Thông Báo trên thanh Navbar của bạn! Vui lòng kiểm tra biểu tượng chiếc chuông 🔔.`);
    }
  };

  // Lọc đơn hàng
  const filteredOrders = orders.filter((o) => {
    if (filterStatus !== 'ALL' && o.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = o.orderId?.toLowerCase().includes(q);
      const matchProduct = o.productName?.toLowerCase().includes(q);
      const matchLocker = o.lockerName?.toLowerCase().includes(q);
      return matchId || matchProduct || matchLocker;
    }
    return true;
  });

  const getStatusBadge = (status) => {
    switch (status) {
      case 'DEPOSITED':
        return (
          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> HÀNG ĐÃ VÀO TỦ (SẴN SÀNG LẤY)
          </span>
        );
      case 'PENDING':
        return (
          <span className="bg-amber-100 text-amber-800 border border-amber-300 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Đang chuẩn bị / Chờ Shipper nạp
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" /> Đã nhận hàng thành công
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="bg-rose-100 text-rose-800 border border-rose-300 text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> QUÁ HẠN LƯU KHO
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 notranslate">
      {/* Tiêu đề trang */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 flex items-center justify-center gap-2">
          <Package className="w-8 h-8 text-indigo-600" /> Quản Lý Đơn Hàng Của Tôi
        </h1>
        <p className="mt-2 text-slate-600 text-sm">
          Theo dõi trạng thái kiện hàng, nhận thông báo mã OTP và nhận hàng tại Tủ thông minh dễ dàng.
        </p>
      </div>

      {/* Thanh công cụ: Tìm kiếm & Lọc trạng thái */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-6 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between gap-4">
        {/* Tìm kiếm */}
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã đơn (ORD-...), tên sản phẩm, trạm tủ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
          />
        </div>

        {/* Bộ lọc trạng thái */}
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'ALL', label: 'Tất Cả' },
            { id: 'DEPOSITED', label: 'Hàng Đã Về Tủ' },
            { id: 'PENDING', label: 'Chờ Giao' },
            { id: 'COMPLETED', label: 'Đã Nhận' },
            { id: 'OVERDUE', label: 'Quá Hạn' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                filterStatus === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* DANH SÁCH CÁC ĐƠN HÀNG */}
      {filteredOrders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-700">Không tìm thấy đơn hàng nào</h3>
          <p className="text-xs text-slate-500 mt-1">
            Chưa có đơn hàng nào khớp với bộ lọc hoặc tài khoản của bạn chưa đặt đơn mới.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((ord) => {
            const timeInfo = calculateRemainingTime(ord.expiryDeadline);
            const isDeposited = ord.status === 'DEPOSITED';

            return (
              <div
                key={ord.orderId}
                className={`bg-white rounded-3xl border transition-all duration-200 overflow-hidden shadow-sm hover:shadow-md ${
                  isDeposited
                    ? 'border-indigo-200 ring-2 ring-indigo-500/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="p-5 sm:p-6 space-y-4">
                  {/* Header thẻ đơn */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-black text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                        {ord.orderId}
                      </span>
                      <span className="text-xs text-slate-400">
                        Ngày đặt: {ord.orderDate || ord.expectedDate}
                      </span>
                    </div>
                    <div>{getStatusBadge(ord.status)}</div>
                  </div>

                  {/* Nội dung chi tiết đơn */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    {/* Cột thông tin sản phẩm (7 cột) */}
                    <div className="md:col-span-7 space-y-2">
                      <h4 className="font-bold text-slate-800 text-sm">
                        {ord.productName || 'Kiện hàng Smart Locker'}
                      </h4>
                      <div className="text-xs text-slate-600 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>
                            <strong>{ord.lockerName || 'Tủ KTX A1'}</strong> - Ngăn #{ord.compartmentIndex || 2} (Size {ord.compartmentSize || 'M'})
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px] pl-5">
                          {ord.lockerAddress || 'Học viện CNBCVT, Hà Đông, Hà Nội'}
                        </p>
                      </div>
                    </div>

                    {/* Cột giá & trạng thái thanh toán (5 cột) */}
                    <div className="md:col-span-5 flex flex-col justify-between items-start md:items-end">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] text-slate-400 block">Tổng thanh toán</span>
                        <span className="text-base font-extrabold text-slate-800">
                          {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(ord.totalAmount || 450000)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* KHU VỰC ĐẶC BIỆT: KHI HÀNG ĐÃ VÀO TỦ (DEPOSITED) */}
                  {isDeposited && (
                    <div className="mt-4 pt-4 border-t border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-emerald-50/70 -mx-6 -mb-6 p-5 rounded-b-3xl space-y-4">
                      {/* Đồng hồ đếm ngược 24h00 ngày hôm sau */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className={`w-4 h-4 text-${timeInfo.color}-600 shrink-0`} />
                          <span className={`text-xs font-bold text-${timeInfo.color}-700`}>
                            Hạn lưu kho: {timeInfo.label}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          Chính sách lưu kho hết 24h00 ngày hôm sau
                        </span>
                      </div>

                      {/* Hai nút hành động: Nhận bằng QR và Nhận bằng OTP */}
                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        {/* Nút 1: Nhận hàng bằng mã QR động 60s */}
                        <button
                          onClick={() => handleOpenQrModal(ord)}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2 px-4 rounded-xl shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition"
                        >
                          <QrCode className="w-4 h-4" />
                          <span>🎁 Nhận Hàng (Mã QR Động)</span>
                        </button>

                        {/* Nút 2: Yêu cầu mã OTP về Web */}
                        <button
                          onClick={() => handleRequestOtp(ord)}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2 px-4 rounded-xl shadow-sm flex items-center gap-1.5 transition"
                          title="Sinh mã OTP và gửi về Chuông Thông Báo trên Web"
                        >
                          <Bell className="w-4 h-4" />
                          <span>🔑 Yêu Cầu Mã OTP Về Web</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* KHI ĐƠN ĐÃ QUÁ HẠN (OVERDUE) */}
                  {ord.status === 'OVERDUE' && (
                    <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-2.5 text-xs text-rose-700">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <strong>Mã nhận hàng đã bị tạm khóa do vượt quá 24h00 ngày hôm sau!</strong>
                        <p className="text-[11px] text-rose-600 mt-0.5">
                          Kiện hàng đang được điều phối cho Shipper hoặc Quản trị viên thu hồi. Vui lòng liên hệ Hotline hoặc Ban quản lý tủ để được hỗ trợ lấy lại kiện hàng.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODAL PHÓNG TO MÃ QR NHẬN HÀNG ĐỘNG (RESET SAU 60S) ================= */}
      {qrModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl relative border border-slate-100">
            <button
              onClick={() => setQrModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
              <QrCode className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-black text-slate-800">Mã QR Nhận Hàng Động</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Đơn hàng: <strong className="text-indigo-600">{qrModalOrder.orderId}</strong>
            </p>

            {/* Mã QR phóng to */}
            <div className="bg-white p-4 rounded-2xl border-2 border-dashed border-indigo-200 inline-block my-3 shadow-sm relative">
              <QRCodeSVG value={qrToken} size={180} />
            </div>

            {/* Bộ đếm ngược 60 giây và thanh tiến trình tự động đổi mã */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs font-bold text-indigo-600 mb-1.5">
                <span className="flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5" /> Tự động đổi mã sau:
                </span>
                <span className="font-mono text-sm bg-indigo-50 px-2 py-0.5 rounded">
                  {qrTimeLeft} giây
                </span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-600 h-full transition-all duration-1000"
                  style={{ width: `${(qrTimeLeft / 60) * 100}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 text-left space-y-1 mb-4">
              <p><strong>Điểm tủ:</strong> {qrModalOrder.lockerName}</p>
              <p><strong>Ngăn tủ:</strong> Ngăn #{qrModalOrder.compartmentIndex}</p>
              <div className="flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold pt-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Mã QR bảo mật chống chụp trộm (reset mỗi 60s)</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => generateDynamicQr(qrModalOrder)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                title="Làm mới mã ngay lập tức"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Làm Mới Mã</span>
              </button>
              <button
                onClick={() => setQrModalOrder(null)}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
