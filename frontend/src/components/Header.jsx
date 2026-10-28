import React, { useState, useEffect } from 'react';
import {
  Bell, CheckCheck, X,
  ChevronRight, Package, Radio, Sparkles,
  AlertTriangle, CheckCircle2, Key, Info
} from 'lucide-react';
import { store } from '../services/store';

export default function Header({
  activeTab,
  setActiveTab,
  currentUser
}) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [filterNotifType, setFilterNotifType] = useState('ALL');

  useEffect(() => {
    if (currentUser) {
      setNotifications(store.getNotifications(currentUser.phone, currentUser.role));
    }
    const handleNotifUpdate = () => {
      if (currentUser) {
        setNotifications(store.getNotifications(currentUser.phone, currentUser.role));
      }
    };
    window.addEventListener('smart_locker_notifs_updated', handleNotifUpdate);
    return () => window.removeEventListener('smart_locker_notifs_updated', handleNotifUpdate);
  }, [currentUser]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkAllRead = () => {
    store.markAllNotificationsRead(currentUser?.phone);
  };

  const getBreadcrumb = () => {
    switch (activeTab) {
      case 'customer':
        return { category: 'Dịch vụ khách hàng', title: 'Bưu kiện & Tra cứu mở tủ' };
      case 'shipper':
        return { category: 'Vận hành giao nhận', title: 'Cổng Shipper & Nạp tủ' };
      case 'shipper-recall':
        return { category: 'Vận hành giao nhận', title: 'Thu hồi bưu kiện quá hạn (IoT 4 bước)' };
      case 'admin':
        return { category: 'Quản trị hệ thống', title: 'Bảng điều khiển KPI & Vận hành' };
      case 'gis-map':
        return { category: 'Mạng lưới bản đồ GIS', title: 'Bản đồ giám sát trạm tủ WGS84' };
      default:
        return { category: 'SmartLocker', title: 'Tổng quan' };
    }
  };

  const breadcrumb = getBreadcrumb();

  const filteredNotifs = notifications.filter((n) => {
    if (filterNotifType === 'OVERDUE') return n.type === 'OVERDUE_ALERT';
    if (filterNotifType === 'OTP') return n.type === 'OTP_REQUEST';
    return true;
  });

  return (
    <header className="h-16 liquid-glass border-b border-white/60 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 select-none shadow-[0_4px_30px_rgba(31,38,135,0.05)]">
      {/* Breadcrumb Path & Station Pill */}
      <div className="flex items-center gap-3 text-xs min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-slate-400 hidden sm:inline font-medium">{breadcrumb.category}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline shrink-0" />
          <span className="font-bold text-slate-900 truncate">{breadcrumb.title}</span>
        </div>

        {/* Real-time Telemetry Pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100/70 backdrop-blur-md border border-slate-200/60 text-[11px] text-slate-600 font-medium shadow-2xs">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-slate-800">
            Hệ Thống Trạm PTIT
          </span>
          <span className="text-slate-300">|</span>
          <span className="font-mono text-emerald-600 font-bold">Online 14ms</span>
        </div>
      </div>

      {/* Right Command Actions */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Notifications Bell */}
        {currentUser && (
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative p-2.5 text-slate-600 hover:text-slate-900 hover:bg-white/90 rounded-2xl transition-all border border-slate-200/70 cursor-pointer shadow-xs hover:shadow-sm"
              title="Thông báo mã nhận & OTP"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse shadow-xs">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Drawer Popover */}
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white/95 backdrop-blur-2xl border border-white/90 rounded-3xl shadow-2xl p-4 z-50 text-slate-800 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-2xl bg-blue-50 text-blue-600 border border-blue-200/60 shadow-2xs">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        {currentUser?.role === 'SHIPPER' ? 'Thông Báo Điều Phối Shipper' : 'Thông Báo Hệ Thống'}
                      </span>
                      <span className="text-[10px] text-slate-400">{notifications.length} bản ghi thông báo</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/60 transition"
                      >
                        <CheckCheck className="w-3 h-3" /> Đã đọc
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifs(false)}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 mb-3">
                  <button
                    onClick={() => setFilterNotifType('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      filterNotifType === 'ALL'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Tất cả ({notifications.length})
                  </button>
                  <button
                    onClick={() => setFilterNotifType('OTP')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      filterNotifType === 'OTP'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Mã OTP / Nhận
                  </button>
                  <button
                    onClick={() => setFilterNotifType('OVERDUE')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                      filterNotifType === 'OVERDUE'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Cảnh báo quá hạn
                  </button>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {filteredNotifs.length === 0 ? (
                    <div className="text-center py-8">
                      <Package className="w-8 h-8 text-slate-300 mx-auto mb-1.5" />
                      <p className="text-xs text-slate-400 font-medium">Chưa có thông báo nào trong mục này.</p>
                    </div>
                  ) : (
                    filteredNotifs.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          n.type === 'OVERDUE_ALERT'
                            ? 'bg-rose-50/90 border-rose-300/80 text-rose-950 font-medium shadow-2xs'
                            : n.type === 'RECALL_SUCCESS'
                            ? 'bg-emerald-50/90 border-emerald-300/80 text-emerald-950 font-medium'
                            : n.type === 'OTP_REQUEST'
                            ? 'bg-amber-50/80 border-amber-300/80 text-amber-950 font-medium'
                            : 'bg-slate-50 border-slate-200/80 text-slate-700 hover:bg-slate-100/70'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                            {n.type === 'OVERDUE_ALERT' && <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                            {n.type === 'OTP_REQUEST' && <Key className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                            {n.type === 'RECALL_SUCCESS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                            {n.title}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {new Date(n.createdAt).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-slate-600">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
