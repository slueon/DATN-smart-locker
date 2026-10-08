import React, { useState, useEffect } from 'react';
import {
  ShoppingBag, ShoppingCart, Package, Truck, Shield,
  LogOut, Bell, CheckCheck, X, Cpu
} from 'lucide-react';
import { store } from '../services/store';

export default function Navbar({ activeTab, setActiveTab, currentUser, onLogout }) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [cartCount, setCartCount] = useState(() => store.getCartCount());

  // Load notifications & cart count from store
  useEffect(() => {
    if (currentUser?.phone) {
      setNotifications(store.getNotifications(currentUser.phone));
    }
    const handleNotifUpdate = () => {
      if (currentUser?.phone) {
        setNotifications(store.getNotifications(currentUser.phone));
      }
    };
    const handleCartUpdate = () => {
      setCartCount(store.getCartCount());
    };

    window.addEventListener('smart_locker_notifs_updated', handleNotifUpdate);
    window.addEventListener('smart_locker_cart_updated', handleCartUpdate);
    return () => {
      window.removeEventListener('smart_locker_notifs_updated', handleNotifUpdate);
      window.removeEventListener('smart_locker_cart_updated', handleCartUpdate);
    };
  }, [currentUser]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleMarkAllRead = () => {
    store.markAllNotificationsRead(currentUser?.phone);
  };

  const getNavItems = () => {
    if (!currentUser) return [];
    const role = currentUser.role;

    if (role === 'CUSTOMER') {
      return [
        { id: 'ecommerce', label: 'Cửa hàng', icon: ShoppingBag },
        {
          id: 'cart',
          label: 'Giỏ hàng',
          icon: ShoppingCart,
          badge: cartCount > 0 ? cartCount : null,
        },
        { id: 'customer', label: 'Đơn hàng & Tủ nhận', icon: Package },
      ];
    }

    if (role === 'SHIPPER') {
      return [
        { id: 'shipper', label: 'Cổng Shipper gửi hàng', icon: Truck },
      ];
    }

    if (role === 'ADMIN') {
      return [
        { id: 'admin', label: 'Quản trị hệ thống', icon: Shield },
        { id: 'simulator', label: 'Mô phỏng Kiosk IoT', icon: Cpu },
        { id: 'ecommerce', label: 'Cửa hàng', icon: ShoppingBag },
        { id: 'cart', label: 'Giỏ hàng', icon: ShoppingCart },
        { id: 'shipper', label: 'Cổng Shipper', icon: Truck },
      ];
    }

    return [];
  };

  const navItems = getNavItems();

  const getRoleBadge = (role) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-semibold px-2 py-0.5 rounded-md">
            Quản trị viên
          </span>
        );
      case 'SHIPPER':
        return (
          <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold px-2 py-0.5 rounded-md">
            Nhân viên giao nhận
          </span>
        );
      case 'CUSTOMER':
        return (
          <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold px-2 py-0.5 rounded-md">
            Khách hàng
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <header className="bg-white/95 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200/80 shadow-xs notranslate">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Platform Name */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-xs">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-slate-900 leading-tight">
                  SmartLocker
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  Sẵn sàng
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-normal hidden sm:block">
                Hệ thống Tủ Giao Nhận Thông Minh PTIT
              </span>
            </div>
          </div>

          {/* Navigation Segmented Controls (Shadcn Tabs Style) */}
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60 overflow-x-auto max-w-full">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-white text-blue-600 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-1 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* User profile, notifications, logout */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Notification Bell */}
            {currentUser && currentUser.role === 'CUSTOMER' && (
              <div className="relative">
                <button
                  onClick={() => setShowNotifs(!showNotifs)}
                  className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition border border-slate-200/80 cursor-pointer"
                  title="Thông báo mã nhận hàng & OTP"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-xs">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Dropdown Notification Box */}
                {showNotifs && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-50 text-slate-800">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                          <Bell className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-900 block">Thông Báo Nhận Hàng</span>
                          <span className="text-[10px] text-slate-500">{notifications.length} thông báo mới nhất</span>
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
                          <Package className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                          <p className="text-xs text-slate-500">Chưa có thông báo nào.</p>
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

            {/* User Profile Chip */}
            {currentUser && (
              <div className="flex items-center gap-2.5 bg-slate-50 pl-3 pr-2 py-1.5 rounded-xl border border-slate-200/80">
                <div className="text-right hidden sm:block">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-xs font-semibold text-slate-900">{currentUser.fullName}</span>
                    {getRoleBadge(currentUser.role)}
                  </div>
                  <span className="text-[11px] text-slate-500 block font-mono">{currentUser.phone}</span>
                </div>
                <button
                  onClick={onLogout}
                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                  title="Đăng xuất khỏi tài khoản"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
