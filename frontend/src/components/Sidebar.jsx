import React, { useState, useEffect } from 'react';
import {
  ShoppingBag, ShoppingCart, Package, Truck, Shield,
  ChevronLeft, ChevronRight, LogOut, PackageX
} from 'lucide-react';
import { store } from '../services/store';

export default function Sidebar({
  activeTab,
  setActiveTab,
  currentUser,
  collapsed,
  setCollapsed,
  onLogout,
  selectedStation,
  setSelectedStation,
  cartCount
}) {
  const [overdueCount, setOverdueCount] = useState(() => {
    return store.getOrders().filter((o) => o.status === 'OVERDUE').length;
  });

  useEffect(() => {
    const handleUpdate = () => {
      setOverdueCount(store.getOrders().filter((o) => o.status === 'OVERDUE').length);
    };
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_overdue_detected', handleUpdate);
    return () => {
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_overdue_detected', handleUpdate);
    };
  }, []);

  const navigationGroups = [
    {
      group: 'DỊCH VỤ KHÁCH HÀNG',
      roles: ['CUSTOMER'],
      items: [
        { id: 'ecommerce', label: 'Cửa hàng mua sắm', icon: ShoppingBag, desc: 'Sàn trực tuyến' },
        { id: 'customer', label: 'Bưu kiện của tôi', icon: Package, desc: 'Tra cứu & Mở tủ' },
        { id: 'cart', label: 'Giỏ hàng & Điểm tủ', icon: ShoppingCart, badge: cartCount > 0 ? cartCount : null, desc: 'Đặt hẹn trước' },
      ]
    },
    {
      group: 'VẬN HÀNH GIAO NHẬN',
      roles: ['SHIPPER'],
      items: [
        { id: 'shipper', label: 'Cổng Shipper & Nạp tủ', icon: Truck, desc: 'Mã QR 60s & Cảm biến' },
        {
          id: 'shipper-recall',
          label: 'Thu hồi hàng quá hạn',
          icon: PackageX,
          desc: 'Quy trình 4 bước IoT',
          badge: overdueCount > 0 ? overdueCount : null,
          badgeColor: 'rose'
        },
      ]
    },
    {
      group: 'QUẢN TRỊ HỆ THỐNG',
      roles: ['ADMIN'],
      items: [
        { id: 'admin', label: 'Trung tâm Quản trị KPI', icon: Shield, desc: 'Ma trận tủ & Phân quyền' },
      ]
    }
  ];

  return (
    <aside
      className={`bg-white border-r border-slate-200/90 transition-all duration-300 flex flex-col justify-between shrink-0 z-40 select-none ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Top Branding Section */}
      <div>
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-xs shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-bold text-slate-900 text-sm tracking-tight block truncate">
                  SmartLocker
                </span>
                <span className="text-[10px] text-slate-400 block truncate font-medium">
                  PTIT Campus Hub
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Station Selector Chip in Sidebar */}
        {!collapsed && (
          <div className="px-3.5 py-3 border-b border-slate-100 bg-slate-50/50">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Trạm Tủ Đang Theo Dõi
            </span>
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="w-full text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="ALL">📍 Tất cả trạm (2 trạm)</option>
              <option value="LOCKER_HN_01">🏢 Trạm KTX A1 (3 Ngăn)</option>
              <option value="LOCKER_HN_02">📚 Trạm Thư Viện (3 Ngăn)</option>
            </select>
          </div>
        )}

        {/* Navigation Item Groups */}
        <div className="p-3 space-y-5 overflow-y-auto max-h-[calc(100vh-200px)]">
          {navigationGroups.map((group, gIdx) => {
            const hasAccess = group.roles.includes(currentUser?.role);
            if (!hasAccess) return null;

            return (
              <div key={gIdx} className="space-y-1">
                {!collapsed && (
                  <span className="px-2.5 text-[10px] font-bold text-slate-400 tracking-wider uppercase block">
                    {group.group}
                  </span>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;

                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        title={collapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs transition-all cursor-pointer text-left ${
                          isActive
                            ? 'bg-blue-600 text-white font-semibold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 font-medium'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        {!collapsed && (
                          <div className="flex-1 min-w-0 flex items-center justify-between">
                            <div className="truncate">
                              <span className="block truncate">{item.label}</span>
                              <span className={`text-[10px] block truncate font-normal ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                                {item.desc}
                              </span>
                            </div>
                            {item.badge && (
                              <span className={`ml-1 text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                                isActive
                                  ? 'bg-white text-blue-700'
                                  : item.badgeColor === 'rose'
                                  ? 'bg-rose-500 text-white animate-pulse'
                                  : 'bg-blue-600 text-white'
                              }`}>
                                {item.badge}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom User Profile */}
      <div className="p-3 border-t border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-white border border-slate-200/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
              {currentUser?.fullName ? currentUser.fullName.charAt(0) : 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-semibold text-xs text-slate-900 block truncate">
                  {currentUser?.fullName}
                </span>
                <span className="text-[10px] text-slate-400 font-mono block truncate">
                  {currentUser?.phone}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={onLogout}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer shrink-0"
            title="Đăng xuất"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
