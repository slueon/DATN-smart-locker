import React, { useState, useEffect } from 'react';
import { lockerApi, shipperApi, pickupApi } from '../services/api';
import { store } from '../services/store';
import { 
  Cpu, Lock, Unlock, CheckCircle2,
  RefreshCw, DoorOpen, Weight, Radio, Wifi,
  Sliders, Terminal, Play, Zap, Check
} from 'lucide-react';

export default function LockerSimulatorTab() {
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [compartments, setCompartments] = useState([
    { compartmentId: 1, compIndex: 1, size: 'S', status: 'EMPTY', isDoorClosed: true, currentWeight: 0.0 },
    { compartmentId: 2, compIndex: 2, size: 'M', status: 'OCCUPIED', isDoorClosed: true, currentWeight: 0.85 },
    { compartmentId: 3, compIndex: 3, size: 'L', status: 'EMPTY', isDoorClosed: true, currentWeight: 0.0 },
  ]);
  const [loading, setLoading] = useState(false);

  // Màn hình TFT ảo
  const [screenState, setScreenState] = useState('HOME');
  const [tftMessage, setTftMessage] = useState('Chào mừng đến với SmartLocker PTIT');

  // Input giả lập
  const [inputShipperQr, setInputShipperQr] = useState('');
  const [inputOrderBarcode, setInputOrderBarcode] = useState('');
  const [inputOtp, setInputOtp] = useState('');
  const [activeComp, setActiveComp] = useState(null);

  // Telemetry Console logs
  const [hardwareLogs, setHardwareLogs] = useState([
    '[INIT] ESP32-WROOM-32 booting... SPI TFT IL9341 ready.',
    '[GPIO] Solenoid relay pins: D26, D27, D14 initialized.',
    '[SENSOR] HX711 Load Cell calibration offset set: 420.5.',
    '[MQTT] Subscribed to topic: ptit/locker/LOCKER_HN_01/#'
  ]);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString('vi-VN');
    setHardwareLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 12)]);
  };

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
      // Giữ mock state
    }
  };

  const handleVerifyShipperQr = async () => {
    if (!inputShipperQr) {
      alert('Vui lòng nhập mã token QR của Shipper!');
      return;
    }
    setLoading(true);
    addLog(`GM65 Scanner: Đọc mã token ${inputShipperQr}`);
    try {
      const res = await shipperApi.verifyToken(selectedLockerId, inputShipperQr);
      if (res.data && res.data.success) {
        setScreenState('SHIPPER_SCAN_ORDER');
        setTftMessage('Shipper hợp lệ! Vui lòng quét mã đơn hàng.');
        addLog('Auth: Shipper JWT Token xác thực hợp lệ.');
      }
    } catch (err) {
      if (inputShipperQr.startsWith('SHIP')) {
        setScreenState('SHIPPER_SCAN_ORDER');
        setTftMessage('Shipper hợp lệ! Vui lòng quét mã đơn hàng.');
        addLog('Auth: [Demo Token] Xác thực hợp lệ.');
      } else {
        alert('Xác thực thất bại: ' + (err.response?.data?.message || err.message));
        addLog('Auth Error: Token không hợp lệ hoặc đã hết hạn.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDepositPackage = async () => {
    if (!inputOrderBarcode) {
      alert('Vui lòng nhập mã đơn hàng (VD: ORD-...)');
      return;
    }
    setLoading(true);
    addLog(`Deposit: Xử lý đơn ${inputOrderBarcode} cho ${selectedLockerId}`);
    try {
      const payload = {
        lockerId: selectedLockerId,
        orderId: inputOrderBarcode,
        weightGrams: 0.85,
        isDoorClosed: true,
      };

      const res = await shipperApi.depositPackage(payload);
      if (res.data && res.data.success) {
        const idx = res.data.data.compartmentIndex;
        setActiveComp(idx);
        setScreenState('SUCCESS_SCREEN');
        setTftMessage(`Đã mở chốt relay ngăn #${idx}! Bỏ hàng vào và đóng cửa.`);
        addLog(`Relay Driver: Gửi xung 12V mở Solenoid Ngăn #${idx}`);
        fetchCompartments();
      }
    } catch (err) {
      setActiveComp(1);
      setScreenState('SUCCESS_SCREEN');
      setTftMessage(`Đã mở chốt relay ngăn #1! Bỏ hàng và đóng cửa.`);
      addLog('Relay Driver: [Demo] Mở Solenoid Ngăn #1.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (inputOtp.length !== 6) {
      alert('Vui lòng nhập đủ 6 chữ số OTP!');
      return;
    }
    setLoading(true);
    addLog(`Keypad: Khách hàng nhập OTP ${inputOtp}`);
    try {
      const res = await pickupApi.verifyPickup({
        lockerId: selectedLockerId,
        authMethod: 'OTP',
        code: inputOtp,
      });

      if (res.data && res.data.success) {
        const idx = res.data.data.compartmentIndex;
        setActiveComp(idx);
        setScreenState('SUCCESS_SCREEN');
        setTftMessage(`Đã mở chốt ngăn #${idx}!`);
        addLog(`Relay Driver: Mở khóa Solenoid Ngăn #${idx} cho khách.`);
        fetchCompartments();
      }
    } catch (err) {
      setActiveComp(2);
      setScreenState('SUCCESS_SCREEN');
      setTftMessage(`Xác thực OTP thành công! Đã mở Ngăn #2.`);
      addLog('Relay Driver: [Demo] Mở khóa Solenoid Ngăn #2.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeypadPress = (num) => {
    if (inputOtp.length < 6) {
      setInputOtp((prev) => prev + num);
    }
  };

  const handleKeypadDelete = () => {
    setInputOtp((prev) => prev.slice(0, -1));
  };

  // Interactive Hardware Workbench Controls
  const toggleDoorState = (compIndex) => {
    setCompartments((prev) =>
      prev.map((c) => {
        if (c.compIndex === compIndex) {
          const nextState = !c.isDoorClosed;
          addLog(`MC-38 Sensor Ngăn #${compIndex}: ${nextState ? 'CLOSED (Đóng kín)' : 'OPEN (Mở cửa)'}`);
          return { ...c, isDoorClosed: nextState };
        }
        return c;
      })
    );
  };

  const updateWeight = (compIndex, newWeight) => {
    setCompartments((prev) =>
      prev.map((c) => {
        if (c.compIndex === compIndex) {
          addLog(`HX711 Load Cell Ngăn #${compIndex}: Tải trọng cập nhật ${newWeight} kg`);
          return { ...c, currentWeight: parseFloat(newWeight) };
        }
        return c;
      })
    );
  };

  const triggerSolenoidPulse = (compIndex) => {
    setActiveComp(compIndex);
    addLog(`Manual Test: Kích xung điện 12V (250ms) mở Solenoid Ngăn #${compIndex}`);
    setTimeout(() => {
      setActiveComp(null);
    }, 3000);
  };

  return (
    <div className="space-y-6 notranslate select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Cpu className="w-6 h-6 text-blue-600" />
            Giả Lập Kiosk IoT & Bàn Thí Nghiệm Cảm Biến Phần Cứng
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mô phỏng màn hình LCD cảm ứng Kiosk kết hợp bàn điều khiển vi mạch ESP32, rơ-le khóa và cảm biến tải trọng.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-700 w-fit">
          <Wifi className="w-4 h-4 text-emerald-600" />
          <span>ESP32 NodeMCU • Port 8080/MQTT</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* CỘT TRÁI: MÀN HÌNH KIOSK CẢM ỨNG (6 Cột) */}
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900 text-sm">
              Màn Hình Cảm Ứng Kiosk (Giao Diện Khách / Shipper)
            </h2>
            <span className="text-xs font-mono text-slate-400">TFT 3.2" SPI (320x240)</span>
          </div>

          <div className="bg-slate-900 p-5 rounded-2xl border-4 border-slate-800 shadow-lg aspect-[4/3] flex flex-col justify-between text-white relative">
            <div className="flex justify-between items-center text-[11px] text-slate-400 pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200">SMARTLOCKER KIOSK v2.3</span>
              <span className="flex items-center gap-1 text-emerald-400 font-mono text-[10px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
                ONLINE
              </span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center my-3 text-center px-4">
              {screenState === 'HOME' && (
                <div className="w-full space-y-4">
                  <h3 className="text-sm font-bold tracking-wider text-slate-100 uppercase">
                    CHỌN THAO TÁC TẠI TRẠM TỦ
                  </h3>
                  <div className="grid grid-cols-2 gap-3 w-full">
                    <button
                      onClick={() => {
                        setScreenState('CUSTOMER_PICKUP_MENU');
                        setInputOtp('');
                      }}
                      className="bg-blue-600 hover:bg-blue-500 py-3.5 px-3 rounded-xl font-bold text-xs tracking-wider uppercase transition cursor-pointer shadow-xs"
                    >
                      📦 NHẬN HÀNG<br />
                      <span className="text-[10px] font-normal lowercase opacity-80 block mt-0.5">(Khách Hàng)</span>
                    </button>

                    <button
                      onClick={() => setScreenState('SHIPPER_AUTH')}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 py-3.5 px-3 rounded-xl font-bold text-xs tracking-wider uppercase transition cursor-pointer shadow-xs"
                    >
                      🚚 GỬI HÀNG<br />
                      <span className="text-[10px] font-normal lowercase opacity-80 block mt-0.5">(Shipper)</span>
                    </button>
                  </div>
                </div>
              )}

              {screenState === 'SHIPPER_AUTH' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-amber-400 font-bold">XÁC MINH DANH TÍNH SHIPPER</p>
                  <p className="text-[11px] text-slate-300">
                    Nhập mã QR định danh của Shipper để mở khóa:
                  </p>
                  <input
                    type="text"
                    placeholder="Mã QR Shipper (SHIP-...)"
                    value={inputShipperQr}
                    onChange={(e) => setInputShipperQr(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-center py-2 px-3 rounded-lg text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setScreenState('HOME')}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-xs py-2 rounded-lg cursor-pointer"
                    >
                      Quay lại
                    </button>
                    <button
                      onClick={handleVerifyShipperQr}
                      disabled={loading}
                      className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold py-2 rounded-lg cursor-pointer"
                    >
                      {loading ? 'Đang đọc...' : 'Xác thực'}
                    </button>
                  </div>
                </div>
              )}

              {screenState === 'SHIPPER_SCAN_ORDER' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-emerald-400 font-bold">XÁC THỰC THÀNH CÔNG!</p>
                  <p className="text-[11px] text-slate-300">
                    Nhập mã đơn hàng để kích hoạt mở chốt Solenoid:
                  </p>
                  <input
                    type="text"
                    placeholder="Mã đơn hàng (VD: ORD-123456)"
                    value={inputOrderBarcode}
                    onChange={(e) => setInputOrderBarcode(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-xs text-center py-2 px-3 rounded-lg text-white font-mono focus:outline-none focus:border-blue-400"
                  />
                  <button
                    onClick={handleDepositPackage}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-xs font-bold py-2.5 rounded-lg shadow-xs cursor-pointer"
                  >
                    {loading ? 'Đang gửi lệnh...' : 'Mở ngăn tủ & Nạp hàng'}
                  </button>
                </div>
              )}

              {screenState === 'CUSTOMER_PICKUP_MENU' && (
                <div className="w-full space-y-3">
                  <p className="text-xs text-slate-200 font-bold">CHỌN PHƯƠNG THỨC XÁC THỰC</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={() => setScreenState('CUSTOMER_OTP')}
                      className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-xs font-bold border border-slate-700 cursor-pointer"
                    >
                      🔢 Bàn phím PIN (6 Số)
                    </button>
                    <button
                      onClick={() => {
                        const qr = prompt('Nhập mã QR nhận hàng (PKUP-...):');
                        if (qr) {
                          pickupApi.verifyPickup({
                            lockerId: selectedLockerId,
                            authMethod: 'QR',
                            code: qr,
                          }).then(res => {
                            setActiveComp(res.data.data.compartmentIndex);
                            setScreenState('SUCCESS_SCREEN');
                            setTftMessage(`Đã mở ngăn #${res.data.data.compartmentIndex}!`);
                            fetchCompartments();
                          }).catch(() => {
                            setActiveComp(2);
                            setScreenState('SUCCESS_SCREEN');
                            setTftMessage('Quét QR thành công! Cánh tủ Ngăn #2 đang mở.');
                          });
                        }
                      }}
                      className="bg-slate-800 hover:bg-slate-700 p-3 rounded-xl text-xs font-bold border border-slate-700 cursor-pointer"
                    >
                      📷 Quét mã QR
                    </button>
                  </div>
                  <button onClick={() => setScreenState('HOME')} className="text-[11px] text-slate-400 hover:text-white pt-1 cursor-pointer">
                    Trở về màn hình chính
                  </button>
                </div>
              )}

              {screenState === 'CUSTOMER_OTP' && (
                <div className="w-full space-y-2">
                  <p className="text-[11px] text-slate-300">Nhập mã OTP gồm 6 chữ số:</p>
                  <div className="text-xl font-mono font-bold tracking-widest text-amber-400 bg-slate-800 py-1 px-4 rounded-lg border border-slate-700 inline-block min-w-36">
                    {inputOtp.padEnd(6, '•')}
                  </div>

                  <div className="grid grid-cols-3 gap-1 max-w-[190px] mx-auto pt-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleKeypadPress(n.toString())}
                        className="bg-slate-800 hover:bg-slate-700 text-xs font-bold py-1.5 rounded active:scale-95 transition border border-slate-700 cursor-pointer"
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      onClick={() => setScreenState('HOME')}
                      className="bg-rose-950 text-rose-300 text-[10px] py-1.5 rounded cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={() => handleKeypadPress('0')}
                      className="bg-slate-800 hover:bg-slate-700 text-xs font-bold py-1.5 rounded cursor-pointer"
                    >
                      0
                    </button>
                    <button
                      onClick={handleKeypadDelete}
                      className="bg-slate-800 text-slate-300 text-xs py-1.5 rounded cursor-pointer"
                    >
                      ⌫
                    </button>
                  </div>

                  <button
                    onClick={handleVerifyOtp}
                    disabled={loading || inputOtp.length !== 6}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs py-2 rounded-lg cursor-pointer"
                  >
                    {loading ? 'Đang kiểm tra...' : 'Mở cánh tủ'}
                  </button>
                </div>
              )}

              {screenState === 'SUCCESS_SCREEN' && (
                <div className="w-full space-y-2.5">
                  <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-emerald-400">{tftMessage}</p>
                  <p className="text-[11px] text-slate-300">
                    Khóa Solenoid Ngăn #{activeComp} đã mở. Xin vui lòng đóng kín cửa sau khi thao tác.
                  </p>
                  <button
                    onClick={() => {
                      setScreenState('HOME');
                      setActiveComp(null);
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
                  >
                    Về màn hình chính
                  </button>
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-500 text-center pt-1.5 border-t border-slate-800 font-mono">
              [SMARTLOCKER KIOSK INTERFACE • HARDWARE SIMULATION]
            </div>
          </div>
        </div>

        {/* CỘT PHẢI: BÀN ĐIỀU KHIỂN & CẢM BIẾN VẬT LÝ INTERACTIVE (6 Cột) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-blue-600" /> Bàn Kiểm Thử Vi Mạch & Cảm Biến Kép
            </h2>
            <button
              onClick={fetchCompartments}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Làm mới
            </button>
          </div>

          {/* Compartments Hardware Racks */}
          <div className="space-y-3">
            {compartments.map((comp) => {
              const isCompActive = activeComp === comp.compIndex;

              return (
                <div
                  key={comp.compartmentId || comp.compIndex}
                  className={`p-4 rounded-xl border transition bg-white shadow-xs space-y-3 ${
                    isCompActive
                      ? 'border-emerald-500 ring-2 ring-emerald-100'
                      : 'border-slate-200/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-900 font-mono font-bold text-xs flex items-center justify-center border border-slate-200">
                        #{comp.compIndex}
                      </span>
                      <strong className="text-xs font-semibold text-slate-900">
                        Ngăn số {comp.compIndex} (Size {comp.size})
                      </strong>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="bg-slate-100 text-slate-700 text-[10px] font-semibold px-2 py-0.5 rounded">
                        {comp.status}
                      </span>
                      {isCompActive ? (
                        <span className="text-emerald-600 font-bold text-xs flex items-center gap-1 animate-pulse">
                          <Unlock className="w-3.5 h-3.5" /> Relay BẬT
                        </span>
                      ) : (
                        <span className="text-slate-400 font-medium text-xs flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5" /> Relay TẮT
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Interactive Sensor Controllers */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {/* Controller 1: Door Switch (MC-38) */}
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 text-[11px]">Cảm biến từ MC-38:</span>
                        <strong className={comp.isDoorClosed ? 'text-emerald-700' : 'text-rose-700'}>
                          {comp.isDoorClosed ? 'Đã đóng kín' : 'Cửa đang mở'}
                        </strong>
                      </div>
                      <button
                        onClick={() => toggleDoorState(comp.compIndex)}
                        className="w-full text-center py-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium transition cursor-pointer"
                      >
                        {comp.isDoorClosed ? 'Gạt mở cửa (Open)' : 'Đóng cửa lại (Close)'}
                      </button>
                    </div>

                    {/* Controller 2: Weight Slider (HX711) */}
                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500 text-[11px]">Cân tải HX711:</span>
                        <strong className="text-slate-800 font-mono">{comp.currentWeight || 0.0} kg</strong>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="3"
                        step="0.05"
                        value={comp.currentWeight || 0.0}
                        onChange={(e) => updateWeight(comp.compIndex, e.target.value)}
                        className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  {/* Manual Solenoid Pulse Test Button */}
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => triggerSolenoidPulse(comp.compIndex)}
                      className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 text-slate-600 text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
                    >
                      <Zap className="w-3 h-3 text-amber-500" />
                      <span>Thử kích xung Relay 12V mở chốt</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Real-time Hardware Console Terminal */}
          <div className="p-3 bg-slate-900 rounded-xl text-slate-100 font-mono text-[11px] space-y-1">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-slate-400">
              <span className="flex items-center gap-1">
                <Terminal className="w-3.5 h-3.5 text-blue-400" /> Hardware Event Log
              </span>
              <span className="text-[10px]">UART Serial 115200</span>
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1 pt-1 pr-1 text-[10px]">
              {hardwareLogs.map((log, lIdx) => (
                <div key={lIdx} className="text-slate-300 truncate">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
