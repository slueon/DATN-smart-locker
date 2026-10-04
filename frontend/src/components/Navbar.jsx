import React, { useState, useEffect } from 'react';
import { ShoppingBag, ShoppingCart, Package, Truck, Shield, LogOut, Bell, CheckCheck, X } from 'lucide-react';
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
        { id: 'ecommerce', label: 'Sàn Mua Sắm', icon: ShoppingBag },
        {
          id: 'cart',
          label: 'Giỏ Hàng & Thanh Toán',
          icon: ShoppingCart,
          badge: cartCount > 0 ? cartCount : null,
        },
        { id: 'customer', label: 'Đơn Hàng Của Tôi', icon: Package },
      ];
    }

    if (role === 'SHIPPER') {
      return [
        { id: 'shipper', label: 'Cổng Shipper (Mã QR 60s & Nạp Tủ)', icon: Truck },
      ];
    }

    if (role === 'ADMIN') {
      return [
        { id: 'admin', label: 'Quản Trị Hệ Thống (KPI & Giám Sát Tủ)', icon: Shield },
        { id: 'ecommerce', label: 'Sàn Mua Sắm', icon: ShoppingBag },
        { id: 'cart', label: 'Giỏ Hàng & Thanh Toán', icon: ShoppingCart },
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
          <span className="bg-purple-500/20 text-purple-300 border border-purple-400/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
            QUẢN TRỊ
          </span>
        );
      case 'SHIPPER':
        return (
          <span className="bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
            SHIPPER
          </span>
        );
      case 'CUSTOMER':
        return (
          <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
            KHÁCH HÀNG
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-50 border-b border-slate-800 notranslate">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-bold text-lg text-white shadow-md">
              <span>SL</span>
            </div>
            <div>
              <span className="font-bold text-base tracking-wide block leading-tight">
                Smart Locker IoT
              </span>
              <span className="text-[11px] text-indigo-300 font-medium hidden sm:block">
                Hệ Thống Tủ Giao Nhận Thông Minh
              </span>
            </div>
          </div>

          {/* Navigation tabs */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/40'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden md:inline">{item.label}</span>
                  {item.badge && (
                    <span className="ml-1 bg-amber-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* User info, Notification bell & Logout */}
          <div className="flex items-center gap-2">
            {/* Chuông thông báo cho Khách hàng */}
            {currentUser && currentUser.role === 'CUSTOMER' && (
              <div className="relative">
                <button
                  onClick={() => setShowNotifs(!showNotifs)}
                  className="relative p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition"
                  title="Thông báo mã OTP & đơn hàng"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Dropdown Thông Báo */}
                {showNotifs && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 z-50 text-slate-100">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-indigo-400" />
                        <span className="text-xs font-bold">Hộp Thư Thông Báo ({notifications.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {unreadCount > 0 && (
                          <button
                            onClick={handleMarkAllRead}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                          >
                            <CheckCheck className="w-3 h-3" /> Đã đọc
                          </button>
                        )}
                        <button
                          onClick={() => setShowNotifs(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {notifications.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-6">
                          Chưa có thông báo nào.
                        </p>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`p-3 rounded-xl border text-xs transition ${
                              n.type === 'OTP_REQUEST'
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                                : 'bg-slate-800/80 border-slate-700 text-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-white text-[11px]">{n.title}</span>
                              <span className="text-[10px] text-slate-400">
                                {new Date(n.createdAt).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Thông tin User */}
            {currentUser && (
              <div className="flex items-center gap-2.5 bg-slate-800/80 pl-3 pr-1.5 py-1 rounded-2xl border border-slate-700">
                <div className="text-right hidden sm:block">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-xs font-bold text-white">{currentUser.fullName}</span>
                    {getRoleBadge(currentUser.role)}
                  </div>
                  <span className="text-[10px] text-slate-400 block font-mono">{currentUser.phone}</span>
                </div>
                <button
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-700/60 rounded-xl transition"
                  title="Đăng xuất"
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
