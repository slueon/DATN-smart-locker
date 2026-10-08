import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import LockerMap from './LockerMap';
import { lockerApi, orderApi } from '../services/api';
import { store } from '../services/store';
import { resolveProductImage } from '../utils/productImages';
import mbQrImage from '../assets/mb_qr_payment.png';
import {
  ShoppingCart, MapPin, Calendar, CheckCircle2,
  AlertTriangle, ArrowRight, ShieldCheck, Box, X,
  Trash2, Plus, Minus, ArrowLeft, PackageCheck, Check,
  CreditCard, QrCode, Copy, ExternalLink, Clock,
  RefreshCw, Sparkles, Building2, Smartphone, Shield,
  BadgeCheck, Info, CheckCheck, Loader2, Truck
} from 'lucide-react';

const INITIAL_LOCKERS = [
  {
    lockerId: 'LOCKER_HN_01',
    name: 'Tủ Giao Nhận KTX A1',
    address: 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội',
    latitude: 20.980645,
    longitude: 105.787920,
    connectionStatus: 'ONLINE',
    totalCompartments: 3
  },
  {
    lockerId: 'LOCKER_HN_02',
    name: 'Tủ Giao Nhận Thư Viện',
    address: 'Sảnh tầng 1, Nhà Thư Viện, Học viện CNBCVT, Hà Đông, Hà Nội',
    latitude: 20.980910,
    longitude: 105.787450,
    connectionStatus: 'ONLINE',
    totalCompartments: 3
  }
];

