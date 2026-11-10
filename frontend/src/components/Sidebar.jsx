import React, { useState, useEffect } from 'react';
import {
  Package, Truck, Shield,
  ChevronLeft, ChevronRight, LogOut, PackageX,
  MapPin,
  Navigation
} from 'lucide-react';
import { store } from '../services/store';
import { adminApi, shipperApi } from '../services/api';

export default function Sidebar({
  activeTab,
  setActiveTab,
  currentUser,
  collapsed,
  setCollapsed,
  onLogout
}) {
  /**
   * GĐ7 — badge "quá hạn" lấy từ API THẬT, và chọn nguồn theo VAI TRÒ.
   *
   * <p><b>Vì sao phải chia vai trò:</b> Sidebar này dùng chung cho cả 3 vai trò, nhưng
   * {@code /api/admin/orders} chỉ ADMIN gọi được (SHIPPER/CUSTOMER nhận 403). Vậy:
   * <ul>
   *   <li><b>ADMIN</b> → {@code adminApi.getOrders('OVERDUE')} (endpoint mới của GĐ7).</li>
   *   <li><b>SHIPPER</b> → {@code shipperApi.getOverdueOrders()} — endpoint có sẵn, đã trả đúng
   *       đơn OVERDUE.</li>
   *   <li><b>CUSTOMER</b> → **không gọi gì**, badge bị ẩn: khách không có tab quá hạn, và
   *       không có endpoint nào cho khách đếm đơn quá hạn của riêng mình.</li>
   * </ul>
   *
   * <p>Lỗi mạng → giữ `null` (ẩn badge) chứ không hiện số sai. Badge "quá hạn" sai còn tệ hơn
   * không có badge: admin sẽ tưởng có việc phải xử lý, hoặc tưởng đã xử lý xong.
   */
  const [overdueCount, setOverdueCount] = useState(null);

  useEffect(() => {
    const role = currentUser?.role;
    if (role !== 'ADMIN' && role !== 'SHIPPER') {
      setOverdueCount(null); // CUSTOMER: không có badge
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const res = role === 'ADMIN'
          ? await adminApi.getOrders('OVERDUE')
          : await shipperApi.getOverdueOrders(null);
        if (cancelled) return;
        const list = res?.data?.data || [];
        setOverdueCount(list.length);
      } catch {
        if (!cancelled) setOverdueCount(null); // lỗi mạng: ẩn badge, không hiện số sai
      }
    };
    load();

    // Vẫn nghe sự kiện store để badge cập nhật ngay khi có thay đổi cục bộ (ví dụ shipper vừa
    // thu hồi hàng), nhưng số hiển thị luôn lấy lại từ API.
    const handleUpdate = () => load();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_overdue_detected', handleUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_overdue_detected', handleUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  const navigationGroups = [
    {
      group: 'DỊCH VỤ KHÁCH HÀNG',
      roles: ['CUSTOMER'],
      items: [
        { id: 'customer', label: 'Bưu kiện của tôi', icon: Package, desc: 'Tra cứu & Mở tủ' },
        { id: 'gis-map', label: 'Bản đồ mạng lưới tủ', icon: MapPin, desc: 'Bản đồ số WGS84' },
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
        // GĐ6 — shipper có bản đồ RIÊNG (lộ trình giao hàng), khác bản đồ mạng lưới của Admin.
        // Label đổi để shipper hiểu đây là công cụ đi giao, không phải bản đồ quản trị.
        { id: 'gis-map', label: 'Lộ trình giao hàng', icon: Navigation, desc: 'Thứ tự tủ cần giao hôm nay' },
      ]
    },
    {
      group: 'QUẢN TRỊ HỆ THỐNG',
      roles: ['ADMIN'],
      items: [
        { id: 'admin', label: 'Trung tâm Quản trị KPI', icon: Shield, desc: 'Ma trận tủ & Phân quyền' },
        { id: 'gis-map', label: 'Bản đồ trạm tủ GIS', icon: MapPin, desc: 'Bản đồ số WGS84' },
      ]
    }
  ];

  return (
    <aside
      className={`liquid-glass border-r border-white/60 transition-all duration-300 flex flex-col justify-between shrink-0 z-40 select-none shadow-[4px_0_30px_rgba(31,38,135,0.06)] relative ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Top Branding Section */}
      <div>
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-200/50">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/25 shrink-0 border border-white/40">
              <Package className="w-5 h-5 text-white" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-extrabold text-slate-900 text-sm tracking-tight block truncate">
                  Smart<span className="text-blue-600">Locker</span>
                </span>
                <span className="text-[10px] text-slate-400 block truncate font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  PTIT Campus Hub
                </span>
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100/70 transition cursor-pointer"
            title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation Item Groups */}
        <div className="p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-210px)]">
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
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;

                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        title={collapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs transition-all duration-200 cursor-pointer text-left relative ${
                          isActive
                            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md shadow-blue-500/25 border border-white/20'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/90 hover:shadow-xs font-medium'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 transition-transform ${isActive ? 'text-white scale-105' : 'text-slate-400'}`} />
                        {!collapsed && (
                          <div className="flex-1 min-w-0 flex items-center justify-between">
                            <span className="block truncate text-xs font-semibold">{item.label}</span>
                            {item.badge && (
                              <span className={`ml-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-2xs ${
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
      <div className="p-3 border-t border-slate-200/50">
        <div className="flex items-center justify-between gap-2 p-2 rounded-2xl liquid-glass-subtle border border-white/80 shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-50 to-indigo-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0 border border-blue-200/60 shadow-xs">
              {currentUser?.fullName ? currentUser.fullName.charAt(0) : 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-bold text-xs text-slate-900 block truncate">
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
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer shrink-0"
            title="Đăng xuất"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
