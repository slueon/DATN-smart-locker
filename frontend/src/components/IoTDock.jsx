import React, { useState, useEffect } from 'react';
import { Terminal, ChevronUp, ChevronDown } from 'lucide-react';
import { mqttApi } from '../services/api';

export default function IoTDock() {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState([
    { id: 1, time: '16:45:02', topic: 'ptit/chung2004/compartment/1/status', msg: 'HX711 Ngăn #1: 125.5g • MC-38 Cửa đóng (has_item: 1)', level: 'info' },
    { id: 2, time: '16:48:15', topic: 'ptit/locker/open', msg: 'Lệnh mở Solenoid 12V Ngăn #1 (0,deposit) [3000ms]', level: 'success' },
    { id: 3, time: '16:52:30', topic: 'ptit/verified/shipper', msg: 'Xác thực Shipper DynamicToken thành công (code: 1)', level: 'info' },
    { id: 4, time: '16:55:00', topic: 'ptit/chung2004/compartment/2/status', msg: 'HX711 Ngăn #2: 0.0g • MC-38 Cửa đóng (has_item: 0)', level: 'success' }
  ]);

  useEffect(() => {
    // Tự động kéo nhật ký sự kiện và lệnh MQTT thực tế từ Backend mỗi 5s
    const fetchRecentLogs = async () => {
      try {
        const res = await mqttApi.getRecentLogs();
        if (res?.data?.data) {
          const { commands, events } = res.data.data;
          const liveLogs = [];

          if (Array.isArray(events) && events.length > 0) {
            events.slice(-5).forEach((ev) => {
              const time = ev.createdAt ? new Date(ev.createdAt).toLocaleTimeString('vi-VN') : new Date().toLocaleTimeString('vi-VN');
              let topic = 'ptit/chung2004/compartment/1/status';
              if (ev.eventType && ev.eventType.startsWith('HW_MQTT_')) {
                topic = ev.eventType.replace('HW_MQTT_', '').replace(/_/g, '/');
              }
              liveLogs.push({
                id: `ev-${ev.eventId || Math.random()}`,
                time,
                topic,
                msg: ev.eventPayload || ev.eventType,
                level: 'info'
              });
            });
          }

          if (Array.isArray(commands) && commands.length > 0) {
            commands.slice(-5).forEach((cmd) => {
              const time = cmd.sentAt ? new Date(cmd.sentAt).toLocaleTimeString('vi-VN') : new Date().toLocaleTimeString('vi-VN');
              const espIdx = cmd.compartmentId ? (cmd.compartmentId > 0 ? cmd.compartmentId - 1 : cmd.compartmentId) : 0;
              const mode = (cmd.commandType && cmd.commandType.toUpperCase().includes('DEPOSIT')) ? 'deposit' : 'pickup';
              liveLogs.push({
                id: `cmd-${cmd.commandId || Math.random()}`,
                time,
                topic: 'ptit/locker/open',
                msg: `Lệnh mở Solenoid 12V (${espIdx},${mode}) - Ngăn #${cmd.compartmentId}`,
                level: 'success'
              });
            });
          }

          if (liveLogs.length > 0) {
            setLogs((prev) => {
              const combined = [...liveLogs.reverse(), ...prev];
              // Loại bỏ log trùng ID và giữ tối đa 20 dòng
              const unique = Array.from(new Map(combined.map((item) => [item.id, item])).values());
              return unique.slice(0, 20);
            });
          }
        }
      } catch (err) {
        // Fallback giữ nguyên logs nếu Backend chưa khởi chạy
      }
    };

    fetchRecentLogs();
    const timer = setInterval(fetchRecentLogs, 6000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed bottom-4 right-4 sm:right-6 z-40 max-w-md w-full select-none">
      <div className="liquid-glass-dark text-slate-100 rounded-3xl shadow-2xl overflow-hidden transition-all duration-300">
        {/* Dynamic Island Capsule Bar */}
        <div
          onClick={() => setExpanded(!expanded)}
          className="px-4 py-2.5 flex items-center justify-between cursor-pointer hover:bg-white/[0.06] transition"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-bold text-slate-100 tracking-wide text-xs">ESP32 Hardware Bridge</span>
            <span className="text-[10px] bg-white/10 text-emerald-300 font-mono px-2 py-0.5 rounded-full border border-white/10">
              Live MQTT
            </span>
          </div>

          <button className="text-slate-400 hover:text-white p-1 rounded-full transition cursor-pointer hover:bg-white/10">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>

        {/* Expanded Console Window */}
        {expanded && (
          <div className="p-3.5 bg-black/40 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1.5 border-t border-white/10 divide-y divide-white/5">
            {logs.map((log) => (
              <div key={log.id} className="pt-1.5 first:pt-0 flex items-start gap-2">
                <span className="text-slate-400 text-[10px] shrink-0 font-mono">[{log.time}]</span>
                <span className="text-blue-400 text-[10px] shrink-0 truncate max-w-28 font-mono">[{log.topic}]</span>
                <span className={log.level === 'success' ? 'text-emerald-300' : 'text-slate-200'}>
                  {log.msg}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