export default function CartCheckoutTab({ currentUser, onNavigateToOrders, onNavigateToStore }) {
  const [cart, setCart] = useState(() => store.getCart());
  const [lockers, setLockers] = useState(INITIAL_LOCKERS);
  const [loading, setLoading] = useState(false);

  // Form checkout
  const [customerName, setCustomerName] = useState(currentUser?.fullName || 'Đoàn Viết Hoàng');
  const [customerPhone, setCustomerPhone] = useState(currentUser?.phone || '0988123456');

  useEffect(() => {
    if (currentUser) {
      setCustomerName(currentUser.fullName || '');
      setCustomerPhone(currentUser.phone || '');
    }
  }, [currentUser]);

  // Lắng nghe thay đổi giỏ hàng từ store
  useEffect(() => {
    const handleCartUpdate = () => setCart(store.getCart());
    window.addEventListener('smart_locker_cart_updated', handleCartUpdate);
    return () => window.removeEventListener('smart_locker_cart_updated', handleCartUpdate);
  }, []);

  const [deliveryType, setDeliveryType] = useState('LOCKER'); // 'LOCKER' | 'STANDARD'
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  // Capacity & Degradation State
  const [capacityInfo, setCapacityInfo] = useState({
    available: true,
    remainingSlots: 3,
    totalSlots: 3,
    alternativeAvailableDates: []
  });
  const [showDegradationModal, setShowDegradationModal] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  // Payment States (VietQR MB Bank vs COD)
  const [paymentMethod, setPaymentMethod] = useState('ONLINE'); // 'ONLINE' (VietQR MB Bank) | 'COD'
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentStep, setPaymentStep] = useState('PENDING'); // 'PENDING' | 'VERIFYING' | 'SUCCESS'
  const [paymentSecondsLeft, setPaymentSecondsLeft] = useState(600); // 10 phút đếm ngược
  const [copiedKey, setCopiedKey] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);

  // Lựa chọn Tủ thông minh chỉ hỗ trợ chuyển khoản VietQR
  useEffect(() => {
    if (deliveryType === 'LOCKER' && paymentMethod !== 'ONLINE') {
      setPaymentMethod('ONLINE');
    }
  }, [deliveryType, paymentMethod]);

  useEffect(() => {
    fetchLockers();
  }, []);

  const fetchLockers = async () => {
    try {
      const res = await lockerApi.getAll();
      if (res.data?.data && res.data.data.length > 0) {
        setLockers(res.data.data);
      }
    } catch (err) {
      console.warn('Backend chưa sẵn sàng, dùng danh sách tủ mẫu.');
    }
  };

  useEffect(() => {
    if (deliveryType === 'LOCKER' && selectedLockerId && selectedDate) {
      checkLockerCapacity(selectedLockerId, selectedDate);
    }
  }, [selectedLockerId, selectedDate, deliveryType]);

  const checkLockerCapacity = async (lockerId, date) => {
    try {
      const res = await lockerApi.checkCapacity(lockerId, date);
      if (res.data?.data) {
        const info = res.data.data;
        setCapacityInfo(info);
        if (!info.available) {
          setShowDegradationModal(true);
        }
      }
    } catch (err) {
      setCapacityInfo({
        available: true,
        remainingSlots: 3,
        totalSlots: 3,
        alternativeAvailableDates: []
      });
    }
  };

  // Countdown timer cho thanh toán Online
  useEffect(() => {
    if (!showPaymentModal || paymentStep !== 'PENDING') return;
    const interval = setInterval(() => {
      setPaymentSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [showPaymentModal, paymentStep]);

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopy = (text, key) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const calculateTotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const handleUpdateQty = (productId, delta) => {
    store.updateCartQuantity(productId, delta);
  };

  const handleRemoveItem = (productId) => {
    store.removeFromCart(productId);
  };

  const handleCheckout = (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      alert('Giỏ hàng trống!');
      return;
    }

    const selectedLockerObj = lockers.find((l) => l.lockerId === selectedLockerId) || lockers[0];
    const generatedOrderId = 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const orderBlueprint = {
      orderId: generatedOrderId,
      customerName,
      customerPhone,
      productName: cart.map((c) => c.name).join(', '),
      deliveryType,
      lockerId: deliveryType === 'LOCKER' ? selectedLockerId : null,
      lockerName: selectedLockerObj ? selectedLockerObj.name : 'Tủ Giao Nhận KTX A1',
      lockerAddress: selectedLockerObj ? selectedLockerObj.address : 'Sảnh tầng 1, KTX A1, Học viện CNBCVT',
      compartmentIndex: 2,
      compartmentSize: 'M',
      orderDate: new Date().toISOString().split('T')[0],
      expectedDate: selectedDate,
      status: 'PENDING',
      totalAmount: calculateTotal(),
      qrToken: 'PKUP-' + Date.now(),
      otpCode: Math.floor(100000 + Math.random() * 900000).toString(),
      paymentMethod: paymentMethod === 'ONLINE' ? 'ONLINE_VIETQR' : 'COD',
      paymentStatus: paymentMethod === 'ONLINE' ? 'PENDING' : 'UNPAID',
    };

    if (paymentMethod === 'ONLINE') {
      setPendingOrder(orderBlueprint);
      setPaymentStep('PENDING');
      setPaymentSecondsLeft(600);
      setShowPaymentModal(true);
    } else {
      finalizeOrder(orderBlueprint, 'COD', 'UNPAID');
    }
  };

  const finalizeOrder = async (orderData, method, status) => {
    setLoading(true);
    try {
      const payload = {
        customerName: orderData.customerName,
        customerPhone: orderData.customerPhone,
        deliveryType: orderData.deliveryType,
        lockerId: orderData.lockerId,
        deliveryDate: orderData.expectedDate,
        paymentMethod: method,
        paymentStatus: status,
        items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity })),
      };

      const res = await orderApi.checkout(payload);
      if (res.data?.success && res.data.data) {
        const backendOrder = {
          ...res.data.data,
          paymentMethod: method,
          paymentStatus: status,
          paidAt: status === 'PAID' ? new Date().toISOString() : null,
        };
        store.createOrder(backendOrder);
        store.clearCart();
        setOrderResult(backendOrder);
        setLoading(false);
        return;
      }
    } catch (err) {
      console.warn('Backend offline, lưu vào local store.', err);
    }

    const finalOrder = {
      ...orderData,
      paymentMethod: method,
      paymentStatus: status,
      paidAt: status === 'PAID' ? new Date().toISOString() : null,
    };

    store.createOrder(finalOrder);
    store.clearCart();
    setOrderResult(finalOrder);
    setLoading(false);
  };

  const handleSimulatePaymentSuccess = () => {
    setPaymentStep('VERIFYING');
    setTimeout(() => {
      setPaymentStep('SUCCESS');
      setTimeout(() => {
        setShowPaymentModal(false);
        finalizeOrder(pendingOrder, 'ONLINE_VIETQR', 'PAID');
      }, 700);
    }, 900);
  };

  const selectedLocker = lockers.find((l) => l.lockerId === selectedLockerId) || lockers[0];
  const activeAmount = pendingOrder ? pendingOrder.totalAmount : calculateTotal();
  const activeOrderId = pendingOrder ? pendingOrder.orderId : 'ORD-SAMPLE';
  const transferMemo = `PTIT ${activeOrderId}`;
  const vietQrUrl = `https://img.vietqr.io/image/MB-0332318141-compact2.png?amount=${activeAmount}&addInfo=${encodeURIComponent(transferMemo)}&accountName=DOAN%20VIET%20HOANG`;

  return (
    <div className="space-y-6 notranslate">
      {/* Header & Back Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Giỏ Hàng & Đặt Chỗ Tủ
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Xác nhận số lượng, thanh toán trực tuyến và kiểm tra sức chứa trạm tủ thời gian thực.
          </p>
        </div>
        <button
          onClick={onNavigateToStore}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Tiếp tục mua hàng</span>
        </button>
      </div>

      {cart.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 p-10 text-center max-w-md mx-auto shadow-xs">
          <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
            <ShoppingCart className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Giỏ hàng của bạn đang trống</h3>
          <p className="text-xs text-slate-500 mt-1 mb-5">
            Hãy chọn một số mặt hàng từ cửa hàng để trải nghiệm quy trình giao nhận tự động.
          </p>
          <button
            onClick={onNavigateToStore}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition cursor-pointer inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Khám phá sản phẩm</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* CỘT TRÁI: DANH SÁCH SẢN PHẨM (5 cột) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <ShoppingCart className="w-4 h-4 text-blue-600" />
                  Sản phẩm trong giỏ ({cart.length})
                </h2>
                <button
                  onClick={onNavigateToStore}
                  className="text-xs text-blue-600 hover:underline font-medium cursor-pointer"
                >
                  + Mua thêm
                </button>
              </div>

              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div key={item.productId} className="py-3 first:pt-0 flex items-center justify-between gap-3 text-xs">
                    <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden shrink-0 border border-slate-200/60">
                      <img
                        src={resolveProductImage(item)}
                        alt={item.name}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = resolveProductImage({ ...item, imageUrl: '' });
                        }}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-slate-900 truncate text-xs">{item.name}</h4>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                        <span className="text-blue-600 font-bold font-mono">
                          {new Intl.NumberFormat('vi-VN').format(item.price)} đ
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                          Ngăn {item.requiredSize}
                        </span>
                      </div>
                    </div>

                    {/* Stepper +/- */}
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-lg shrink-0">
                      <button
                        onClick={() => handleUpdateQty(item.productId, -1)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-600 transition"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-4 text-center font-bold text-slate-900 text-xs font-mono">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleUpdateQty(item.productId, 1)}
                        className="p-1 hover:bg-slate-200 rounded text-slate-600 transition"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      onClick={() => handleRemoveItem(item.productId)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                      title="Xóa khỏi giỏ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Chi tiết chi phí */}
              <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Tiền hàng:</span>
                  <span className="font-mono font-medium text-slate-900">
                    {new Intl.NumberFormat('vi-VN').format(calculateTotal())} đ
                  </span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Phí giữ chỗ Tủ thông minh PTIT:</span>
                  <span className="font-semibold">Miễn phí (Ưu đãi)</span>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-sm font-semibold">
                  <span className="text-slate-800">Tổng thanh toán:</span>
                  <span className="text-lg font-bold text-blue-600 font-mono">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(calculateTotal())}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: FORM CHỌN TỦ, PHƯƠNG THỨC THANH TOÁN & BẢN ĐỒ (7 cột) */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 pb-3 border-b border-slate-100">
                <PackageCheck className="w-4 h-4 text-blue-600" />
                Thông Tin Nhận Hàng & Thanh Toán
              </h2>

              <form onSubmit={handleCheckout} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Tên người nhận</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full text-xs px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {deliveryType === 'LOCKER' ? 'Số điện thoại nhận mã OTP' : 'Số điện thoại nhận hàng'}
                    </label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full text-xs px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition font-mono"
                    />
                  </div>
                </div>

                {/* Delivery Type Switcher */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Phương thức nhận hàng
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryType('LOCKER');
                        setPaymentMethod('ONLINE');
                      }}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        deliveryType === 'LOCKER'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs ring-1 ring-blue-600'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>📦 Tủ thông minh (Khuyên dùng)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryType('STANDARD')}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        deliveryType === 'STANDARD'
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-xs ring-1 ring-blue-600'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>🏠 Giao tận nhà</span>
                    </button>
                  </div>
                </div>

                {/* Hướng dẫn khi chọn Giao tận nhà */}
                {deliveryType === 'STANDARD' && (
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs flex items-start gap-2.5">
                    <Truck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-900">Giao hàng tận nơi</span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Shipper sẽ liên hệ trực tiếp số điện thoại <strong className="text-slate-700 font-mono">{customerPhone || 'của bạn'}</strong> để giao bưu kiện tận tay.
                      </p>
                    </div>
                  </div>
                )}

                {/* Locker Selection & GIS Map */}
                {deliveryType === 'LOCKER' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-600" /> Vị trí trạm tủ trên bản đồ
                      </label>
                      <span className="text-[11px] text-blue-700 font-medium bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                        {lockers.length} Trạm đang hoạt động
                      </span>
                    </div>

                    <div className="h-56 w-full rounded-xl overflow-hidden border border-slate-200">
                      <LockerMap
                        lockers={lockers}
                        selectedLockerId={selectedLockerId}
                        onSelectLocker={setSelectedLockerId}
                      />
                    </div>

                    {selectedLocker && (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                            {selectedLocker.name}
                          </span>
                          <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2 py-0.5 rounded-md font-semibold border border-emerald-200">
                            {selectedLocker.connectionStatus}
                          </span>
                        </div>
                        <p className="text-slate-500 text-[11px]">{selectedLocker.address}</p>
                      </div>
                    )}

                    {/* Date Picker & Capacity Info */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-blue-600" /> Ngày nhận hàng mong muốn
                      </label>
                      <input
                        type="date"
                        required
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full text-xs px-3 py-2 bg-white border border-slate-200 text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
                      />

                      {capacityInfo && (
                        <div className="mt-2 text-xs flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
                          <span className="text-slate-500">Tình trạng ngăn tủ ngày này:</span>
                          {capacityInfo.available ? (
                            <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-semibold flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              Còn {capacityInfo.remainingSlots} / {capacityInfo.totalSlots} ngăn trống
                            </span>
                          ) : (
                            <span className="text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md font-semibold">
                              Đã hết chỗ trống
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PHƯƠNG THỨC THANH TOÁN (VIETQR MB BANK VS COD) */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                      Phương thức thanh toán
                    </label>
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                      <Shield className="w-3 h-3 text-emerald-600" />
                      Giao dịch bảo mật 100%
                    </span>
                  </div>

                  {deliveryType === 'LOCKER' ? (
                    /* LỰA CHỌN TỦ THÔNG MINH: CHỈ CÓ PHƯƠNG THỨC CHUYỂN KHOẢN VIETQR */
                    <div
                      onClick={() => setPaymentMethod('ONLINE')}
                      className="p-3.5 rounded-xl border border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/10 shadow-xs text-xs cursor-pointer transition relative flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-full border flex items-center justify-center border-blue-600 bg-white">
                              <div className="w-2 h-2 rounded-full bg-blue-600" />
                            </div>
                            <span className="font-bold text-slate-900">Chuyển khoản VietQR</span>
                          </div>
                          <span className="text-[10px] bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded">
                            Duy nhất cho Tủ thông minh
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Quét mã QR chuyển khoản tức thì qua App Ngân hàng MB Bank hoặc bất kỳ app Napas 247 nào để hệ thống kích hoạt mã OTP mở tủ tự động.
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-200/60">
                        <span className="text-[10px] font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                          MB Bank • 0332318141
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium">DOAN VIET HOANG</span>
                      </div>
                    </div>
                  ) : (
                    /* LỰA CHỌN GIAO TẬN NHÀ: CÓ CẢ VIETQR VÀ THANH TOÁN KHI NHẬN (COD) */
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Option 1: Chuyển khoản VietQR */}
                      <div
                        onClick={() => setPaymentMethod('ONLINE')}
                        className={`p-3.5 rounded-xl border text-xs cursor-pointer transition relative flex flex-col justify-between ${
                          paymentMethod === 'ONLINE'
                            ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/10 shadow-xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border flex items-center justify-center border-blue-600 bg-white">
                                {paymentMethod === 'ONLINE' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                              </div>
                              <span className="font-bold text-slate-900">Chuyển khoản VietQR</span>
                            </div>
                            <span className="text-[10px] bg-blue-100 text-blue-700 font-semibold px-1.5 py-0.2 rounded">
                              Khuyên dùng
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Quét mã QR thanh toán trước tức thì qua App Ngân hàng MB Bank hoặc bất kỳ app Napas 247 nào.
                          </p>
                        </div>
                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-200/60">
                          <span className="text-[10px] font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                            MB Bank • 0332318141
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium">DOAN VIET HOANG</span>
                        </div>
                      </div>

                      {/* Option 2: Thanh toán khi nhận (COD cho shipper) */}
                      <div
                        onClick={() => setPaymentMethod('COD')}
                        className={`p-3.5 rounded-xl border text-xs cursor-pointer transition relative flex flex-col justify-between ${
                          paymentMethod === 'COD'
                            ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/10 shadow-xs'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border flex items-center justify-center border-slate-300 bg-white">
                                {paymentMethod === 'COD' && <div className="w-2 h-2 rounded-full bg-blue-600" />}
                              </div>
                              <span className="font-bold text-slate-900">Thanh toán khi nhận</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Thanh toán trực tiếp bằng tiền mặt hoặc chuyển khoản cho shipper khi nhận hàng tại địa chỉ của bạn.
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-slate-200/60 text-[10px] text-slate-500 font-medium">
                          <Truck className="w-3.5 h-3.5 text-blue-600" />
                          <span>Thanh toán trực tiếp cho shipper khi giao tới</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || (deliveryType === 'LOCKER' && capacityInfo && !capacityInfo.available)}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer mt-3"
                >
                  {loading ? (
                    <span>Đang xử lý thông tin...</span>
                  ) : paymentMethod === 'ONLINE' ? (
                    <>
                      <QrCode className="w-4 h-4" />
                      <span>Quét mã VietQR MB Bank ({new Intl.NumberFormat('vi-VN').format(calculateTotal())} đ)</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight className="w-4 h-4" />
                      <span>Xác nhận Đặt hàng (Thanh toán khi nhận)</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL THANH TOÁN VIETQR MB BANK */}
      {showPaymentModal && pendingOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-200 relative animate-in zoom-in-95 duration-150">
            {/* Nút đóng */}
            <button
              onClick={() => setShowPaymentModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 pr-8">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200 shrink-0">
                  <QrCode className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Chuyển Khoản VietQR (MB Bank)
                  </h3>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Đơn hàng #{pendingOrder.orderId}
                  </span>
                </div>
              </div>

              {/* Countdown Badge */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-xs font-mono font-bold">
                <Clock className="w-3.5 h-3.5" />
                <span>{formatCountdown(paymentSecondsLeft)}</span>
              </div>
            </div>

            {/* Modal Body */}
            {paymentStep === 'VERIFYING' ? (
              <div className="py-12 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-200 animate-pulse">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Đang đối soát giao dịch...</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Hệ thống đang kết nối Webhook ngân hàng để xác nhận biến động số dư.
                  </p>
                </div>
              </div>
            ) : paymentStep === 'SUCCESS' ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h4 className="text-base font-bold text-emerald-600">Thanh toán thành công!</h4>
                <p className="text-xs text-slate-500">Đang khởi tạo đơn hàng và kích hoạt giữ chỗ tủ...</p>
              </div>
            ) : (
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                  {/* QR Code Container (5 cols) */}
                  <div className="sm:col-span-5 flex flex-col items-center justify-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="w-48 bg-white p-2 rounded-xl border border-slate-200 shadow-xs flex flex-col items-center justify-center overflow-hidden">
                      <img
                        src={mbQrImage}
                        alt="VietQR MB Bank - DOAN VIET HOANG - 0332318141"
                        className="w-full h-auto object-contain rounded-lg shadow-2xs"
                      />
                    </div>
                    <span className="text-[10px] text-slate-500 mt-2 text-center font-medium">
                      Quét bằng App MB Bank hoặc ứng dụng Ngân hàng bất kỳ
                    </span>
                  </div>

                  {/* Thông tin chuyển khoản đối soát (7 cols) */}
                  <div className="sm:col-span-7 space-y-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-[11px]">Ngân hàng thụ hưởng:</span>
                        <strong className="text-slate-800 font-semibold">MB Bank (Quân Đội)</strong>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-[11px]">Số tài khoản:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                            0332318141
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy('0332318141', 'acc')}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                            title="Sao chép số tài khoản"
                          >
                            {copiedKey === 'acc' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 text-[11px]">Tên chủ tài khoản:</span>
                        <span className="font-semibold text-slate-900 uppercase text-xs">DOAN VIET HOANG</span>
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-slate-200/60">
                        <span className="text-slate-400 text-[11px]">Số tiền thanh toán:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-600 text-sm">
                            {new Intl.NumberFormat('vi-VN').format(pendingOrder.totalAmount)} đ
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(pendingOrder.totalAmount.toString(), 'amount')}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                            title="Sao chép số tiền"
                          >
                            {copiedKey === 'amount' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-slate-200/60">
                        <span className="text-slate-400 text-[11px]">Nội dung chuyển:</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            {transferMemo}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(transferMemo, 'memo')}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded cursor-pointer"
                            title="Sao chép nội dung"
                          >
                            {copiedKey === 'memo' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-1.5 text-[10px] text-slate-500 bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                      <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      <span>
                        Vui lòng chuyển đúng số tài khoản <strong>0332318141</strong> và giữ nguyên nội dung <strong>{transferMemo}</strong> để hệ thống tự động gạch nợ và giữ tủ ngay lập tức.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Trạng thái lắng nghe & Nút mô phỏng IPN Webhook */}
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
                      <span>Đang chờ tín hiệu biến động số dư từ ngân hàng...</span>
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSimulatePaymentSuccess}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>⚡ Mô Phỏng Đã Chuyển Khoản (Webhook IPN)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPaymentModal(false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-3 rounded-xl text-xs transition cursor-pointer"
                    >
                      Hủy bỏ
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Degradation Modal */}
      {showDegradationModal && capacityInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center gap-2.5 text-amber-600 mb-3">
              <div className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">Tủ đã hết ngăn trống vào ngày này</h3>
                <p className="text-xs text-slate-500">Gợi ý chuyển đổi dịch vụ linh hoạt</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Trạm <strong className="text-slate-900">{selectedLocker?.name}</strong> vào ngày{' '}
              <strong className="text-blue-600">{selectedDate}</strong> đã đầy công suất. Hãy chọn một trong hai phương án sau:
            </p>

            <div className="space-y-2.5 mb-5">
              <div 
                onClick={() => {
                  setDeliveryType('STANDARD');
                  setShowDegradationModal(false);
                }}
                className="border border-slate-200 hover:border-blue-600 bg-slate-50 hover:bg-blue-50/50 p-3.5 rounded-xl cursor-pointer transition flex items-start gap-3"
              >
                <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  1
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-900">Chuyển sang giao tận nơi</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Shipper sẽ liên hệ trực tiếp số điện thoại để trao tận tay bạn.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 p-3.5 rounded-xl bg-slate-50 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    2
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-900">Dời sang ngày tiếp theo còn trống</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Chọn ngày còn chỗ để tiếp tục nhận tại Tủ thông minh:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 pl-9">
                  {capacityInfo.alternativeAvailableDates && capacityInfo.alternativeAvailableDates.length > 0 ? (
                    capacityInfo.alternativeAvailableDates.map((altDate) => (
                      <button
                        key={altDate}
                        onClick={() => {
                          setSelectedDate(altDate);
                          setShowDegradationModal(false);
                        }}
                        className="bg-white border border-slate-200 text-slate-700 hover:border-blue-600 hover:text-blue-600 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer"
                      >
                        {altDate}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400 italic">Không còn ngày trống trong 7 ngày tới</span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowDegradationModal(false)}
              className="w-full text-xs font-medium py-2 text-slate-500 hover:text-slate-800 transition cursor-pointer"
            >
              Đóng và tự chọn ngày khác
            </button>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {orderResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 sm:p-7 shadow-xl border border-slate-200 text-center relative">
            <button
              onClick={() => setOrderResult(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 border border-emerald-200">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">Đặt hàng thành công!</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              Mã đơn: <strong className="text-slate-900">{orderResult.orderId}</strong>
            </p>

            {/* Trạng thái thanh toán trong Success Modal */}
            <div className="mt-3">
              {orderResult.paymentStatus === 'PAID' ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Đã thanh toán trực tuyến ({orderResult.paymentMethod?.replace('ONLINE_', '') || 'Online'})</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                  <Truck className="w-4 h-4 text-amber-600" />
                  <span>Thanh toán COD cho shipper khi nhận hàng</span>
                </div>
              )}
            </div>

            {orderResult.deliveryType === 'LOCKER' ? (
              <div className="mt-4 bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-left space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Trạm tủ nhận hàng:</span>
                    <strong className="text-slate-900">{orderResult.lockerName}</strong>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 text-[10px] block">Ngăn tủ:</span>
                    <span className="bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded text-xs border border-blue-200">
                      Ngăn #{orderResult.compartmentIndex}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-0.5">
                  <p><span className="text-slate-400">Ngày giao dự kiến:</span> <span className="font-mono text-slate-800">{orderResult.expectedDate}</span></p>
                  <p className="text-[11px] text-slate-500 pt-1">
                    Khi shipper nạp hàng, bạn sẽ nhận được mã OTP & mã QR để mở tủ tại tab "Bưu kiện của tôi".
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-3 p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-200">
                Đơn hàng sẽ được chuyển phát tới số điện thoại: <strong className="text-slate-900 font-mono">{orderResult.customerPhone}</strong>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => {
                  setOrderResult(null);
                  if (onNavigateToOrders) onNavigateToOrders();
                }}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition cursor-pointer"
              >
                Xem bưu kiện của tôi
              </button>
              <button
                onClick={() => {
                  setOrderResult(null);
                  if (onNavigateToStore) onNavigateToStore();
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-3 rounded-xl text-xs transition cursor-pointer"
              >
                Tiếp tục mua sắm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
