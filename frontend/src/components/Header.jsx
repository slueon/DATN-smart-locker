import React, { useState, useEffect } from 'react';
import {
  Bell, ShoppingCart, CheckCheck, X,
  ChevronRight, Package
} from 'lucide-react';
import { store } from '../services/store';

export default function Header({
  activeTab,
  setActiveTab,
  currentUser,
  onToggleCartDrawer,
  cartCount,
  selectedStation,
  setSelectedStation
}) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (currentUser?.phone) {
      setNotifications(store.getNotifications(currentUser.phone));
    }
    const handleNotifUpdate = () => {
      if (currentUser?.phone) {
        setNotifications(store.getNotifications(currentUser.phone));
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
      case 'ecommerce':
        return { category: 'Dịch vụ khách hàng', title: 'Cửa hàng mua sắm trực tuyến' };
      case 'cart':
        return { category: 'Dịch vụ khách hàng', title: 'Giỏ hàng & Điểm nhận tủ' };
      case 'customer':
        return { category: 'Dịch vụ khách hàng', title: 'Bưu kiện & Tra cứu mở tủ' };
      case 'shipper':
        return { category: 'Vận hành giao nhận', title: 'Cổng Shipper & Xác thực cảm biến' };
      case 'admin':
        return { category: 'Quản trị hệ thống', title: 'Bảng điều khiển KPI & Vận hành' };
      default:
        return { category: 'SmartLocker', title: 'Tổng quan' };
    }
  };

  const breadcrumb = getBreadcrumb();

  return (
    <header className="h-16 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 select-none">
      {/* Breadcrumb Path */}
      <div className="flex items-center gap-2 text-xs min-w-0">
        <span className="text-slate-400 hidden sm:inline">{breadcrumb.category}</span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline" />
        <span className="font-semibold text-slate-900 truncate">{breadcrumb.title}</span>
      </div>

      {/* Right Command Actions */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Slide-over Cart Button (Chỉ dành cho khách hàng) */}
        {currentUser?.role === 'CUSTOMER' && (
          <button
            onClick={onToggleCartDrawer}
            className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition border border-slate-200/80 cursor-pointer flex items-center gap-1.5"
            title="Xem giỏ hàng"
          >
            <ShoppingCart className="w-4 h-4" />
            {cartCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                {cartCount}
              </span>
            )}
          </button>
        )}

        {/* Notifications Bell */}
        {currentUser && (
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition border border-slate-200/80 cursor-pointer"
              title="Thông báo mã nhận & OTP"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notification Drawer Popover */}
            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-50 text-slate-800 animate-in fade-in duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">Thông Báo Nhận Hàng</span>
                      <span className="text-[10px] text-slate-400">{notifications.length} thông báo trong hệ thống</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {unreadCount > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-blue-50 px-2 py-1 rounded-md"
                      >
                        <CheckCheck className="w-3 h-3" /> Đã đọc
                      </button>
                    )}
                    <button
                      onClick={() => setShowNotifs(false)}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {notifications.length === 0 ? (
                    <div className="text-center py-6">
                      <Package className="w-7 h-7 text-slate-300 mx-auto mb-1" />
                      <p className="text-xs text-slate-400">Chưa có thông báo nào.</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          n.type === 'OTP_REQUEST'
                            ? 'bg-amber-50/60 border-amber-200/80 text-amber-900'
                            : 'bg-slate-50 border-slate-200/60 text-slate-700 hover:bg-slate-100/60'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-900 text-xs">
                            {n.title}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
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
