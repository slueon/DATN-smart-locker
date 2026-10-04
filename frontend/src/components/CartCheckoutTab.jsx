import React, { useState, useEffect } from 'react';
import LockerMap from './LockerMap';
import { QRCodeSVG } from 'qrcode.react';
import { lockerApi, orderApi } from '../services/api';
import { store } from '../services/store';
import {
  ShoppingCart, MapPin, Calendar, CheckCircle2,
  AlertTriangle, ArrowRight, ShieldCheck, Box, X,
  Trash2, Plus, Minus, ArrowLeft, PackageCheck
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

  const [deliveryType, setDeliveryType] = useState('LOCKER'); // 'LOCKER' hoặc 'STANDARD'
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  // Graceful Degradation State
  const [capacityInfo, setCapacityInfo] = useState({
    available: true,
    remainingSlots: 3,
    totalSlots: 3,
    alternativeAvailableDates: []
  });
  const [showDegradationModal, setShowDegradationModal] = useState(false);

  // Success Modal
  const [orderResult, setOrderResult] = useState(null);

  // Tải danh sách tủ thật từ backend (nếu có)
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

  // Kiểm tra sức chứa khi đổi ngày hoặc đổi tủ
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

  const calculateTotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const handleUpdateQty = (productId, delta) => {
    store.updateCartQuantity(productId, delta);
  };

  const handleRemoveItem = (productId) => {
    store.removeFromCart(productId);
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      alert('Giỏ hàng trống!');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        customerName,
        customerPhone,
        deliveryType,
        lockerId: deliveryType === 'LOCKER' ? selectedLockerId : null,
        deliveryDate: selectedDate,
        items: cart.map((c) => ({ productId: c.productId, quantity: c.quantity })),
      };

      const res = await orderApi.checkout(payload);
      let createdOrder = null;
      if (res.data?.success) {
        createdOrder = res.data.data;
      }
      if (createdOrder) {
        store.createOrder(createdOrder);
        store.clearCart();
        setOrderResult(createdOrder);
        return;
      }
    } catch (err) {
      console.warn('Backend offline, tạo đơn hàng demo trong store.');
    }

    // Fallback demo order lưu vào store
    const selectedLockerObj = lockers.find((l) => l.lockerId === selectedLockerId) || lockers[0];
    const mockOrder = {
      orderId: 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      customerName,
      customerPhone,
      productName: cart.map((c) => c.name).join(', '),
      deliveryType,
      lockerId: selectedLockerId,
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
    };

    store.createOrder(mockOrder);
    store.clearCart();
    setOrderResult(mockOrder);
    setLoading(false);
  };

  const selectedLocker = lockers.find((l) => l.lockerId === selectedLockerId) || lockers[0];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 notranslate">
      {/* Tiêu đề */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight sm:text-4xl">
          Giỏ Hàng & Đặt Chỗ Nhận Hàng Tại Tủ Thông Minh
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl mx-auto text-sm">
          Kiểm tra các sản phẩm trong giỏ, chọn điểm Tủ giao nhận trên bản đồ số và chọn ngày nhận hàng mong muốn.
        </p>
      </div>

      {cart.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-sm">
          <ShoppingCart className="w-16 h-16 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-800">Giỏ hàng của bạn đang trống!</h3>
          <p className="text-xs text-slate-500 mt-1 mb-6">
            Hãy khám phá các sản phẩm công nghệ tuyệt vời và thêm vào giỏ hàng ngay.
          </p>
          <button
            onClick={onNavigateToStore}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-3 px-6 rounded-2xl shadow-md shadow-indigo-600/30 inline-flex items-center gap-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay Lại Sàn Mua Sắm</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* CỘT TRÁI: DANH SÁCH SẢN PHẨM TRONG GIỎ (5 Cột) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-indigo-600" /> Sản Phẩm Trong Giỏ ({cart.length})
                </h2>
                <button
                  onClick={onNavigateToStore}
                  className="text-xs text-indigo-600 hover:underline font-semibold"
                >
                  + Mua Thêm
                </button>
              </div>

              {/* Danh sách các mặt hàng */}
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1 space-y-2">
                {cart.map((item) => (
                  <div key={item.productId} className="pt-3 first:pt-0 flex items-center justify-between gap-3 text-xs">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl overflow-hidden shrink-0">
                      <img
                        src={item.imageUrl || 'https://placehold.co/100?text=Item'}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-800 truncate">{item.name}</h4>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {new Intl.NumberFormat('vi-VN').format(item.price)} đ •{' '}
                        <span className="font-bold text-indigo-600">Size {item.requiredSize}</span>
                      </div>
                    </div>

                    {/* Bộ tăng/giảm số lượng */}
                    <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0">
                      <button
                        onClick={() => handleUpdateQty(item.productId, -1)}
                        className="p-1 hover:bg-white rounded-lg transition"
                      >
                        <Minus className="w-3 h-3 text-slate-600" />
                      </button>
                      <span className="w-5 text-center font-bold text-slate-800 text-xs">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleUpdateQty(item.productId, 1)}
                        className="p-1 hover:bg-white rounded-lg transition"
                      >
                        <Plus className="w-3 h-3 text-slate-600" />
                      </button>
                    </div>

                    {/* Nút xóa */}
                    <button
                      onClick={() => handleRemoveItem(item.productId)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition"
                      title="Xóa khỏi giỏ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Tổng tiền thanh toán */}
              <div className="pt-4 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-800">
                <span>Tổng tiền hàng:</span>
                <span className="text-xl font-black text-indigo-600">
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(calculateTotal())}
                </span>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: FORM THANH TOÁN, CHỌN TỦ & BẢN ĐỒ (7 Cột) */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-5">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 pb-3 border-b border-slate-100">
                <PackageCheck className="w-5 h-5 text-indigo-600" /> Thông Tin Giao Nhận & Đặt Chỗ Tủ
              </h2>

              <form onSubmit={handleCheckout} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Tên khách hàng</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Số điện thoại nhận OTP
                    </label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
                    />
                  </div>
                </div>

                {/* Phương thức giao hàng */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Phương thức giao nhận hàng
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDeliveryType('LOCKER')}
                      className={`py-3 px-4 rounded-2xl border font-bold text-xs flex items-center justify-center gap-2 transition ${
                        deliveryType === 'LOCKER'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      📦 Tủ Thông Minh (Locker IoT)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeliveryType('STANDARD')}
                      className={`py-3 px-4 rounded-2xl border font-bold text-xs flex items-center justify-center gap-2 transition ${
                        deliveryType === 'STANDARD'
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      🏠 Giao Hàng Tận Nhà
                    </button>
                  </div>
                </div>

                {/* KHU VỰC BẢN ĐỒ & SỨC CHỨA TỦ KHI CHỌN TỦ THÔNG MINH */}
                {deliveryType === 'LOCKER' && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-indigo-600" /> Chọn Vị Trí Trạm Tủ Trên Bản Đồ
                      </label>
                      <span className="text-[11px] text-slate-500">Học viện CNBCVT</span>
                    </div>

                    {/* Bản đồ Leaflet rộng rãi */}
                    <div className="h-56 w-full rounded-2xl overflow-hidden border border-slate-300 shadow-inner">
                      <LockerMap
                        lockers={lockers}
                        selectedLockerId={selectedLockerId}
                        onSelectLocker={setSelectedLockerId}
                      />
                    </div>

                    {/* Chi tiết tủ đang chọn */}
                    {selectedLocker && (
                      <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-3.5 text-xs space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-indigo-900">{selectedLocker.name}</span>
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-bold">
                            {selectedLocker.connectionStatus}
                          </span>
                        </div>
                        <p className="text-slate-600">{selectedLocker.address}</p>
                      </div>
                    )}

                    {/* Chọn ngày nhận hàng */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-indigo-600" /> Ngày mong muốn nhận hàng tại tủ
                      </label>
                      <input
                        type="date"
                        required
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="w-full text-xs px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
                      />

                      {/* Hiển thị số slot khả dụng */}
                      {capacityInfo && (
                        <div className="mt-2 text-xs flex items-center justify-between font-semibold">
                          <span className="text-slate-600">Sức chứa khả dụng ngày này:</span>
                          {capacityInfo.available ? (
                            <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                              Còn {capacityInfo.remainingSlots} / {capacityInfo.totalSlots} ngăn trống
                            </span>
                          ) : (
                            <span className="text-rose-700 bg-rose-50 px-2.5 py-1 rounded-lg font-bold">
                              ⚠️ Hết chỗ (0 ngăn trống)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || (deliveryType === 'LOCKER' && capacityInfo && !capacityInfo.available)}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold py-3.5 px-6 rounded-2xl text-xs transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 mt-4"
                >
                  {loading ? 'Đang xử lý đặt chỗ...' : 'Xác Nhận Đặt Hàng & Giữ Chỗ Tủ'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL GRACEFUL DEGRADATION: KHI TỦ ĐÃ ĐẦY CHỖ */}
      {showDegradationModal && capacityInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center gap-3 text-amber-500 mb-3">
              <AlertTriangle className="w-8 h-8" />
              <div>
                <h3 className="font-bold text-lg text-slate-800">Tủ Đã Hết Ngăn Trống!</h3>
                <p className="text-xs text-slate-500">Cơ chế suy thoái mềm dẻo (Graceful Degradation)</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              Tủ <strong className="text-slate-800">{selectedLocker?.name}</strong> vào ngày{' '}
              <strong className="text-slate-800">{selectedDate}</strong> hiện đã đầy 100% công suất. 
              Để đơn hàng của bạn không bị gián đoạn, hệ thống cung cấp 2 giải pháp:
            </p>

            <div className="space-y-3 mb-6">
              <div 
                onClick={() => {
                  setDeliveryType('STANDARD');
                  setShowDegradationModal(false);
                }}
                className="border border-slate-200 hover:border-indigo-600 bg-slate-50 hover:bg-indigo-50/50 p-3.5 rounded-2xl cursor-pointer transition flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  A
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Chuyển sang Giao Hàng Tận Nhà</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Shipper sẽ gọi điện trực tiếp khi đến địa chỉ của bạn.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 p-3.5 rounded-2xl bg-slate-50 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                    B
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Dời sang ngày tiếp theo còn trống</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Chọn một trong các ngày sau để giữ nguyên phương thức nhận tại Tủ:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1 pl-10">
                  {capacityInfo.alternativeAvailableDates && capacityInfo.alternativeAvailableDates.length > 0 ? (
                    capacityInfo.alternativeAvailableDates.map((altDate) => (
                      <button
                        key={altDate}
                        onClick={() => {
                          setSelectedDate(altDate);
                          setShowDegradationModal(false);
                        }}
                        className="bg-white border border-emerald-400 text-emerald-700 hover:bg-emerald-600 hover:text-white px-2.5 py-1 rounded-lg text-xs font-bold transition shadow-sm"
                      >
                        📅 {altDate}
                      </button>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">Không còn ngày trống trong 7 ngày tới</span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowDegradationModal(false)}
              className="w-full text-xs font-semibold py-2 text-slate-500 hover:text-slate-800"
            >
              Đóng và tự chọn ngày khác
            </button>
          </div>
        </div>
      )}

      {/* MODAL KẾT QUẢ ĐẶT HÀNG THÀNH CÔNG */}
      {orderResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 text-center relative">
            <button
              onClick={() => setOrderResult(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <h3 className="text-2xl font-black text-slate-800">Đặt Hàng Thành Công!</h3>
            <p className="text-xs text-slate-500 mt-1">Mã đơn: <strong className="text-indigo-600">{orderResult.orderId}</strong></p>

            {orderResult.deliveryType === 'LOCKER' ? (
              <div className="mt-5 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <div>
                    <span className="text-slate-500 block">Địa điểm nhận:</span>
                    <strong className="text-slate-800 font-bold">{orderResult.lockerName}</strong>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 block">Ngăn tủ chỉ định:</span>
                    <span className="bg-indigo-600 text-white font-extrabold px-2.5 py-0.5 rounded-full text-xs">
                      Ngăn #{orderResult.compartmentIndex}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600">
                  <p><strong>Ngày hẹn giao:</strong> {orderResult.expectedDate}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Kiện hàng của bạn đang được điều phối cho Shipper. Khi hàng được bỏ vào tủ, bạn sẽ nhận được thông báo mã OTP và mã QR nhận hàng.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-4 bg-slate-50 rounded-xl text-xs text-slate-600">
                Đơn hàng sẽ được chuyển phát tiêu chuẩn tận nhà theo số điện thoại: <strong>{orderResult.customerPhone}</strong>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => {
                  setOrderResult(null);
                  if (onNavigateToOrders) onNavigateToOrders();
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-xs transition shadow-md shadow-indigo-600/30"
              >
                Xem Trong "Đơn Hàng Của Tôi"
              </button>
              <button
                onClick={() => {
                  setOrderResult(null);
                  if (onNavigateToStore) onNavigateToStore();
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 px-4 rounded-xl text-xs transition"
              >
                Tiếp Tục Mua Sắm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
