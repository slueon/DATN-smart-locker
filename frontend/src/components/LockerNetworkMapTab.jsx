import React, { useState, useEffect } from 'react';
import LockerMap, { getLockerStatusInfo } from './LockerMap';
import { store } from '../services/store';
import { lockerApi } from '../services/api';
import {
  MapPin, Search, Filter, RefreshCw, Cpu, Activity,
  Layers, CheckCircle2, AlertTriangle, ArrowRight,
  Package, Radio, Sparkles
} from 'lucide-react';

export default function LockerNetworkMapTab({ currentUser, onNavigateToPickup, onNavigateToShipper }) {
  const [lockers, setLockers] = useState(() => store.getLockers());
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // 'ALL', 'AVAILABLE', 'FULL', 'OFFLINE'
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadLockerData();
    const handleUpdate = () => loadLockerData();
    window.addEventListener('smart_locker_lockers_updated', handleUpdate);
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => {
      window.removeEventListener('smart_locker_lockers_updated', handleUpdate);
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
    };
  }, []);

  const loadLockerData = async () => {
    setIsRefreshing(true);
    // 1. Lấy dữ liệu từ local store trước
    const local = store.getLockers();
    setLockers(local);

    // 2. Thử đồng bộ từ Backend API nếu máy chủ online
    try {
      const res = await lockerApi.getAll();
      if (res.data?.data && res.data.data.length > 0) {
        const backendLockers = res.data.data;
        const defaultMap = new Map(store.getLockers().map((dl) => [dl.lockerId, dl]));
        const fullLockers = await Promise.all(
          backendLockers.map(async (l) => {
            const fallback = defaultMap.get(l.lockerId) || {};
            try {
              const compRes = await lockerApi.getCompartments(l.lockerId);
              const comps = compRes.data?.data && compRes.data.data.length > 0
                ? compRes.data.data
                : (fallback.compartments || []);
              const available = comps.filter((c) => c.status === 'EMPTY').length;
              return {
                ...fallback,
                ...l,
                lockerType: fallback.lockerType || (l.lockerId === 'LOCKER_HN_01' ? 'PHYSICAL' : 'SIMULATED'),
                latitude: l.latitude || fallback.latitude,
                longitude: l.longitude || fallback.longitude,
                compartments: comps,
                totalCompartments: l.totalCompartments || comps.length,
                availableCompartments: available,
              };
            } catch {
              return { ...fallback, ...l };
            }
          })
        );
        // Đảm bảo không bao giờ bị rớt trạm nếu backend chỉ trả về một phần
        const loadedIds = new Set(fullLockers.map((l) => l.lockerId));
        const missing = store.getLockers().filter((l) => !loadedIds.has(l.lockerId));
        const finalAllLockers = [...fullLockers, ...missing];
        setLockers(finalAllLockers);
        localStorage.setItem('smart_locker_lockers_data', JSON.stringify(finalAllLockers));
      }
    } catch {
      // Backend offline: Giữ nguyên dữ liệu local
    } finally {
      setIsRefreshing(false);
    }
  };

  // Lọc dữ liệu trạm tủ theo tìm kiếm và trạng thái
  const filteredLockers = lockers.filter((l) => {
    const statusInfo = getLockerStatusInfo(l);
    if (filterStatus !== 'ALL' && statusInfo.statusKey !== filterStatus) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = (l.name || '').toLowerCase().includes(q);
      const matchAddr = (l.address || '').toLowerCase().includes(q);
      const matchId = (l.lockerId || '').toLowerCase().includes(q);
      return matchName || matchAddr || matchId;
    }
    return true;
  });

  const selectedLocker = lockers.find((l) => l.lockerId === selectedLockerId) || lockers[0];

  const totalLockers = lockers.length;
  const totalSlots = lockers.reduce((acc, cur) => acc + (cur.totalCompartments ?? (Array.isArray(cur.compartments) ? cur.compartments.length : 3)), 0);
  const totalAvailableSlots = lockers.reduce((acc, cur) => acc + (cur.availableCompartments ?? (Array.isArray(cur.compartments) ? cur.compartments.filter(c => c.status === 'EMPTY').length : 0)), 0);
  const onlineCount = lockers.filter((l) => l.status !== 'OFFLINE' && l.connectionStatus !== 'OFFLINE' && l.connection_status !== 'OFFLINE').length;

  const handleAction = (locker) => {
    if (currentUser?.role === 'SHIPPER' && onNavigateToShipper) {
      onNavigateToShipper(locker.lockerId);
    } else if (onNavigateToPickup) {
      onNavigateToPickup(locker.lockerId);
    }
  };

  const actionBtnLabel = currentUser?.role === 'SHIPPER'
    ? 'Đến nạp hàng tại tủ này'
    : 'Xem bưu kiện của tôi';

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Title (Apple Liquid Glass) */}
      <div className="liquid-glass-card rounded-3xl p-6 sm:p-8 border border-white/90 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-mono font-bold text-blue-600 tracking-wider uppercase bg-blue-50/80 px-2.5 py-0.5 rounded-md border border-blue-200/60">
                Bản Đồ Số • Leaflet GIS
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Bản Đồ Mạng Lưới Trạm Tủ
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 mt-1.5 max-w-2xl leading-relaxed">
              Vị trí địa lý, sức chứa thực tế và trạng thái kết nối của mạng lưới trạm tủ thời gian thực.
            </p>
          </div>

          <button
            onClick={loadLockerData}
            disabled={isRefreshing}
            className="ios-btn self-start lg:self-center px-5 py-3 rounded-2xl bg-white/80 hover:bg-white text-slate-800 text-xs font-bold border border-white/90 transition flex items-center gap-2 shadow-md cursor-pointer shrink-0 disabled:opacity-50 active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Đang đồng bộ...' : 'Làm mới trạm tủ'}</span>
          </button>
        </div>

        {/* Ambient Glow */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* 2. KPI Summary Metrics (Bento Grid) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="liquid-glass-card rounded-3xl p-5 border border-white/90 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
            <span>Tổng Trạm Tủ</span>
            <div className="w-7 h-7 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <MapPin className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold font-mono text-slate-900">{totalLockers} Trạm</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Phân tán đô thị</div>
        </div>

        <div className="liquid-glass-card rounded-3xl p-5 border border-white/90 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
            <span>Ngăn Trống Khả Dụng</span>
            <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold font-mono text-emerald-600">{totalAvailableSlots} / {totalSlots}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Sẵn sàng nhận hàng</div>
        </div>

        <div className="liquid-glass-card rounded-3xl p-5 border border-white/90 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
            <span>Trạng Thái Kết Nối</span>
            <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Radio className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold font-mono text-slate-900">{onlineCount} / {totalLockers} Online</div>
          <div className="text-[11px] text-emerald-600 font-medium mt-0.5">Kết nối trực tuyến</div>
        </div>

        <div className="liquid-glass-card rounded-3xl p-5 border border-white/90 shadow-md">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
            <span>Độ Phủ Bản Đồ</span>
            <div className="w-7 h-7 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold font-mono text-slate-900">100% WGS84</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Bán kính 7km</div>
        </div>
      </div>

      {/* 3. Filter & Search Controls (iOS Segmented Controls) */}
      <div className="liquid-glass-subtle rounded-3xl p-4 border border-white/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 shadow-sm">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm kiếm trạm tủ (KTX A1, Thư Viện)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/80 border border-white/90 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-2xs transition"
          />
        </div>

        {/* 3-Color Status Filter Pills */}
        <div className="ios-segmented-tray flex items-center gap-1 overflow-x-auto p-1">
          {[
            { key: 'ALL', label: 'Tất cả' },
            { key: 'AVAILABLE', label: '🟢 Rỗi' },
            { key: 'FULL', label: '🔴 Bận' },
            { key: 'OFFLINE', label: '⚪ Mất kết nối' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilterStatus(item.key)}
              className={`ios-segmented-pill whitespace-nowrap text-xs ${
                filterStatus === item.key ? 'active font-bold text-blue-700' : 'text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Main Interactive Canvas (Map + Station Detail Cards) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column: Full Interactive Leaflet Map (2 Cols) */}
        <div className="lg:col-span-2 min-h-[580px] h-[580px] rounded-3xl overflow-hidden shadow-2xl border border-white/90">
          <LockerMap
            lockers={filteredLockers}
            selectedLockerId={selectedLockerId}
            onSelectLocker={(id) => setSelectedLockerId(id)}
            height="100%"
            minHeight="580px"
            onActionClick={handleAction}
            actionButtonLabel={actionBtnLabel}
          />
        </div>

        {/* Right Column: Station Details & Cards (1 Col) */}
        <div className="space-y-4 flex flex-col justify-start">
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Danh sách trạm tủ ({filteredLockers.length})
              </span>
              <span className="text-[11px] text-slate-400">Nhấp thẻ để định vị</span>
            </div>

            <div className="max-h-[580px] overflow-y-auto pr-1 space-y-3 custom-scrollbar">
            {filteredLockers.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 liquid-glass-card rounded-3xl border border-white/90 shadow-sm">
                Không tìm thấy trạm tủ phù hợp với bộ lọc hiện tại.
              </div>
            ) : (
              filteredLockers.map((locker) => {
                const isSelected = locker.lockerId === selectedLockerId;
                const statusInfo = getLockerStatusInfo(locker);
                const avail = locker.availableCompartments ?? (Array.isArray(locker.compartments) ? locker.compartments.filter(c => c.status === 'EMPTY').length : 0);
                const total = locker.totalCompartments ?? (Array.isArray(locker.compartments) ? locker.compartments.length : 2);

                return (
                  <div
                    key={locker.lockerId}
                    onClick={() => setSelectedLockerId(locker.lockerId)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                      isSelected
                        ? 'liquid-glass-card border-blue-500/80 shadow-lg shadow-blue-500/15 ring-2 ring-blue-500/30 -translate-y-0.5'
                        : 'liquid-glass-subtle border-white/80 hover:border-slate-300 hover:bg-white/90 shadow-2xs'
                    }`}
                  >
                    {/* Top Row: Station ID & Status Pill */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-mono font-bold text-slate-700 px-2 py-0.5 rounded-lg bg-white/80 border border-white/90">
                        {locker.lockerId}
                      </span>

                      <span
                        className="text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border"
                        style={{
                          backgroundColor: statusInfo.badgeBg,
                          color: statusInfo.badgeText,
                          borderColor: statusInfo.borderColor,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: statusInfo.dotColor }}
                        />
                        {statusInfo.label}
                      </span>
                    </div>

                    {/* Locker Name & Address */}
                    <h3 className="text-sm font-bold text-slate-900 mb-1">
                      {locker.name}
                    </h3>
                    <p className="text-xs text-slate-500 flex items-start gap-1 leading-relaxed mb-3 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <span>{locker.address}</span>
                    </p>

                    {/* Capacity Progress Bar */}
                    <div className="space-y-1.5 mb-3">
                      <div className="flex justify-between text-[11px] font-medium text-slate-500">
                        <span>Ngăn khả dụng:</span>
                        <span className="font-mono text-slate-900"><b>{avail}</b> / {total} ngăn</span>
                      </div>
                      <div className="w-full bg-slate-200/60 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${(avail / total) * 100}%`,
                            backgroundColor: statusInfo.dotColor,
                          }}
                        />
                      </div>
                    </div>

                    {/* Coordinates & Action */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 text-[10px]">
                      <span className="font-mono text-slate-400">
                        WGS84: {locker.latitude.toFixed(4)}, {locker.longitude.toFixed(4)}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(locker);
                        }}
                        className="ios-btn px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold flex items-center gap-1 transition shadow-md shadow-blue-600/20 cursor-pointer active:scale-95"
                      >
                        <span>{currentUser?.role === 'SHIPPER' ? 'Nạp hàng' : 'Bưu kiện'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
