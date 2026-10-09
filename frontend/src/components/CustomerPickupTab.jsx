import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import LockerMap from './LockerMap';
import { store } from '../services/store';
import { pickupApi } from '../services/api';
import {
  Package, Clock, CheckCircle2, AlertTriangle, QrCode,
  Search, MapPin, X, AlertCircle, Timer,
  RefreshCw, ShieldCheck, Key, ChevronRight, Check,
  Calendar, Layers, ArrowUpRight, Copy, Sparkles
} from 'lucide-react';

export default function CustomerPickupTab({ currentUser }) {
  const [orders, setOrders] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Modal QR Rolling 60s
  const [qrModalOrder, setQrModalOrder] = useState(null);
  const [qrToken, setQrToken] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(60);

  // State OTP 5 phút
  const [otpModalOrder, setOtpModalOrder] = useState(null);
  const [generatingOtpId, setGeneratingOtpId] = useState(null);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [otpToast, setOtpToast] = useState(null);
  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Đồng bộ order trong modal khi store thay đổi
  useEffect(() => {
    if (otpModalOrder) {
      const fresh = orders.find((o) => o.orderId === otpModalOrder.orderId);
      if (fresh) setOtpModalOrder(fresh);
    }
    if (qrModalOrder) {
      const fresh = orders.find((o) => o.orderId === qrModalOrder.orderId);
      if (fresh) setQrModalOrder(fresh);
    }
  }, [orders]);

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => loadOrders();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => window.removeEventListener('smart_locker_store_updated', handleUpdate);
  }, [currentUser]);

  const loadOrders = () => {
    const all = store.getOrders();
    const userOrders = currentUser?.phone
      ? all.filter((o) => !o.customerPhone || o.customerPhone === currentUser.phone)
      : all;
    setOrders(userOrders);

    // Mặc định chọn đơn đầu tiên nếu chưa chọn
    if (userOrders.length > 0 && !selectedOrderId) {
      setSelectedOrderId(userOrders[0].orderId);
    }
  };

  const generateDynamicQr = (order) => {
    if (!order) return;
    const token = `PKUP-${order.orderId}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    setQrToken(token);
    setQrTimeLeft(60);
  };

  const handleOpenQrModal = (order) => {
    setQrModalOrder(order);
    generateDynamicQr(order);
  };

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

  const calculateRemainingTime = (expiryDeadline) => {
    if (!expiryDeadline) return { label: 'Chờ nạp tủ', color: 'slate', percent: 0, isOverdue: false };
    const deadline = new Date(expiryDeadline).getTime();
    const now = new Date().getTime();
    const diffMs = deadline - now;

    if (diffMs <= 0) {
      return { label: 'Đã quá hạn lưu kho', color: 'rose', percent: 100, isOverdue: true };
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    // Giả sử tổng thời gian là 36 tiếng (từ lúc gửi đến 24h mai)
    const percent = Math.min(100, Math.max(0, Math.round(((36 * 3600 * 1000 - diffMs) / (36 * 3600 * 1000)) * 100)));

    let color = 'emerald';
    if (hours < 3) {
      color = 'rose';
    } else if (hours < 8) {
      color = 'amber';
    }

    return {
      label: `Còn ${hours}h ${minutes}m (Đến 24h00 mai)`,
      color,
      percent,
      isOverdue: false,
    };
  };

  const getOtpStatus = (order) => {
    if (!order || !order.otpCode || !order.otpExpiresAt) {
      return { isGenerated: false, isExpired: false, remainingSeconds: 0 };
    }
    const expiryMs = new Date(order.otpExpiresAt).getTime();
    const diff = Math.floor((expiryMs - nowTime) / 1000);
    if (diff <= 0) {
      return { isGenerated: true, isExpired: true, remainingSeconds: 0 };
    }
    return { isGenerated: true, isExpired: false, remainingSeconds: diff };
  };

  const formatSeconds = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleGenerateOtp = async (order) => {
    if (!order) return;

    // Kiểm tra trạng thái đơn hàng theo đúng nghiệp vụ
    if (order.status === 'PENDING') {
      setOtpToast('Kiện hàng chưa được nhân viên nạp vào tủ! Vui lòng chờ sau khi nạp hàng để nhận mã OTP.');
      setTimeout(() => setOtpToast(null), 4000);
      return;
    }
    if (order.status === 'COMPLETED') {
      setOtpToast('Đơn hàng này đã được nhận thành công trước đó!');
      setTimeout(() => setOtpToast(null), 4000);
      return;
    }
    if (order.status === 'OVERDUE') {
      setOtpToast('Đơn hàng đã quá hạn lưu kho tại tủ. Vui lòng liên hệ quản trị viên để được hỗ trợ!');
      setTimeout(() => setOtpToast(null), 4000);
      return;
    }

    setGeneratingOtpId(order.orderId);
    try {
      let apiOtp = null;
      try {
        const res = await pickupApi.requestOtp(order.orderId, order.customerPhone);
        if (res.data && res.data.data) {
          apiOtp = res.data.data;
        }
      } catch (e) {
        const errMsg = e.response?.data?.message || e.message || '';

        // Chặn nếu là lỗi bảo mật / nghiệp vụ từ backend cho đơn hàng tồn tại
        const isSecurityOrBusinessBlock =
          errMsg.includes('tạm khóa') ||
          errMsg.includes('quá 5 lần') ||
          errMsg.includes('quá hạn') ||
          errMsg.includes('Số điện thoại không khớp') ||
          errMsg.includes('chưa được nhân viên nạp') ||
          errMsg.includes('đã được nhận thành công');

        if (isSecurityOrBusinessBlock) {
          setOtpToast(errMsg);
          setTimeout(() => setOtpToast(null), 4000);
          return;
        }

        // Nếu backend không tìm thấy đơn (đơn hàng demo / offline lưu ở local store) hoặc backend offline:
        // Tiếp tục fallback sang local store để tạo OTP
        console.warn('Backend không tìm thấy đơn hoặc đang offline, tạo mã OTP trên local store:', errMsg);
      }

      const result = store.requestOtpForOrder(order.orderId, apiOtp);
      loadOrders();
      setCopiedOtp(false);
      setOtpToast(`Đã tạo mã OTP nhận hàng mới (Hiệu lực 5 phút: ${result?.otpCode || ''})!`);
      setTimeout(() => setOtpToast(null), 4000);
    } catch (err) {
      console.error('Lỗi tạo OTP:', err);
    } finally {
      setGeneratingOtpId(null);
    }
  };

  const handleCopyOtp = (code) => {
    if (!code) return;
    try {
      navigator.clipboard?.writeText(code);
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
    } catch (e) {}
  };

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

  const selectedOrder = orders.find((o) => o.orderId === selectedOrderId) || filteredOrders[0] || null;

  const getStatusBadge = (status) => {
    switch (status) {
      case 'DEPOSITED':
        return (
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
            Đã về tủ (Sẵn sàng lấy)
          </span>
        );
      case 'PENDING':
        return (
          <span className="bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" /> Chờ shipper nạp
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-slate-500" /> Đã nhận thành công
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-rose-600" /> Quá hạn lưu kho
          </span>
        );
      default:
        return null;
    }
  };

  // Mock trạm cho Leaflet mini-map
  const lockersForMap = [
    {
      lockerId: selectedOrder?.lockerId || 'LOCKER_HN_01',
      name: selectedOrder?.lockerName || 'Tủ KTX A1',
      address: selectedOrder?.lockerAddress || 'KTX A1, Học viện CNBCVT',
      latitude: selectedOrder?.lockerId === 'LOCKER_HN_02' ? 20.980910 : 20.980645,
      longitude: selectedOrder?.lockerId === 'LOCKER_HN_02' ? 105.787450 : 105.787920,
    }
  ];

  return (
    <div className="space-y-5 notranslate select-none">
      {/* Top Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Tổng bưu kiện</span>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{orders.length}</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
          <span className="text-[11px] font-semibold text-emerald-700 uppercase">Sẵn sàng mở tủ</span>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">
            {orders.filter((o) => o.status === 'DEPOSITED').length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs">
          <span className="text-[11px] font-semibold text-amber-700 uppercase">Chờ shipper nạp</span>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">
            {orders.filter((o) => o.status === 'PENDING').length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200/90 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Đã hoàn thành</span>
          <div className="text-2xl font-bold text-slate-700 mt-1 font-mono">
            {orders.filter((o) => o.status === 'COMPLETED').length}
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-3 rounded-xl border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã đơn (ORD-...), tên sản phẩm, trạm tủ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3.5 py-1.5 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          {[
            { id: 'ALL', label: 'Tất cả' },
            { id: 'DEPOSITED', label: 'Hàng đã về tủ' },
            { id: 'PENDING', label: 'Chờ giao' },
            { id: 'COMPLETED', label: 'Đã nhận' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* MASTER-DETAIL WORKSPACE (Two-Pane Architecture) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* PANE 1: MASTER LIST (5 Columns) */}
        <div className="lg:col-span-5 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh sách đơn ({filteredOrders.length})
            </span>
            <span className="text-[11px] text-slate-400">Chọn đơn để thao tác</span>
          </div>

          <div className="space-y-2 max-h-[750px] overflow-y-auto pr-1">
            {filteredOrders.length === 0 ? (
              <div className="bg-white p-8 rounded-xl border border-slate-200 text-center">
                <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Không có đơn hàng nào khớp bộ lọc</p>
              </div>
            ) : (
              filteredOrders.map((ord) => {
                const isSelected = selectedOrder?.orderId === ord.orderId;
                const isDeposited = ord.status === 'DEPOSITED';

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => setSelectedOrderId(ord.orderId)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer bg-white ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-500/10 shadow-xs'
                        : 'border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.2 rounded">
                        {ord.orderId}
                      </span>
                      {getStatusBadge(ord.status)}
                    </div>

                    <h4 className="font-semibold text-slate-900 text-xs truncate">
                      {ord.productName || 'Bưu kiện Smart Locker'}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" /> {ord.lockerName || 'Tủ KTX A1'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {ord.paymentStatus === 'PAID' ? (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-semibold">
                            Đã TT
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-semibold">
                            COD
                          </span>
                        )}
                        <span className="font-mono font-semibold text-slate-800">
                          {new Intl.NumberFormat('vi-VN').format(ord.totalAmount || 0)} đ
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANE 2: DETAIL INSPECTOR & CONTROL STATION (7 Columns) */}
        <div className="lg:col-span-7">
          {selectedOrder ? (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
              {/* Header of Active Order */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                      {selectedOrder.orderId}
                    </span>
                    <span className="text-xs text-slate-400">
                      Ngày tạo: <span className="font-mono text-slate-700">{selectedOrder.orderDate || selectedOrder.expectedDate}</span>
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-1">
                    {selectedOrder.productName || 'Kiện hàng Smart Locker'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    {selectedOrder.paymentStatus === 'PAID' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã thanh toán Online ({selectedOrder.paymentMethod?.replace('ONLINE_', '') || 'VietQR'})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                        <Clock className="w-3 h-3 text-amber-600" />
                        Thanh toán COD khi nhận hàng
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  {getStatusBadge(selectedOrder.status)}
                </div>
              </div>

              {/* Countdown Banner if DEPOSITED */}
              {selectedOrder.status === 'DEPOSITED' && (
                <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-600" />
                      Thời hạn lưu kho:
                    </span>
                    <span className="font-bold text-blue-700 font-mono">
                      {calculateRemainingTime(selectedOrder.expiryDeadline).label}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all"
                      style={{ width: `${calculateRemainingTime(selectedOrder.expiryDeadline).percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Quy chuẩn lưu kho áp dụng đến 24h00 của ngày tiếp theo. Sau thời điểm này mã nhận sẽ bị khóa.
                  </p>
                </div>
              )}

              {/* Action Buttons if Ready to Pickup */}
              {selectedOrder.status === 'DEPOSITED' && (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Phương Thức Mở Tủ Tại Trạm Kiosk
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Method 1: QR 60s */}
                    <button
                      onClick={() => handleOpenQrModal(selectedOrder)}
                      className="p-3.5 rounded-xl border border-blue-200 bg-white hover:bg-blue-50/40 text-left transition cursor-pointer shadow-xs group"
                    >
                      <div className="flex items-center gap-2 text-blue-600 font-semibold text-xs mb-1">
                        <QrCode className="w-4 h-4" />
                        <span>Mã QR Động 60 Giây</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Quét trực tiếp trước camera GM65 của tủ để mở khóa tức thì.
                      </p>
                    </button>

                    {/* Method 2: OTP 5 Phút (Thay thế Mã PIN 6 số) */}
                    {(() => {
                      const otpStatus = getOtpStatus(selectedOrder);
                      return (
                        <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-xs flex flex-col justify-between">
                          {/* Trường hợp 1: Đã tạo OTP và còn trong thời hạn 5 phút */}
                          {otpStatus.isGenerated && !otpStatus.isExpired && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                                <span className="flex items-center gap-1.5 text-slate-800">
                                  <ShieldCheck className="w-4 h-4 text-emerald-600" /> Mã OTP Mở Tủ:
                                </span>
                                <span className={`font-mono text-xs px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                                  otpStatus.remainingSeconds <= 60 
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200 animate-pulse' 
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                }`}>
                                  <Timer className="w-3 h-3" />
                                  {formatSeconds(otpStatus.remainingSeconds)}
                                </span>
                              </div>

                              {/* Dãy số OTP nổi bật */}
                              <div className="flex items-center justify-between bg-slate-50 border border-slate-200/90 rounded-lg p-2 px-3">
                                <div className="font-mono text-base font-extrabold text-blue-700 tracking-widest">
                                  {selectedOrder.otpCode}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleCopyOtp(selectedOrder.otpCode)}
                                    title="Sao chép OTP"
                                    className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 rounded transition cursor-pointer"
                                  >
                                    {copiedOtp ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => handleGenerateOtp(selectedOrder)}
                                    disabled={generatingOtpId === selectedOrder.orderId}
                                    title="Đổi mã mới (5 phút)"
                                    className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-200/70 rounded transition cursor-pointer"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin text-blue-600' : ''}`} />
                                  </button>
                                </div>
                              </div>

                              {/* Thanh tiến trình thời gian 5 phút */}
                              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-1000 ${
                                    otpStatus.remainingSeconds <= 60 ? 'bg-rose-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${(otpStatus.remainingSeconds / 300) * 100}%` }}
                                />
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>Nhập 6 số trên màn hình Kiosk để mở tủ</span>
                                <button
                                  onClick={() => setOtpModalOrder(selectedOrder)}
                                  className="text-blue-600 hover:underline font-semibold cursor-pointer"
                                >
                                  Phóng to
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Trường hợp 2: OTP đã hết hạn sau 5 phút */}
                          {otpStatus.isGenerated && otpStatus.isExpired && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="flex items-center gap-1.5 text-slate-700">
                                  <AlertCircle className="w-4 h-4 text-rose-500" /> Mã OTP Mở Tủ:
                                </span>
                                <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                  Hết hiệu lực (quá 5p)
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-500">
                                Mã OTP trước đó đã hết hiệu lực. Nhấn nút bên dưới để tạo mã OTP mới.
                              </p>

                              <button
                                onClick={() => handleGenerateOtp(selectedOrder)}
                                disabled={generatingOtpId === selectedOrder.orderId}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin' : ''}`} />
                                <span>Tạo Mã OTP Mới (5 phút)</span>
                              </button>
                            </div>
                          )}

                          {/* Trường hợp 3: Chưa tạo OTP */}
                          {!otpStatus.isGenerated && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                                <span className="flex items-center gap-1.5">
                                  <Key className="w-3.5 h-3.5 text-blue-600" /> Mã OTP Mở Tủ:
                                </span>
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                                  Hiệu lực 5 phút
                                </span>
                              </div>

                              <p className="text-[11px] text-slate-500">
                                Nhấn vào mã OTP để hệ thống tạo mã 6 số nhập tại Kiosk. Mã có hiệu lực trong 5 phút.
                              </p>

                              <button
                                onClick={() => handleGenerateOtp(selectedOrder)}
                                disabled={generatingOtpId === selectedOrder.orderId}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                              >
                                <ShieldCheck className={`w-4 h-4 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin' : ''}`} />
                                <span>{generatingOtpId === selectedOrder.orderId ? 'Đang tạo OTP...' : 'Tạo Mã OTP (Hiệu lực 5 phút)'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Locker Location & GIS Mini-Map */}
              <div className="space-y-2.5">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Địa Điểm Nhận Hàng & Bản Đồ Tủ
                </span>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs">
                  <div>
                    <h5 className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      {selectedOrder.lockerName || 'Trạm Tủ KTX A1'}
                    </h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">{selectedOrder.lockerAddress}</p>
                  </div>

                  <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-lg border border-blue-200 text-xs">
                    Ngăn #{selectedOrder.compartmentIndex || 2} (Size {selectedOrder.compartmentSize || 'M'})
                  </span>
                </div>

                {/* Embedded Mini-map */}
                <div className="h-44 rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                  <LockerMap
                    lockers={lockersForMap}
                    selectedLockerId={selectedOrder.lockerId}
                    onSelectLocker={() => {}}
                  />
                </div>
              </div>

              {/* Delivery Timeline / Tracking Steps */}
              <div className="pt-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-3">
                  Tiến Trình Đơn Hàng
                </span>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
                    <span className="font-bold block">1. Đã đặt hàng</span>
                    <span className="text-[10px] text-emerald-600">Đã khóa slot tủ</span>
                  </div>
                  <div className={`p-2.5 rounded-lg border ${
                    selectedOrder.status === 'DEPOSITED' || selectedOrder.status === 'COMPLETED'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    <span className="font-bold block">2. Shipper nạp tủ</span>
                    <span className="text-[10px]">Cảm biến kép kích hoạt</span>
                  </div>
                  <div className={`p-2.5 rounded-lg border ${
                    selectedOrder.status === 'COMPLETED'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    <span className="font-bold block">3. Khách lấy đồ</span>
                    <span className="text-[10px]">Hoàn tất đơn</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200/90 p-12 text-center">
              <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn đơn hàng nào</h4>
              <p className="text-xs text-slate-500 mt-1">Hãy nhấp vào một đơn hàng bên danh sách để xem chi tiết.</p>
            </div>
          )}
        </div>
      </div>

      {/* QR Modal (Rolling 60s) */}
      {qrModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl relative border border-slate-200">
            <button
              onClick={() => setQrModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-2 border border-blue-200">
              <QrCode className="w-5 h-5" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Nhận Hàng</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Đơn: <strong className="text-slate-900">{qrModalOrder.orderId}</strong>
            </p>

            <div className="bg-white p-3 rounded-xl border border-slate-200 inline-block my-3 shadow-xs">
              <QRCodeSVG value={qrToken} size={180} />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between text-xs font-semibold mb-1">
                <span className="flex items-center gap-1 text-slate-600">
                  <Timer className={`w-3.5 h-3.5 ${qrTimeLeft <= 10 ? 'text-rose-600' : 'text-blue-600'}`} />
                  Tự động làm mới sau:
                </span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${
                  qrTimeLeft <= 10 ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'
                }`}>
                  {qrTimeLeft}s
                </span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-1000 ${
                    qrTimeLeft <= 10 ? 'bg-rose-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${(qrTimeLeft / 60) * 100}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-700 text-left space-y-1 mb-4">
              <p><strong>Trạm tủ:</strong> {qrModalOrder.lockerName}</p>
              <p><strong>Ngăn:</strong> Ngăn #{qrModalOrder.compartmentIndex}</p>
              {(() => {
                const modalOtpStatus = getOtpStatus(qrModalOrder);
                if (modalOtpStatus.isGenerated && !modalOtpStatus.isExpired) {
                  return (
                    <div className="pt-1 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-slate-500">Hoặc nhập OTP (còn {formatSeconds(modalOtpStatus.remainingSeconds)}):</span>
                      <span className="font-mono font-bold text-blue-700 tracking-wider text-sm">{qrModalOrder.otpCode}</span>
                    </div>
                  );
                } else {
                  return (
                    <div className="pt-1 border-t border-slate-200 flex items-center justify-between">
                      <span className="text-slate-500">Mã OTP (5 phút):</span>
                      <button
                        onClick={() => handleGenerateOtp(qrModalOrder)}
                        className="text-blue-600 hover:underline font-bold text-xs cursor-pointer"
                      >
                        Tạo mã OTP
                      </button>
                    </div>
                  );
                }
              })()}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => generateDynamicQr(qrModalOrder)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 rounded-lg text-xs transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Đổi mã ngay</span>
              </button>
              <button
                onClick={() => setQrModalOrder(null)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg text-xs transition cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
      {/* OTP Modal (Hiệu lực 5 phút) */}
      {otpModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl relative border border-slate-200">
            <button
              onClick={() => setOtpModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mx-auto mb-2 border border-emerald-200">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã OTP Mở Khóa Tủ</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Đơn: <strong className="text-slate-900">{otpModalOrder.orderId}</strong>
            </p>

            {/* Khối hiển thị OTP */}
            {(() => {
              const modalStatus = getOtpStatus(otpModalOrder);
              return (
                <div className="my-4 space-y-3">
                  {modalStatus.isGenerated && !modalStatus.isExpired ? (
                    <>
                      <div className="bg-slate-50 border-2 border-dashed border-blue-300 rounded-2xl p-4 shadow-inner">
                        <div className="font-mono text-3xl font-black text-blue-700 tracking-[0.25em] pl-2">
                          {otpModalOrder.otpCode}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">Nhập 6 số này vào bàn phím Kiosk</p>
                      </div>

                      {/* Đếm ngược thời gian */}
                      <div>
                        <div className="flex items-center justify-between text-xs font-semibold mb-1">
                          <span className="flex items-center gap-1 text-slate-600">
                            <Timer className={`w-3.5 h-3.5 ${modalStatus.remainingSeconds <= 60 ? 'text-rose-600' : 'text-emerald-600'}`} />
                            Thời hạn hiệu lực:
                          </span>
                          <span className={`font-mono text-xs px-2 py-0.5 rounded font-bold ${
                            modalStatus.remainingSeconds <= 60 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                          }`}>
                            {formatSeconds(modalStatus.remainingSeconds)} / 05:00
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-1000 ${
                              modalStatus.remainingSeconds <= 60 ? 'bg-rose-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${(modalStatus.remainingSeconds / 300) * 100}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700">
                      Mã OTP đã hết hiệu lực sau 5 phút. Vui lòng bấm &quot;Đổi mã ngay&quot; để sinh mã mới!
                    </div>
                  )}

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-700 text-left space-y-1">
                    <p><strong>Trạm tủ:</strong> {otpModalOrder.lockerName}</p>
                    <p><strong>Vị trí:</strong> Ngăn #{otpModalOrder.compartmentIndex} ({otpModalOrder.compartmentSize})</p>
                    <p className="text-[11px] text-slate-500">Mã có hiệu lực 5 phút và chỉ dùng được 01 lần tại tủ.</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleGenerateOtp(otpModalOrder)}
                      disabled={generatingOtpId === otpModalOrder.orderId}
                      className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 rounded-lg text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === otpModalOrder.orderId ? 'animate-spin text-blue-600' : ''}`} />
                      <span>Đổi mã mới</span>
                    </button>
                    <button
                      onClick={() => handleCopyOtp(otpModalOrder.otpCode)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 rounded-lg text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      {copiedOtp ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOtp ? 'Đã sao chép' : 'Sao chép'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => setOtpModalOrder(null)}
              className="w-full mt-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 rounded-lg text-xs transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {otpToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900/95 text-white text-xs px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-2.5 backdrop-blur-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{otpToast}</span>
        </div>
      )}
    </div>
  );
}
