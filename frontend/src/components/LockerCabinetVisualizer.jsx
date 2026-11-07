import React from 'react';
import {
  Lock, Unlock, DoorOpen, Weight, Layers, ShieldCheck,
  AlertTriangle, CheckCircle2, Box, Cpu, Wifi
} from 'lucide-react';

/**
 * LockerCabinetVisualizer: Mô hình tủ thông minh 2D/Isometric thời gian thực
 * Trực quan hóa chốt điện Solenoid, cảm biến cửa từ MC-38 và cân tải trọng HX711
 */
export default function LockerCabinetVisualizer({
  lockerName = 'Trạm Tủ KTX A1',
  lockerId = 'LOCKER_HN_01',
  compartments = null,
  activeSlotId = 2, // Ngăn đang thao tác (1, 2, 3)
  doorState = 'CLOSED', // 'CLOSED' | 'OPEN'
  sensorWeight = 0.85, // KG
  onSelectSlot = null,
  highlightOrder = null,
  compact = false
}) {
  // Dữ liệu ngăn tủ mặc định nếu không truyền từ store (Hệ thống chuẩn 2 ngăn: Nhỏ & Lớn)
  const defaultSlots = [
    {
      id: 1,
      name: 'Ngăn 1 (Size S - Nhỏ)',
      size: 'S',
      dimensions: '15 x 30 x 40 cm',
      status: 'AVAILABLE',
      weight: 0.0,
      door: 'CLOSED',
      orderCode: null
    },
    {
      id: 2,
      name: 'Ngăn 2 (Size L - Lớn)',
      size: 'L',
      dimensions: '40 x 45 x 55 cm',
      status: 'DEPOSITED',
      weight: 0.85,
      door: 'CLOSED',
      orderCode: 'ORD-2026-002'
    }
  ];

  const slotsToRender = compartments || defaultSlots;

  return (
    <div className="w-full liquid-glass-card rounded-3xl p-4 sm:p-5 notranslate select-none border border-white/90 shadow-xl">
      {/* Locker Station Enclosure Header */}
      <div className="flex flex-wrap items-center justify-between pb-3.5 mb-4 border-b border-slate-100 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shadow-xs">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>{lockerName}</span>
              <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200 font-bold">
                {lockerId}
              </span>
            </h4>
            <p className="text-[11px] text-slate-500 font-medium">
              Sơ đồ cảm biến thời gian thực
            </p>
          </div>
        </div>

        {/* Real-time Telemetry Status Pill */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100/80 border border-slate-200/70 text-slate-700 text-[11px] font-mono shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold">ESP32 12ms</span>
          <span className="text-slate-300">•</span>
          <span className="text-blue-600 font-bold">MQTT 1883</span>
        </div>
      </div>

      {/* Compartment Rack Grid (2 Ngăn: Size S & Size L) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {slotsToRender.map((slot) => {
          const isTarget = slot.id === activeSlotId;
          const currentDoor = isTarget ? doorState : (slot.door || 'CLOSED');
          const isOpen = currentDoor === 'OPEN';
          const currentWeight = isTarget ? sensorWeight : (slot.weight || 0.0);

          // Trạng thái màu sắc của ngăn tủ theo iOS System Colors
          let statusBadge = { label: 'Ngăn Trống', color: 'emerald', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200/80' };
          if (slot.status === 'OVERDUE') {
            statusBadge = { label: 'Quá Hạn Lưu', color: 'rose', bg: 'bg-rose-50 text-rose-700 border-rose-200/80' };
          } else if (slot.status === 'DEPOSITED' || slot.status === 'BUSY') {
            statusBadge = { label: 'Đang Có Hàng', color: 'blue', bg: 'bg-blue-50 text-blue-700 border-blue-200/80' };
          }

          return (
            <div
              key={slot.id}
              onClick={() => onSelectSlot && onSelectSlot(slot)}
              className={`relative rounded-3xl border transition-all duration-300 flex flex-col justify-between overflow-hidden cursor-pointer ${
                isTarget
                  ? 'liquid-glass-card border-blue-500/90 shadow-xl ring-2 ring-blue-500/25 -translate-y-0.5'
                  : 'liquid-glass-subtle border-white/70 hover:border-white/95 hover:bg-white/55 shadow-sm'
              } ${compact ? 'p-3.5' : 'p-4.5'}`}
            >
              {/* Door Solenoid Active Indicator Band */}
              {isOpen && (
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-500 animate-pulse" />
              )}

              {/* Slot Header Info */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-lg bg-slate-900 text-white font-mono text-xs font-bold flex items-center justify-center shadow-xs">
                      #{slot.id}
                    </span>
                    <span className="text-xs font-bold text-slate-800">
                      Ngăn #{slot.id} ({slot.size === 'S' ? 'Size S - Nhỏ' : 'Size L - Lớn'})
                    </span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadge.bg}`}>
                    {statusBadge.label}
                  </span>
                </div>

                {/* Locker Physical Door Visualizer */}
                <div className={`my-2.5 p-3 rounded-2xl border transition-all duration-300 relative ${
                  isOpen
                    ? 'bg-amber-500/15 border-amber-300/80 text-amber-900 shadow-sm backdrop-blur-md'
                    : 'liquid-glass-subtle border-white/70 text-slate-700'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isOpen ? (
                        <div className="p-1.5 rounded-xl bg-amber-500/20 text-amber-600 animate-pulse">
                          <DoorOpen className="w-5 h-5" />
                        </div>
                      ) : (
                        <div className="p-1.5 rounded-xl bg-white/70 text-slate-600 shadow-xs">
                          <Lock className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <span className="text-xs font-bold block text-slate-900">
                          {isOpen ? 'Cửa Đang Mở' : 'Cửa Đang Khóa'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium">
                          {isOpen ? 'Sẵn sàng nạp/lấy hàng' : 'Chốt khóa an toàn'}
                        </span>
                      </div>
                    </div>

                    {/* Inside Package Tag */}
                    {(slot.status === 'DEPOSITED' || slot.status === 'OVERDUE' || (isTarget && currentWeight > 0.05)) && (
                      <div className="flex items-center gap-1 bg-blue-50/90 border border-blue-200/80 px-2 py-0.5 rounded-full text-[10px] text-blue-700 font-bold shadow-2xs">
                        <Box className="w-3 h-3" />
                        <span>Có kiện</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Dual-Sensor Real-Time Readout Box */}
              <div className="mt-2 pt-2.5 border-t border-slate-100/70 grid grid-cols-2 gap-2 text-[11px] font-mono">
                {/* 1. MC-38 Magnetic Door Sensor */}
                <div className="liquid-glass-subtle p-2.5 rounded-2xl border border-white/70 flex flex-col shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">Cảm biến cửa</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-2 h-2 rounded-full ${isOpen ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'}`} />
                    <span className={`font-bold ${isOpen ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {isOpen ? 'HỞ CỬA' : 'ĐÓNG KÍN'}
                    </span>
                  </div>
                </div>

                {/* 2. HX711 Load Cell Scale */}
                <div className="liquid-glass-subtle p-2.5 rounded-2xl border border-white/70 flex flex-col shadow-2xs">
                  <span className="text-[9px] text-slate-400 font-medium uppercase tracking-wider">Trọng lượng</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Weight className="w-3.5 h-3.5 text-blue-600" />
                    <span className="font-bold text-slate-900">
                      {Number(currentWeight).toFixed(2)} kg
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
