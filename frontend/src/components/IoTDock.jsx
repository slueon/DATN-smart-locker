import React, { useState, useEffect } from 'react';
import { Terminal, ChevronUp, ChevronDown, Wifi, Radio, Cpu, Check, Activity } from 'lucide-react';

export default function IoTDock() {
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState([
    { id: 1, time: '16:45:02', topic: 'iot/esp32/heartbeat', msg: 'NodeMCU KTX A1: Ping 12ms, 3/3 sensor OK', level: 'info' },
    { id: 2, time: '16:48:15', topic: 'iot/locker/relay', msg: 'Relay #2 Solenoid status: LOCKED', level: 'success' },
    { id: 3, time: '16:52:30', topic: 'iot/hx711/weight', msg: 'HX711 Load Cell Compartment #2 calibrated: 0.85kg', level: 'info' },
    { id: 4, time: '16:55:00', topic: 'iot/security/pessimistic_lock', msg: 'Pessimistic Write Lock held on Slot #2 - Tx committed', level: 'success' }
  ]);

  useEffect(() => {
    // Tự động sinh nhịp tim giả lập mỗi 20s
    const timer = setInterval(() => {
      const now = new Date().toLocaleTimeString('vi-VN');
      const newLog = {
        id: Date.now(),
        time: now,
        topic: 'iot/esp32/telemetry',
        msg: `Heartbeat sync OK • RSSI -58dBm • Voltage 5.02V`,
        level: 'info'
      };
      setLogs((prev) => [newLog, ...prev.slice(0, 15)]);
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed bottom-0 right-4 sm:right-6 z-40 max-w-lg w-full select-none">
      <div className="bg-slate-900 text-slate-100 rounded-t-xl border border-b-0 border-slate-700 shadow-xl overflow-hidden">
        {/* Dock Bar Header */}
        <div
          onClick={() => setExpanded(!expanded)}
          className="px-3.5 py-2 flex items-center justify-between cursor-pointer hover:bg-slate-800/80 transition"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Terminal className="w-3.5 h-3.5 text-blue-400" />
            <span className="font-semibold text-slate-200">ESP32 Telemetry & MQTT Stream</span>
            <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.2 rounded border border-slate-700">
              Live Feed
            </span>
          </div>

          <button className="text-slate-400 hover:text-white p-0.5">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Expanded Console Window */}
        {expanded && (
          <div className="p-3 bg-slate-950 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1.5 border-t border-slate-800 divide-y divide-slate-800/50">
            {logs.map((log) => (
              <div key={log.id} className="pt-1.5 first:pt-0 flex items-start gap-2">
                <span className="text-slate-500 text-[10px] shrink-0">[{log.time}]</span>
                <span className="text-blue-400 text-[10px] shrink-0 truncate max-w-28">[{log.topic}]</span>
                <span className={log.level === 'success' ? 'text-emerald-400' : 'text-slate-300'}>
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
