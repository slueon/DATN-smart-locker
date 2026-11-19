import React, { useState, useEffect } from 'react';
import {
  Bell, CheckCheck, X,
  ChevronRight, Package, Radio, Sparkles,
  AlertTriangle, CheckCircle2, Key, Info
} from 'lucide-react';
import { store, NOTIFS_UPDATED_EVENT } from '../services/store';
import { getAuthToken } from '../services/api';
import { nhanThoiGianThongBao } from '../utils/dateTime';

/** GĐ64b — nhịp poll thông báo máy chủ (DoD: thông báo có ở máy khác trong ≤ 6 s). */
const NOTIF_POLL_MS = 5000;

export default function Header({
  activeTab,
  setActiveTab,
  currentUser
}) {
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filterNotifType, setFilterNotifType] = useState('ALL');

  /**
   * GĐ64b — chuông đọc MÁY CHỦ (`GET /api/notifications`), không còn localStorage.
   *
   * <p>Tải lại khi: mount, mỗi {@link NOTIF_POLL_MS}, tab được focus/hiện lại, và khi có
   * {@link NOTIFS_UPDATED_EVENT} (sự kiện kiosk vừa tới, hoặc vừa đánh dấu đã đọc). Không có token
   * (nhánh đăng nhập dự phòng) ⇒ không gọi API, tránh 401 lặp lại mỗi 5 s.
   *
   * <p>Lỗi một nhịp (`null`) ⇒ GIỮ danh sách cũ, không xoá chuông về rỗng.
   */
  useEffect(() => {
    // Chưa đăng nhập ⇒ chuông không hiển thị (xem JSX), không cần poll.
    if (!currentUser) return undefined;
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight || !getAuthToken()) return;
      inFlight = true;
      try {
        const data = await store.getNotifications();
        if (!cancelled && data) {
          setNotifications(data.items);
          setUnreadCount(data.unreadCount);
        }
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };

    load();
    const timer = setInterval(load, NOTIF_POLL_MS);
    window.addEventListener(NOTIFS_UPDATED_EVENT, load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(NOTIFS_UPDATED_EVENT, load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentUser]);

  const handleMarkAllRead = () => {
    store.markAllNotificationsRead();
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

  /**
   * GĐ26 — thông báo "tủ yêu cầu nhận hàng bằng QR/OTP".
   *
   * <p><b>Vì sao phải thêm vào bộ lọc tab:</b> tab "Mã OTP / Nhận" (đúng tab trong ảnh user gửi)
   * trước đây chỉ nhận `type === 'OTP_REQUEST'`. Thông báo Kiosk mang type `KIOSK_METHOD_CHOSEN` nên
   * bị **ẩn khỏi tab** — khách mở đúng tab "Mã OTP / Nhận" lại thấy "Chưa có thông báo nào", trong
   * khi thông báo vẫn nằm ở tab "Tất cả". Đây là lỗi im lặng: dữ liệu đúng, chỗ hiển thị sai.
   */
  const filteredNotifs = notifications.filter((n) => {
    // GĐ64b — khách nhận `OVERDUE_CUSTOMER` (backend), shipper nhận `OVERDUE_ALERT`.
    if (filterNotifType === 'OVERDUE') return n.type === 'OVERDUE_ALERT' || n.type === 'OVERDUE_CUSTOMER';
    if (filterNotifType === 'OTP') {
      return n.type === 'OTP_REQUEST' || n.type === 'KIOSK_METHOD_CHOSEN';
    }
    return true;
  // GĐ74 — luôn xếp MỚI NHẤT lên đầu ngay tại chỗ hiển thị (backend đã ORDER BY createdAt DESC,
  // nhưng không để thứ tự phụ thuộc vào nguồn dữ liệu). Cùng thời điểm thì id lớn hơn đứng trước.
  }).sort((a, b) => {
    const ta = new Date(a.createdAt).getTime() || 0;
    const tb = new Date(b.createdAt).getTime() || 0;
    return tb - ta || (Number(b.id) || 0) - (Number(a.id) || 0);
  });

  /** Thông báo Kiosk bấm được để mở modal QR/OTP tương ứng. */
  const isActionableNotif = (n) => n?.type === 'KIOSK_METHOD_CHOSEN' && !!n.orderId;

  /**
   * GĐ26 — bấm thông báo: đánh dấu đã đọc, chuyển sang tab khách, rồi phát event để
   * `CustomerPickupTab` mở đúng modal.
   *
   * <p>`setTimeout(0)` là bắt buộc: phát event ngay trong tick này thì tab vừa được yêu cầu chuyển
   * tới CHƯA mount xong, listener chưa gắn → mất event.
   */
  const handleNotificationClick = (n) => {
    if (!isActionableNotif(n)) return;
    store.markNotificationRead(n.id);
    if (setActiveTab) setActiveTab('customer');
    setShowNotifs(false);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('smart_locker_open_pickup', {
        detail: { orderId: n.orderId, method: n.method },
      }));
    }, 0);
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30 select-none">
      {/* Breadcrumb Path */}
      <div className="flex items-center gap-3 text-xs min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-slate-500 hidden sm:inline font-medium">{breadcrumb.category}</span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline shrink-0" />
          <span className="font-semibold text-slate-900 truncate">{breadcrumb.title}</span>
        </div>

      </div>

      {/* Right Command Actions */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Notifications Bell */}
        {currentUser && (
          <div className="relative">
            <button
              onClick={() => setShowNotifs(!showNotifs)}
              className="relative p-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors border border-slate-200 cursor-pointer"
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
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-50 text-slate-800 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                      <Bell className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 block">
                        {currentUser?.role === 'SHIPPER' ? 'Thông Báo Điều Phối Shipper' : 'Thông Báo Nhận Hàng'}
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

                {/* GĐ64b — đã bỏ dòng vàng "Thông báo tạm trên trình duyệt này…" (GĐ13): thông báo
                    nay lưu ở máy chủ (bảng notifications), không còn đọc localStorage. */}

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
                        onClick={() => handleNotificationClick(n)}
                        role={isActionableNotif(n) ? 'button' : undefined}
                        title={isActionableNotif(n) ? 'Bấm để xem mã nhận hàng' : undefined}
                        className={`p-3 rounded-xl border text-xs transition-all ${
                          isActionableNotif(n)
                            ? 'cursor-pointer hover:bg-blue-50 hover:border-blue-300 active:scale-[0.99]'
                            : ''
                        } ${
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
                            {/* GĐ26 — icon riêng cho thông báo Kiosk để khách phân biệt với OTP tự tạo. */}
                            {n.type === 'KIOSK_METHOD_CHOSEN' && <Key className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                            {n.type === 'RECALL_SUCCESS' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                            {n.title}
                          </span>
                          {/* GĐ74 — hiện cả ngày khi không phải hôm nay. Trước chỉ có giờ nên thông báo
                              23:58 hôm qua trông "mới hơn" 17:47 hôm nay ⇒ tưởng danh sách xếp ngược. */}
                          <span className="text-[10px] text-slate-400 font-mono shrink-0" title={new Date(n.createdAt).toLocaleString('vi-VN')}>
                            {nhanThoiGianThongBao(n.createdAt)}
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
