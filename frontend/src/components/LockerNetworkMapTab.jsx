import React, { useState, useEffect } from 'react';
import LockerMap, { getLockerStatusInfo } from './LockerMap';
import { store } from '../services/store';
import { lockerApi, adminApi, mqttApi } from '../services/api';
import { getLockerHealth, TONE_HEX, formatRelativeTime } from '../utils/lockerHealth';
import {
  MapPin, Search, Filter, RefreshCw, Cpu, Activity,
  Layers, CheckCircle2, AlertTriangle, ArrowRight,
  Package, Radio, Sparkles, X, Unlock, Clock, ShieldAlert,
  Check, AlertCircle
} from 'lucide-react';

export default function LockerNetworkMapTab({ currentUser, onNavigateToPickup, onNavigateToShipper }) {
  const [lockers, setLockers] = useState(() => store.getLockers());
  const [selectedLockerId, setSelectedLockerId] = useState('LOCKER_HN_01');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('ALL'); // ADMIN: tone sức khoẻ; khác: statusKey
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * GĐ8 — dữ liệu riêng cho màn ADMIN.
   *
   * <p>`overdueByLocker`: số đơn quá hạn theo tủ, từ `adminApi.getOrders('OVERDUE')` (API mới của
   * GĐ7). Đây là thứ admin thật sự cần thấy trên bản đồ: chỗ nào đang có hàng tồn.
   *
   * <p>`detail`: chi tiết trạm đang mở (ngăn tủ + 20 lệnh mở gần nhất). Cố ý tải theo nhu cầu —
   * nếu tải sẵn cho 10 tủ thì mở tab là 10 request, trong khi admin chỉ xem 1–2 trạm.
   */
  const [overdueByLocker, setOverdueByLocker] = useState({});
  const [detail, setDetail] = useState(null); // { locker, compartments, logs, loadingCompartments, loadingLogs, error }
  const [unlockTarget, setUnlockTarget] = useState(null); // ngăn đang chờ xác nhận mở khẩn cấp
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockMsg, setUnlockMsg] = useState(null);

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

  // GĐ8 — nhánh ADMIN và nhánh CUSTOMER/SHIPPER có hành vi KHÁC nhau.
  // Nhánh không phải ADMIN phải giữ nguyên 100% hành vi cũ (lọc theo sức chứa, nút điều hướng).
  const isAdmin = currentUser?.role === 'ADMIN';

  // Lọc dữ liệu trạm tủ theo tìm kiếm và trạng thái.
  // ADMIN lọc theo SỨC KHOẺ (suy từ lastHeartbeat); vai trò khác giữ lọc theo sức chứa như cũ.
  const filteredLockers = lockers.filter((l) => {
    if (isAdmin) {
      if (filterStatus !== 'ALL' && getLockerHealth(l).tone !== filterStatus) {
        return false;
      }
    } else {
      const statusInfo = getLockerStatusInfo(l);
      if (filterStatus !== 'ALL' && statusInfo.statusKey !== filterStatus) {
        return false;
      }
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

  // GĐ8 — ĐẾM ONLINE TỪ `lastHeartbeat`, KHÔNG dùng `connectionStatus`.
  // Lý do: DB ghi `ONLINE` cho cả 10 tủ dù có tủ im 3 ngày (backend không có scheduler chuyển
  // OFFLINE). Code cũ đếm theo `connectionStatus` nên luôn ra 10/10 — con số vô nghĩa.
  const onlineCount = lockers.filter((l) => getLockerHealth(l).tone === 'emerald').length;
  // Số trạm KHÔNG online (vàng + đỏ) — dùng thay KPI "100% WGS84" cứng.
  const offlineCount = totalLockers - onlineCount;

  const handleAction = (locker) => {
    if (isAdmin) {
      // GĐ8 — ADMIN không có tab `customer` (App.jsx chặn), nên nút cũ `onNavigateToPickup`
      // là NÚT CHẾT. Đổi thành mở popup chi tiết trạm (ngăn tủ + lịch sử mở tủ).
      openLockerDetail(locker);
      return;
    }
    if (currentUser?.role === 'SHIPPER' && onNavigateToShipper) {
      onNavigateToShipper(locker.lockerId);
    } else if (onNavigateToPickup) {
      onNavigateToPickup(locker.lockerId);
    }
  };

  const actionBtnLabel = isAdmin
    ? 'Xem chi tiết trạm'
    : currentUser?.role === 'SHIPPER'
    ? 'Đến nạp hàng tại tủ này'
    : 'Xem bưu kiện của tôi';

  /**
   * GĐ8 ý 2 — số đơn QUÁ HẠN theo tủ, để hiện badge đỏ trên marker.
   *
   * Chỉ ADMIN gọi: `/api/admin/orders` khoá `hasRole("ADMIN")`; vai trò khác gọi sẽ 403.
   * Lỗi API → giữ `{}` (không badge) chứ không hiện số sai — badge tồn kho sai còn tệ hơn
   * không có badge, vì admin sẽ đi kiểm tra một trạm không có việc gì.
   */
  useEffect(() => {
    if (!isAdmin) {
      setOverdueByLocker({});
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await adminApi.getOrders('OVERDUE');
        if (cancelled) return;
        const map = {};
        (res?.data?.data || []).forEach((o) => {
          if (!o.lockerId) return;
          map[o.lockerId] = (map[o.lockerId] || 0) + 1;
        });
        setOverdueByLocker(map);
      } catch {
        if (!cancelled) setOverdueByLocker({});
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  /**
   * GĐ8 ý 3+4 — mở chi tiết một trạm: ngăn tủ + 20 lệnh mở tủ gần nhất.
   *
   * Tải **song song** hai nguồn khi mở (không tải sẵn cho mọi tủ). Mỗi nguồn có cờ loading
   * riêng để phần này hiện được dù phần kia chậm/lỗi.
   */
  const openLockerDetail = async (locker) => {
    if (!locker) return;
    setSelectedLockerId(locker.lockerId);
    setUnlockTarget(null);
    setUnlockMsg(null);
    setDetail({
      locker,
      compartments: [],
      logs: [],
      loadingCompartments: true,
      loadingLogs: true,
      error: null,
    });

    const [compResult, logResult] = await Promise.allSettled([
      lockerApi.getCompartments(locker.lockerId),
      mqttApi.getCommandLogs(locker.lockerId, 20),
    ]);

    setDetail((prev) => {
      // Người dùng có thể đã đóng popup hoặc mở trạm khác trong lúc chờ.
      if (!prev || prev.locker.lockerId !== locker.lockerId) return prev;
      return {
        ...prev,
        compartments: compResult.status === 'fulfilled' ? (compResult.value?.data?.data || []) : [],
        logs: logResult.status === 'fulfilled' ? (logResult.value?.data?.data || []) : [],
        loadingCompartments: false,
        loadingLogs: false,
        error: compResult.status === 'rejected' || logResult.status === 'rejected'
          ? 'Một phần dữ liệu không tải được (kiểm tra quyền ADMIN hoặc backend).'
          : null,
      };
    });
  };

  /**
   * GĐ8 ý 4 — mở khoá khẩn cấp, BẮT BUỘC xác nhận 2 bước.
   *
   * <p><b>Vì sao 2 bước:</b> `lockerApi.forceUnlock` là hành động **phá huỷ dữ liệu** — backend
   * đặt ngăn về `EMPTY` và giải phóng liên kết đơn. Bấm nhầm một lần là mất dấu kiện hàng đang
   * có thật trong tủ. Vì vậy lần bấm đầu chỉ đặt `unlockTarget` (hiện hộp xác nhận), lần bấm
   * thứ hai mới thật sự gọi API.
   */
  const requestUnlock = (compIndex) => {
    setUnlockMsg(null);
    setUnlockTarget(compIndex);
  };

  const confirmUnlock = async () => {
    if (!detail?.locker || unlockTarget == null) return;
    setUnlockBusy(true);
    setUnlockMsg(null);
    try {
      await lockerApi.forceUnlock(detail.locker.lockerId, unlockTarget);
      setUnlockMsg({ type: 'success', text: `Đã mở khẩn cấp ngăn #${unlockTarget}.` });
      // Đọc lại ngăn để UI phản ánh trạng thái mới thay vì đoán.
      const res = await lockerApi.getCompartments(detail.locker.lockerId);
      setDetail((prev) => prev && prev.locker.lockerId === detail.locker.lockerId
        ? { ...prev, compartments: res?.data?.data || [] }
        : prev);
      setUnlockTarget(null);
    } catch (err) {
      setUnlockMsg({
        type: 'error',
        text: err?.response?.data?.message || 'Không mở được ngăn. Lệnh đã bị từ chối.',
      });
    } finally {
      setUnlockBusy(false);
    }
  };

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
            {/* GĐ8 — KPI cũ "100% WGS84 / Bán kính 7km" là SỐ CỨNG, không tính từ gì.
                Nay thay bằng số trạm KHÔNG online, suy thật từ `lastHeartbeat`: con số admin
                cần để biết có trạm nào đang chết. */}
            <span>Trạm mất kết nối</span>
            <div className="w-7 h-7 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className={`text-2xl font-extrabold font-mono ${offlineCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {offlineCount} / {totalLockers}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {offlineCount > 0 ? 'Cần kiểm tra — suy từ nhịp tim' : 'Tất cả trạm đều phản hồi'}
          </div>
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

        {/* 3-Color Status Filter Pills — GĐ8: ADMIN lọc theo SỨC KHOẺ, vai trò khác theo sức chứa */}
        <div className="ios-segmented-tray flex items-center gap-1 overflow-x-auto p-1">
          {(isAdmin
            ? [
                { key: 'ALL', label: 'Tất cả' },
                { key: 'emerald', label: '🟢 Online' },
                { key: 'amber', label: '🟡 Không rõ' },
                { key: 'rose', label: '🔴 Mất kết nối' },
              ]
            : [
                { key: 'ALL', label: 'Tất cả' },
                { key: 'AVAILABLE', label: '🟢 Rỗi' },
                { key: 'FULL', label: '🔴 Bận' },
                { key: 'OFFLINE', label: '⚪ Mất kết nối' },
              ]
          ).map((item) => (
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
            // GĐ8 — hai prop CHỈ truyền ở nhánh ADMIN. Nhánh CUSTOMER/SHIPPER để `undefined`
            // nên `LockerMap` chạy y hệt như trước: không badge, popup không phát sự kiện.
            getMarkerBadge={isAdmin
              ? (locker) => {
                  const count = overdueByLocker[locker.lockerId] || 0;
                  return count > 0 ? { count, tone: 'rose' } : null;
                }
              : undefined}
            onPopupOpen={isAdmin ? openLockerDetail : undefined}
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
                        {/* GĐ8 — ADMIN: nhãn phải nói đúng việc nút làm (mở chi tiết trạm),
                            không phải "Bưu kiện" như trước khi nút đó là nút chết. */}
                        <span>
                          {isAdmin
                            ? 'Chi tiết trạm'
                            : currentUser?.role === 'SHIPPER'
                            ? 'Nạp hàng'
                            : 'Bưu kiện'}
                        </span>
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

      {/* GĐ8 Ý 3+4 — CHI TIẾT TRẠM (chỉ ADMIN): ngăn tủ + lịch sử mở tủ + mở khoá khẩn cấp.
          Dữ liệu chỉ tải khi bấm "Xem chi tiết trạm" hoặc mở popup marker, không tải sẵn. */}
      {isAdmin && detail && (
        <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 shadow-lg space-y-4">
          <div className="flex items-start justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Radio className="w-4 h-4 text-blue-600" />
                {detail.locker.name} <span className="text-[10px] font-mono text-slate-500">({detail.locker.lockerId})</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {(() => {
                  const h = getLockerHealth(detail.locker);
                  return (
                    <span style={{ color: TONE_HEX[h.tone] }} className="font-semibold">
                      ● {h.label} · {h.rel}
                    </span>
                  );
                })()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setDetail(null); setUnlockTarget(null); setUnlockMsg(null); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              title="Đóng chi tiết"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {detail.error && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {detail.error}
            </div>
          )}

          {unlockMsg && (
            <div
              className={`p-2.5 rounded-xl text-[11px] ${
                unlockMsg.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {unlockMsg.text}
            </div>
          )}

          {/* Ý 4 — grid ngăn tủ */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              Ngăn tủ {detail.loadingCompartments ? '(đang tải…)' : `(${detail.compartments.length})`}
            </span>
            {!detail.loadingCompartments && detail.compartments.length === 0 && (
              <p className="text-[11px] text-slate-500 italic">Không có dữ liệu ngăn.</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {detail.compartments.map((c) => {
                const st = String(c.status || '').toUpperCase();
                const toneClass =
                  st === 'EMPTY' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : st === 'OCCUPIED' ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : st === 'RESERVED' ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-slate-100 text-slate-600 border-slate-300';
                // BẪY #1 của MAP.md: DB lưu GRAM, hiển thị kg → chia 1000.
                const kg = Number(c.currentWeight || 0) / 1000;
                return (
                  <div key={c.compartmentId ?? c.compIndex} className={`p-2.5 rounded-xl border ${toneClass}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold">#{c.compIndex}</span>
                      <span className="text-[9px] font-mono">{c.size}</span>
                    </div>
                    <div className="text-[10px] font-semibold mt-0.5">{st || 'N/A'}</div>
                    <div className="text-[10px] mt-0.5">
                      {kg.toFixed(2)} kg · {c.isDoorClosed ? 'cửa đóng' : 'cửa MỞ'}
                    </div>
                    <button
                      type="button"
                      onClick={() => requestUnlock(c.compIndex)}
                      disabled={unlockBusy}
                      className="mt-1.5 w-full text-[9px] font-bold py-1 rounded-md border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1"
                    >
                      <Unlock className="w-2.5 h-2.5" /> Mở khẩn cấp
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Xác nhận 2 bước: bấm "Mở khẩn cấp" chỉ đặt `unlockTarget`, chưa gọi API. */}
            {unlockTarget != null && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border-2 border-rose-300 space-y-2">
                <p className="text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  Xác nhận mở khẩn cấp ngăn #{unlockTarget} của {detail.locker.lockerId}?
                </p>
                <p className="text-[10px] text-rose-700">
                  Thao tác này <strong>giải phóng ngăn về EMPTY</strong> và gỡ liên kết đơn hàng
                  đang trỏ tới ngăn. Nếu bên trong còn kiện hàng thật thì dấu vết sẽ mất.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={confirmUnlock}
                    disabled={unlockBusy}
                    className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold py-2 rounded-lg cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {unlockBusy ? 'Đang gửi…' : 'Xác nhận mở'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnlockTarget(null)}
                    disabled={unlockBusy}
                    className="flex-1 bg-white border border-slate-300 text-slate-700 text-[11px] font-bold py-2 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Ý 3 — 20 lệnh mở tủ gần nhất */}
          <div>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
              <Clock className="w-3 h-3 inline mr-1" />
              Lịch sử mở tủ {detail.loadingLogs ? '(đang tải…)' : `(${detail.logs.length} lệnh gần nhất)`}
            </span>
            {!detail.loadingLogs && detail.logs.length === 0 && (
              <p className="text-[11px] text-slate-500 italic">Chưa có lệnh mở tủ nào cho trạm này.</p>
            )}
            {detail.logs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1.5 pr-3 font-semibold">Thời gian</th>
                      <th className="py-1.5 pr-3 font-semibold">Ngăn</th>
                      <th className="py-1.5 pr-3 font-semibold">Loại</th>
                      <th className="py-1.5 font-semibold">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.logs.map((log) => (
                      <tr key={log.commandId} className="border-b border-slate-100 last:border-0">
                        <td className="py-1.5 pr-3 font-mono text-slate-700">
                          {log.sentAt ? new Date(log.sentAt).toLocaleString('vi-VN') : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-700">#{log.compartmentId ?? '—'}</td>
                        <td className="py-1.5 pr-3 text-slate-700">{log.commandType || '—'}</td>
                        <td className="py-1.5">
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                              String(log.status).toUpperCase() === 'SUCCESS'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : String(log.status).toUpperCase() === 'TIMEOUT'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {log.status || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
