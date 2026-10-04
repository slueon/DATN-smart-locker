import React, { useState, useEffect } from 'react';
import { lockerApi, shipperApi, pickupApi, orderApi } from '../services/api';
import { 
  Cpu, Lock, Unlock, CheckCircle2, AlertCircle, 
  Smartphone, QrCode, Keyboard, ArrowLeft, RefreshCw 
} from 'lucide-react';

export default function LockerSimulatorTab() {
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [compartments, setCompartments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Màn hình TFT ảo: 'HOME', 'SHIPPER_AUTH', 'SHIPPER_SCAN_ORDER', 'SHIPPER_DOOR_OPEN', 'CUSTOMER_PICKUP_MENU', 'CUSTOMER_OTP', 'CUSTOMER_QR', 'SUCCESS_SCREEN'
  const [screenState, setScreenState] = useState('HOME');
  const [tftMessage, setTftMessage] = useState('Chào mừng đến với Smart Locker PTIT');

  // Input giả lập
  const [inputShipperQr, setInputShipperQr] = useState('');
  const [inputOrderBarcode, setInputOrderBarcode] = useState('');
  const [inputOtp, setInputOtp] = useState('');
  const [activeComp, setActiveComp] = useState(null);

  useEffect(() => {
    fetchCompartments();
  }, [selectedLockerId]);

  const fetchCompartments = async () => {
    try {
      const res = await lockerApi.getCompartments(selectedLockerId);
      if (res.data && res.data.data) {
        setCompartments(res.data.data);
      }
    } catch (err) {
      console.error('Lỗi tải ngăn tủ:', err);
    }
  };

  // 1. Shipper: Xác thực QR định danh
  const handleVerifyShipperQr = async () => {
    if (!inputShipperQr) {
      alert('Vui lòng nhập/dán mã token QR động của Shipper!');
      return;
    }
    setLoading(true);
    try {
      const res = await shipperApi.verifyToken(selectedLockerId, inputShipperQr);
      if (res.data && res.data.success) {
        setScreenState('SHIPPER_SCAN_ORDER');
        setTftMessage('✅ Shipper hợp lệ! Vui lòng quét mã vận đơn kiện hàng.');
      }
    } catch (err) {
      alert('Xác thực thất bại: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // 2. Shipper: Quét mã vận đơn và mở ngăn tủ
  const handleDepositPackage = async () => {
    if (!inputOrderBarcode) {
      alert('Vui lòng nhập mã đơn hàng (VD: ORD-...)');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        lockerId: selectedLockerId,
        orderId: inputOrderBarcode,
        weightGrams: 0.85, // Giả lập cảm biến tải trọng HX711 phát hiện 850g
        isDoorClosed: true, // Giả lập công tắc từ MC-38 báo đóng
      };

      const res = await shipperApi.depositPackage(payload);
      if (res.data && res.data.success) {
        setActiveComp(res.data.data.compartmentIndex);
        setScreenState('SUCCESS_SCREEN');
        setTftMessage(`🎉 Đã mở chốt relay ngăn #${res.data.data.compartmentIndex}! Bỏ hàng vào và đóng cửa thành công.`);
        fetchCompartments();
      }
    } catch (err) {
      alert('Gửi hàng thất bại: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // 3. Khách hàng: Lấy đồ bằng OTP
  const handleVerifyOtp = async () => {
    if (inputOtp.length !== 6) {
      alert('Vui lòng nhập đủ 6 chữ số OTP!');
      return;
    }
    setLoading(true);
    try {
      const res = await pickupApi.verifyPickup({
        lockerId: selectedLockerId,
        authMethod: 'OTP',
        code: inputOtp,
      });

      if (res.data && res.data.success) {
        setActiveComp(res.data.data.compartmentIndex);
        setScreenState('SUCCESS_SCREEN');
        setTftMessage(`🔓 Mở ngăn #${res.data.data.compartmentIndex}! Mời quý khách nhận kiện hàng.`);
        fetchCompartments();
      }
    } catch (err) {
      alert('Mã OTP không đúng: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Nhấn bàn phím cảm ứng ảo cho OTP
  const handleKeypadPress = (num) => {
    if (inputOtp.length < 6) {
      setInputOtp((prev) => prev + num);
    }
  };

  const handleKeypadDelete = () => {
    setInputOtp((prev) => prev.slice(0, -1));
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 flex items-center justify-center gap-2">
          <Cpu className="w-8 h-8 text-indigo-600" /> Bảng Mô Phỏng Hệ Thống Tủ Vật Lý & Màn Hình Cảm Ứng
        </h1>
        <p className="mt-2 text-slate-600 text-sm">
          Mô phỏng chân thực màn hình điều khiển SPI TFT ESP32, đầu đọc GM65 và cảm biến kép (MC-38 + HX711).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* CỘT TRÁI: MÀN HÌNH CẢM ỨNG TFT 320x240 MÔ PHỎNG (6 Cột) */}
        <div className="lg:col-span-6 space-y-4">
          <h2 className="font-bold text-slate-700 text-sm flex items-center gap-2">
            🖥️ Màn Hình Cảm Ứng TFT ESP32 (Smart Screen Simulation)
          </h2>

          <div className="bg-slate-950 p-4 rounded-3xl border-4 border-slate-800 shadow-2xl aspect-[4/3] flex flex-col justify-between text-white font-sans relative overflow-hidden">
            {/* Thanh trạng thái đỉnh màn hình TFT */}
            <div className="flex justify-between items-center text-[10px] text-slate-400 pb-2 border-b border-slate-800">
              <span className="font-bold text-indigo-400">SMART LOCKER v2.3</span>
              <span className="bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded font-mono">MQTT: CONNECTED</span>
            </div>

            {/* NỘI DUNG MÀN HÌNH TFT THEO STATE */}
            <div className="flex-1 flex flex-col items-center justify-center my-3 text-center px-4">
              {screenState === 'HOME' && (
                <div className="w-full space-y-4">
                  <h3 className="text-base font-extrabold tracking-wide text-slate-200">
                    VUI LÒNG CHỌN THAO TÁC
                  </h3>
                  <div className="grid grid-cols-2 gap-3 w-full">
                    <button
                      onClick={() => {
                        setScreenState('CUSTOMER_PICKUP_MENU');
                        setInputOtp('');
                      }}
                      className="bg-emerald-600 hover:bg-emerald-500 py-4 px-2 rounded-2xl font-black text-xs tracking-wider uppercase transition shadow-lg shadow-emerald-900/40"
                    >
                      📦 [NHẬN HÀNG]<br />
                      <span className="text-[9px] font-normal lowercase opacity-80">(Dành cho khách)</span>
                    </button>

                    <button
                      onClick={() => setScreenState('SHIPPER_AUTH')}
                      className="bg-indigo-600 hover:bg-indigo-500 py-4 px-2 rounded-2xl font-black text-xs tracking-wider uppercase transition shadow-lg shadow-indigo-900/40"
                    >
                      🚚 [GIAO HÀNG]<br />
                      <span className="text-[9px] font-normal lowercase opacity-80">(Dành cho Shipper)</span>
                    </button>
                  </div>
                </div>
              )}

              {screenState === 'SHIPPER_AUTH' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-amber-400 font-bold">XÁC MINH DANH TÍNH SHIPPER</p>
                  <p className="text-[11px] text-slate-300">
                    Mời Shipper đưa mã QR định danh (60s) trên điện thoại vào camera GM65 bên dưới:
                  </p>
                  <input
                    type="text"
                    placeholder="Mã token QR của Shipper (SHIP-...)"
                    value={inputShipperQr}
                    onChange={(e) => setInputShipperQr(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-center py-2 px-3 rounded-xl text-white font-mono"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setScreenState('HOME')}
                      className="flex-1 bg-slate-800 text-[10px] py-2 rounded-xl"
                    >
                      Quay lại
                    </button>
                    <button
                      onClick={handleVerifyShipperQr}
                      disabled={loading}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold py-2 rounded-xl"
                    >
                      {loading ? 'Đang đọc...' : 'Quét Camera GM65'}
                    </button>
                  </div>
                </div>
              )}

              {screenState === 'SHIPPER_SCAN_ORDER' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-emerald-400 font-bold">ĐỊNH DANH THÀNH CÔNG!</p>
                  <p className="text-[11px] text-slate-300">
                    Mời quét mã vạch trên kiện hàng để mở ngăn tủ:
                  </p>
                  <input
                    type="text"
                    placeholder="Mã đơn kiện hàng (VD: ORD-...)"
                    value={inputOrderBarcode}
                    onChange={(e) => setInputOrderBarcode(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 text-xs text-center py-2 px-3 rounded-xl text-white font-mono"
                  />
                  <button
                    onClick={handleDepositPackage}
                    disabled={loading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-xs font-bold py-2.5 rounded-xl shadow"
                  >
                    {loading ? 'Đang gửi...' : 'Mở Ngăn Tủ & Bỏ Hàng'}
                  </button>
                </div>
              )}

              {screenState === 'CUSTOMER_PICKUP_MENU' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-slate-300 font-bold">CHỌN PHƯƠNG THỨC XÁC THỰC</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setScreenState('CUSTOMER_OTP')}
                      className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-xs font-bold border border-slate-700"
                    >
                      🔢 Bàn Phím OTP (6 số)
                    </button>
                    <button
                      onClick={() => {
                        const qr = prompt('Mời quét/nhập mã QR nhận đồ (PKUP-...):');
                        if (qr) {
                          pickupApi.verifyPickup({
                            lockerId: selectedLockerId,
                            authMethod: 'QR',
                            code: qr,
                          }).then(res => {
                            setActiveComp(res.data.data.compartmentIndex);
                            setScreenState('SUCCESS_SCREEN');
                            setTftMessage(`🔓 Mở ngăn #${res.data.data.compartmentIndex}!`);
                            fetchCompartments();
                          }).catch(e => alert(e.response?.data?.message || 'Sai mã'));
                        }
                      }}
                      className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-xs font-bold border border-slate-700"
                    >
                      📷 Quét Mã QR (GM65)
                    </button>
                  </div>
                  <button onClick={() => setScreenState('HOME')} className="text-[10px] text-slate-400 hover:text-white pt-2">
                    Quay lại màn hình chính
                  </button>
                </div>
              )}

              {screenState === 'CUSTOMER_OTP' && (
                <div className="w-full space-y-2">
                  <p className="text-[11px] text-slate-300">Nhập mã OTP 6 số:</p>
                  <div className="text-xl font-mono tracking-widest text-amber-400 bg-slate-900 py-1.5 px-4 rounded-xl border border-slate-700 inline-block min-w-36">
                    {inputOtp.padEnd(6, '•')}
                  </div>

                  {/* Bàn phím số cảm ứng ảo */}
                  <div className="grid grid-cols-3 gap-1.5 max-w-[200px] mx-auto pt-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleKeypadPress(n.toString())}
                        className="bg-slate-800 hover:bg-slate-700 text-xs font-bold py-1.5 rounded-lg active:scale-95 transition"
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setScreenState('HOME')}
                      className="bg-rose-950 text-rose-300 text-[10px] py-1.5 rounded-lg"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={() => handleKeypadPress('0')}
                      className="bg-slate-800 hover:bg-slate-700 text-xs font-bold py-1.5 rounded-lg"
                    >
                      0
                    </button>
                    <button
                      onClick={handleKeypadDelete}
                      className="bg-slate-800 text-slate-400 text-xs py-1.5 rounded-lg"
                    >
                      ⌫
                    </button>
                  </div>

                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading || inputOtp.length !== 6}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-xs font-bold py-2 rounded-xl mt-1"
                  >
                    {loading ? 'Đang xác thực...' : 'Mở Cửa Tủ'}
                  </button>
                </div>
              )}

              {screenState === 'SUCCESS_SCREEN' && (
                <div className="w-full space-y-3">
                  <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-emerald-400">{tftMessage}</p>
                  <p className="text-[10px] text-slate-400">
                    Cửa ngăn số #{activeComp} đã được mở. Relay sẽ tự ngắt chốt sau 5 giây.
                  </p>
                  <button
                    onClick={() => {
                      setScreenState('HOME');
                      setActiveComp(null);
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-[10px] font-bold px-4 py-2 rounded-xl"
                  >
                    Trở về màn hình chờ
                  </button>
                </div>
              )}
            </div>

            {/* Chân màn hình */}
            <div className="text-[9px] text-slate-500 text-center pt-2 border-t border-slate-900">
              Chạm vào các nút ảo để tương tác như trên màn hình thật
            </div>
          </div>
        </div>

        {/* CỘT PHẢI: TRẠNG THÁI 3 NGĂN TỦ VẬT LÝ (6 Cột) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 text-sm flex items-center gap-2">
              🔒 Tình Trạng Ngăn Tủ Vật Lý ({compartments.length} ngăn)
            </h2>
            <button
              onClick={fetchCompartments}
              className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Làm mới
            </button>
          </div>

          <div className="space-y-3">
            {compartments.map((comp) => {
              const isCompActive = activeComp === comp.compIndex;
              const isOccupied = comp.status === 'OCCUPIED';

              return (
                <div
                  key={comp.compartmentId}
                  className={`p-4 rounded-2xl border transition-all duration-300 ${
                    isCompActive
                      ? 'border-emerald-500 bg-emerald-50 shadow-md ring-2 ring-emerald-400'
                      : isOccupied
                      ? 'border-indigo-200 bg-indigo-50/40'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-slate-900 text-white font-bold text-xs flex items-center justify-center">
                        #{comp.compIndex}
                      </span>
                      <strong className="text-sm text-slate-800">
                        Ngăn {comp.compIndex} (Size: {comp.size})
                      </strong>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                          comp.status === 'EMPTY'
                            ? 'bg-emerald-100 text-emerald-800'
                            : comp.status === 'OCCUPIED'
                            ? 'bg-indigo-100 text-indigo-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {comp.status}
                      </span>
                      {isCompActive ? (
                        <Unlock className="w-5 h-5 text-emerald-600 animate-bounce" />
                      ) : (
                        <Lock className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Thông tin cảm biến kép */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Cảm biến từ MC-38:</span>
                      <strong className={comp.isDoorClosed ? 'text-emerald-700' : 'text-rose-600'}>
                        {comp.isDoorClosed ? '✅ Cửa đang ĐÓNG' : '⚠️ Cửa đang MỞ'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Cảm biến lực HX711:</span>
                      <strong className="text-indigo-700">
                        ⚖️ {comp.currentWeight || 0.0} kg
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
