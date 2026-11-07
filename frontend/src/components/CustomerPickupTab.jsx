import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import LockerMap from './LockerMap';
import CircularTimer from './CircularTimer';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { pickupApi } from '../services/api';
import {
  Package, Clock, CheckCircle2, AlertTriangle, QrCode,
  Search, MapPin, X, AlertCircle, Timer,
  RefreshCw, ShieldCheck, Key, ChevronRight, Check,
  Calendar, Layers, ArrowUpRight, Copy, Sparkles,
  Shield, Smartphone, ExternalLink
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
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            Đã về tủ (Sẵn sàng lấy)
          </span>
        );
      case 'PENDING':
        return (
          <span className="bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Chờ shipper nạp
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" /> Đã nhận thành công
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Quá hạn lưu kho
          </span>
        );
      default:
        return null;
    }
  };

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
      {/* Top Stats Banner (Apple Liquid Glass Bento Grid) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span className="uppercase tracking-wider">Tổng bưu kiện</span>
            <div className="w-8 h-8 rounded-2xl bg-blue-500/15 text-blue-600 flex items-center justify-center font-bold">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-mono">{orders.length}</div>
        </div>

        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold">
            <span className="uppercase tracking-wider">Sẵn sàng mở tủ</span>
            <div className="w-8 h-8 rounded-2xl bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-emerald-600 font-mono">
            {orders.filter((o) => o.status === 'DEPOSITED').length}
          </div>
        </div>

        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-amber-700 font-semibold">
            <span className="uppercase tracking-wider">Chờ shipper nạp</span>
            <div className="w-8 h-8 rounded-2xl bg-amber-500/15 text-amber-600 flex items-center justify-center font-bold">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-amber-600 font-mono">
            {orders.filter((o) => o.status === 'PENDING').length}
          </div>
        </div>

        <div className="liquid-glass-card p-5 rounded-3xl border border-white/80 shadow-lg space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span className="uppercase tracking-wider">Đã hoàn thành</span>
            <div className="w-8 h-8 rounded-2xl bg-slate-500/15 text-slate-600 flex items-center justify-center font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-700 font-mono">
            {orders.filter((o) => o.status === 'COMPLETED').length}
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar (Apple Liquid Glass) */}
      <div className="liquid-glass-card p-3.5 rounded-3xl border border-white/80 shadow-md flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo mã đơn (ORD-...), tên sản phẩm, trạm tủ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 liquid-glass-subtle hover:bg-white/70 focus:bg-white/80 border border-white/80 text-slate-900 placeholder:text-slate-400 text-xs rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/15 focus:border-blue-500 transition font-medium"
          />
        </div>

        <div className="ios-segmented-tray flex flex-wrap gap-1 w-full sm:w-auto shadow-2xs">
          {[
            { id: 'ALL', label: 'Tất cả' },
            { id: 'DEPOSITED', label: 'Hàng đã về tủ' },
            { id: 'PENDING', label: 'Chờ giao' },
            { id: 'COMPLETED', label: 'Đã nhận' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-white text-slate-900 shadow-sm border border-black/[0.04]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
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
            <span className="text-[11px] text-slate-400">Chọn đơn để tra cứu</span>
          </div>

          <div className="space-y-3 max-h-[780px] overflow-y-auto pr-1">
            {filteredOrders.length === 0 ? (
              <div className="liquid-glass-card p-10 rounded-3xl border border-white/80 text-center shadow-sm">
                <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-medium">Không có đơn hàng nào khớp bộ lọc</p>
              </div>
            ) : (
              filteredOrders.map((ord) => {
                const isSelected = selectedOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => setSelectedOrderId(ord.orderId)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'liquid-glass-card border-blue-500/90 ring-2 ring-blue-500/30 shadow-xl shadow-blue-500/15 -translate-y-0.5'
                        : 'liquid-glass-subtle border-white/70 hover:border-white/95 hover:bg-white/60 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 rounded-md">
                        {ord.orderId}
                      </span>
                      {getStatusBadge(ord.status)}
                    </div>

                    <h4 className="font-bold text-slate-900 text-xs truncate">
                      {ord.productName || 'Bưu kiện Smart Locker'}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" /> {ord.lockerName || 'Tủ KTX A1'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {ord.paymentStatus === 'PAID' ? (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded font-bold">
                            Đã TT
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded font-bold">
                            COD
                          </span>
                        )}
                        <span className="font-mono font-bold text-slate-800">
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
        <div className="lg:col-span-7 space-y-4">
          {selectedOrder ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md space-y-5">
              {/* Header of Active Order */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                      {selectedOrder.orderId}
                    </span>
                    <span className="text-xs text-slate-400">
                      Ngày tạo: <span className="font-mono text-slate-700 font-semibold">{selectedOrder.orderDate || selectedOrder.expectedDate}</span>
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-1.5">
                    {selectedOrder.productName || 'Kiện hàng Smart Locker'}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5">
                    {selectedOrder.paymentStatus === 'PAID' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Đã thanh toán Online ({selectedOrder.paymentMethod?.replace('ONLINE_', '') || 'VietQR'})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
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
                <div className="p-4 rounded-2xl bg-blue-50/80 border border-blue-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-600" />
                      Thời hạn lưu kho miễn phí:
                    </span>
                    <span className="font-bold text-blue-700 font-mono">
                      {calculateRemainingTime(selectedOrder.expiryDeadline).label}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all"
                      style={{ width: `${calculateRemainingTime(selectedOrder.expiryDeadline).percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Hạn lưu kho: Hết 24h00 hôm sau.
                  </p>
                </div>
              )}

              {/* Action Buttons if Ready to Pickup */}
              {selectedOrder.status === 'DEPOSITED' && (
                <div className="p-5 rounded-3xl liquid-glass-subtle border border-white/80 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider block">
                      Mở Tủ Tại Kiosk
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50/80 px-2.5 py-0.5 rounded-full border border-emerald-200">
                      Solenoid Sẵn Sàng
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Method 1: QR 60s */}
                    <button
                      onClick={() => handleOpenQrModal(selectedOrder)}
                      className="p-4.5 rounded-2xl liquid-glass border border-white/80 hover:bg-white/70 text-left transition cursor-pointer shadow-sm group hover:-translate-y-0.5"
                    >
                      <div className="flex items-center gap-2 text-blue-600 font-bold text-xs mb-1">
                        <QrCode className="w-4 h-4" />
                        <span>Mã QR Động 60s</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Quét tại camera Kiosk để mở tủ.
                      </p>
                    </button>

                    {/* Method 2: OTP 5 Phút */}
                    {(() => {
                      const otpStatus = getOtpStatus(selectedOrder);
                      return (
                        <div className="p-4.5 rounded-2xl liquid-glass border border-white/80 shadow-sm flex flex-col justify-between">
                          {otpStatus.isGenerated && !otpStatus.isExpired && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
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

                              <div className="flex items-center justify-between bg-white/70 border border-white/90 rounded-2xl p-2.5 px-3.5 shadow-inner">
                                <div className="font-mono text-lg font-black text-blue-700 tracking-widest">
                                  {selectedOrder.otpCode}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleCopyOtp(selectedOrder.otpCode)}
                                    title="Sao chép OTP"
                                    className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/80 rounded-lg transition cursor-pointer"
                                  >
                                    {copiedOtp ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => handleGenerateOtp(selectedOrder)}
                                    disabled={generatingOtpId === selectedOrder.orderId}
                                    title="Đổi mã mới (5 phút)"
                                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-white/80 rounded-lg transition cursor-pointer"
                                  >
                                    <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin text-blue-600' : ''}`} />
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-slate-500">
                                <span>Nhập 6 số tại Kiosk</span>
                                <button
                                  onClick={() => setOtpModalOrder(selectedOrder)}
                                  className="text-blue-600 hover:underline font-bold cursor-pointer"
                                >
                                  Phóng to
                                </button>
                              </div>
                            </div>
                          )}

                          {otpStatus.isGenerated && otpStatus.isExpired && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className="flex items-center gap-1.5 text-slate-700">
                                  <AlertCircle className="w-4 h-4 text-rose-500" /> Mã OTP Mở Tủ:
                                </span>
                                <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                                  Hết hạn (quá 5p)
                                </span>
                              </div>
                              <button
                                onClick={() => handleGenerateOtp(selectedOrder)}
                                disabled={generatingOtpId === selectedOrder.orderId}
                                className="ios-btn w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-3 rounded-2xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-blue-500/20"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin' : ''}`} />
                                <span>Tạo Mã OTP Mới (5 phút)</span>
                              </button>
                            </div>
                          )}

                          {!otpStatus.isGenerated && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                                <span className="flex items-center gap-1.5">
                                  <Key className="w-3.5 h-3.5 text-blue-600" /> Mã OTP Mở Tủ:
                                </span>
                                <span className="text-[10px] text-slate-500 bg-white/60 px-2 py-0.5 rounded font-bold border border-white/80">
                                  5 phút
                                </span>
                              </div>
                              <button
                                onClick={() => handleGenerateOtp(selectedOrder)}
                                disabled={generatingOtpId === selectedOrder.orderId}
                                className="ios-btn w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-3 rounded-2xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-blue-500/25"
                              >
                                <ShieldCheck className={`w-4 h-4 ${generatingOtpId === selectedOrder.orderId ? 'animate-spin' : ''}`} />
                                <span>{generatingOtpId === selectedOrder.orderId ? 'Đang tạo OTP...' : 'Tạo Mã OTP (5 phút)'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Interactive Visual Locker Cabinet */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Sơ Đồ Ngăn Tủ & Cảm Biến
                  </span>
                  <span className="text-[11px] font-mono text-blue-600 font-bold bg-blue-50/80 px-2.5 py-0.5 rounded-full border border-blue-200">
                    Vị Trí: Ngăn #{selectedOrder.compartmentIndex || 2} ({selectedOrder.compartmentSize || (selectedOrder.compartmentIndex === 1 ? 'S' : 'L')})
                  </span>
                </div>

                <LockerCabinetVisualizer
                  lockerName={selectedOrder.lockerName || 'Trạm Tủ KTX A1'}
                  lockerId={selectedOrder.lockerId || 'LOCKER_HN_01'}
                  activeSlotId={selectedOrder.compartmentIndex || 2}
                  doorState="CLOSED"
                  sensorWeight={selectedOrder.status === 'DEPOSITED' ? 0.85 : 0.0}
                  compact={true}
                />
              </div>

              {/* Locker Location & GIS Mini-Map */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Vị Trí Trạm Tủ
                </span>

                <div className="p-4 rounded-3xl liquid-glass-subtle border border-white/80 flex items-center justify-between text-xs shadow-sm">
                  <div>
                    <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      {selectedOrder.lockerName || 'Trạm Tủ KTX A1'}
                    </h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">{selectedOrder.lockerAddress}</p>
                  </div>

                  <span className="bg-blue-50/90 text-blue-700 font-bold px-3 py-1 rounded-xl border border-blue-200 text-xs">
                    Ngăn #{selectedOrder.compartmentIndex || 2} (Size {selectedOrder.compartmentSize || (selectedOrder.compartmentIndex === 1 ? 'S' : 'L')})
                  </span>
                </div>

                <div className="h-44 rounded-3xl overflow-hidden border border-white/80 shadow-md">
                  <LockerMap
                    lockers={lockersForMap}
                    selectedLockerId={selectedOrder.lockerId}
                    onSelectLocker={() => {}}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-12 text-center">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn đơn hàng nào</h4>
              <p className="text-xs text-slate-500 mt-1">Hãy nhấp vào một đơn hàng bên danh sách để xem chi tiết.</p>
            </div>
          )}
        </div>
      </div>

      {/* QR Modal (Rolling 60s) với CircularTimer */}
      {qrModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setQrModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-blue-200 shadow-2xs">
              <QrCode className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Nhận Hàng Kiosk</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Mã vận đơn: <strong className="text-slate-900">{qrModalOrder.orderId}</strong>
            </p>

            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 inline-block my-3 shadow-md">
              <QRCodeSVG value={qrToken} size={180} />
            </div>

            {/* Circular Timer for QR 60s */}
            <div className="flex flex-col items-center justify-center my-2">
              <CircularTimer
                secondsLeft={qrTimeLeft}
                totalSeconds={60}
                size={70}
                strokeWidth={5}
                label="Mã Động"
              />
            </div>

            <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 text-xs text-slate-700 text-left space-y-1 mb-4">
              <p><strong>Trạm tủ:</strong> {qrModalOrder.lockerName}</p>
              <p><strong>Vị trí:</strong> Ngăn #{qrModalOrder.compartmentIndex}</p>
              <p className="text-[11px] text-slate-500">Đưa mã QR này vào trước camera GM65 của tủ để mở chốt.</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => generateDynamicQr(qrModalOrder)}
                className="ios-btn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Đổi mã ngay</span>
              </button>
              <button
                onClick={() => setQrModalOrder(null)}
                className="ios-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer shadow-sm shadow-blue-500/20"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Modal (Hiệu lực 5 phút) với CircularTimer */}
      {otpModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setOtpModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-emerald-200 shadow-2xs">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã OTP Mở Khóa Tủ</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Đơn: <strong className="text-slate-900">{otpModalOrder.orderId}</strong>
            </p>

            {(() => {
              const modalStatus = getOtpStatus(otpModalOrder);
              return (
                <div className="my-4 space-y-3.5">
                  {modalStatus.isGenerated && !modalStatus.isExpired ? (
                    <>
                      <div className="bg-slate-50/80 border-2 border-dashed border-blue-300 rounded-2xl p-4 shadow-inner">
                        <div className="font-mono text-3xl font-black text-blue-700 tracking-[0.25em] pl-2">
                          {otpModalOrder.otpCode}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 font-medium">Nhập 6 số này vào màn hình cảm ứng Kiosk</p>
                      </div>

                      {/* Circular Timer for OTP 5m */}
                      <div className="flex justify-center my-1">
                        <CircularTimer
                          secondsLeft={modalStatus.remainingSeconds}
                          totalSeconds={300}
                          size={70}
                          strokeWidth={5}
                          format="mm:ss"
                          label="Hiệu Lực"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700 font-bold">
                      Mã OTP đã hết hạn. Vui lòng bấm &quot;Đổi mã mới&quot;.
                    </div>
                  )}

                  <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 text-xs text-slate-700 text-left space-y-1">
                    <p><strong>Trạm tủ:</strong> {otpModalOrder.lockerName}</p>
                    <p><strong>Vị trí:</strong> Ngăn #{otpModalOrder.compartmentIndex} ({otpModalOrder.compartmentSize})</p>
                    <p className="text-[10px] text-slate-500">Bảo vệ chống dò mã: Khóa 2 phút nếu sai quá 5 lần.</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleGenerateOtp(otpModalOrder)}
                      disabled={generatingOtpId === otpModalOrder.orderId}
                      className="ios-btn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === otpModalOrder.orderId ? 'animate-spin text-blue-600' : ''}`} />
                      <span>Đổi mã mới</span>
                    </button>
                    <button
                      onClick={() => handleCopyOtp(otpModalOrder.otpCode)}
                      className="ios-btn flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer shadow-sm shadow-emerald-500/20"
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
              className="ios-btn w-full mt-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {otpToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900/95 text-white text-xs px-4 py-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{otpToast}</span>
        </div>
      )}
    </div>
  );
}
