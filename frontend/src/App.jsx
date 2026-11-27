import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import { authApi, clearAuthSession } from './services/api';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CustomerPickupTab from './components/CustomerPickupTab';
import ShipperTab from './components/ShipperTab';
import ShipperRecallTab from './components/ShipperRecallTab';
import AdminTab from './components/AdminTab';
import LockerNetworkMapTab from './components/LockerNetworkMapTab';
import ShipperRouteMap from './components/ShipperRouteMap';
// GĐ18 — đã xoá component dock telemetry ESP32 ở góc dưới phải (user yêu cầu bỏ khỏi giao diện).
// Dock đó poll `/api/mqtt/recent-logs` mỗi 6 giây và chỉ để trình diễn; endpoint backend VẪN GIỮ
// (ADMIN còn xem lịch sử mở tủ), chỉ frontend không còn gọi.

const AUTH_USER_KEY = 'smart_locker_user';
const getAccountPath = (username) => `/account/${encodeURIComponent(username)}`;

const loadCurrentTabUser = () => {
  try {
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // The authenticated session is stored in sessionStorage, not shared across tabs.
  }

  let saved = null;
  try {
    saved = sessionStorage.getItem(AUTH_USER_KEY);
  } catch {
    return null;
  }

  if (!saved) return null;
  try {
    const user = JSON.parse(saved);
    if (!user?.token) {
      sessionStorage.removeItem(AUTH_USER_KEY);
      return null;
    }
    if (user.username === 'admin') user.fullName = 'Quản Trị Viên Hệ Thống';
    else if (user.username === 'shipper') user.fullName = 'Nguyễn Văn Shipper PTIT';
    else if (user.username === 'khachhang') user.fullName = 'Đoàn Viết Hoàng';
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    return user;
  } catch {
    return null;
  }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(loadCurrentTabUser);

  const getDefaultTab = (role) => {
    if (role === 'CUSTOMER') return 'customer';
    if (role === 'SHIPPER') return 'shipper';
    if (role === 'ADMIN') return 'admin';
    return 'customer';
  };

  const [activeTab, setActiveTab] = useState(() =>
    currentUser ? getDefaultTab(currentUser.role) : 'customer'
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // GĐ75 (#2) — dưới md sidebar là drawer: mặc định ẩn, mở bằng nút ☰ ở Header.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Chọn tab xong thì đóng drawer (trên desktop state này luôn false nên không ảnh hưởng).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeTab]);
  const [customerLockerFilter, setCustomerLockerFilter] = useState(null);

  useEffect(() => {
    if (currentUser?.username) {
      const accountPath = getAccountPath(currentUser.username);
      if (window.location.pathname !== accountPath) {
        window.history.replaceState(null, '', accountPath);
      }
    }
  }, [currentUser?.username]);

  const handleSetActiveTab = (tab) => {
    if (tab === 'customer') {
      setCustomerLockerFilter(null);
    }
    setActiveTab(tab);
  };

  // Đảm bảo mỗi vai trò chỉ được truy cập các tab thuộc thẩm quyền của mình
  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      if (!['admin', 'gis-map'].includes(activeTab)) {
        setActiveTab('admin');
      }
    } else if (currentUser?.role === 'SHIPPER') {
      if (!['shipper', 'shipper-recall', 'shipper-map', 'gis-map'].includes(activeTab)) {
        setActiveTab('shipper');
      }
    } else if (currentUser?.role === 'CUSTOMER') {
      if (!['customer', 'gis-map'].includes(activeTab)) {
        setActiveTab('customer');
      }
    }
  }, [currentUser, activeTab]);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    window.history.replaceState(null, '', getAccountPath(user.username));
    setActiveTab(getDefaultTab(user.role));
  };

  const handleLogout = async () => {
    let deletedSessions;
    try {
      const response = await authApi.logout();
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Máy chủ không xác nhận đăng xuất.');
      }
      deletedSessions = response.data.data;
    } catch (err) {
      window.alert(err?.response?.data?.message || 'Không thể đăng xuất khỏi máy chủ. Vui lòng thử lại.');
      return;
    }
    setCurrentUser(null);
    clearAuthSession();
    window.history.replaceState(null, '', '/');
    setActiveTab('customer');
    if (deletedSessions === 0) {
      window.alert('Giao diện đã đăng xuất nhưng máy chủ không tìm thấy phiên cần thu hồi. Nếu đăng nhập lại vẫn bị chặn, hãy dùng nút thu hồi phiên cũ.');
    }
  };

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen text-slate-900 flex notranslate font-sans antialiased overflow-x-hidden selection:bg-blue-600 selection:text-white relative">
      {/* GĐ49a — BỎ 4 blob màu mờ (trước đây `blur-[100..130px]` với 4 sắc xanh/tím/hồng/ngọc).
          Chúng là nguồn của "chữ xám trên nền pastel": mỗi vùng màn hình một sắc màu nên tương
          phản không đo được ổn định, và hội đồng thấy nền loang lổ. Nay nền phẳng `#f1f5f9`
          (khai ở `index.css` body) — thẻ trắng tự nổi bằng viền + bóng nhẹ. */}

      {/* Enterprise App Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        currentUser={currentUser}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onLogout={handleLogout}
      />

      {/* GĐ75 (#2) — lớp phủ khi drawer mở trên mobile; bấm ra ngoài để đóng. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-30 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
        {/* Top Header & Command Bar */}
        <Header
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          currentUser={currentUser}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        {/* Dynamic Tab Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-16">
          {/* GĐ37 — CHUYỂN TAB MƯỢT.
              `key={activeTab}` buộc React thay phần tử khi đổi tab, nhờ đó animation chạy lại
              từ đầu; 3 class `animate-in fade-in slide-in-from-bottom-2` dùng đúng bộ CSS vừa
              thêm ở `index.css` (200ms — dưới ngưỡng 250ms của điều cấm #4).

              ⚠ Chỉ animate WRAPPER NỘI DUNG, không animate `position: fixed` (sidebar/toast/modal)
              — điều cấm #3: transform trên phần tử fixed gây nhảy. Wrapper này là block thường. */}
          <div key={activeTab} className="animate-in fade-in slide-in-from-bottom-2">
          {activeTab === 'customer' && (
            <CustomerPickupTab
              currentUser={currentUser}
              lockerFilterId={customerLockerFilter}
            />
          )}

          {activeTab === 'shipper' && (
            <ShipperTab
              currentUser={currentUser}
              onNavigateToRecall={() => setActiveTab('shipper-recall')}
            />
          )}

          {activeTab === 'shipper-recall' && (
            <ShipperRecallTab
              currentUser={currentUser}
              onNavigateToDeposit={() => setActiveTab('shipper')}
            />
          )}

          {activeTab === 'admin' && (
            <AdminTab currentUser={currentUser} />
          )}

          {activeTab === 'gis-map' && (
            // GĐ6 — tab `gis-map` phục vụ HAI vai trò với hai mục đích khác nhau:
            //  • SHIPPER: bản đồ LỘ TRÌNH đi giao (thứ tự tủ, cảnh báo tủ mất kết nối,
            //    xem sức chứa ngăn để biết tủ còn chỗ hay không).
            //  • ADMIN / CUSTOMER: giữ nguyên bản đồ mạng lưới tủ như trước.
            // Tách component thay vì nhồi cờ `role` vào LockerNetworkMapTab để không làm
            // rối màn quản trị đang chạy ổn.
            currentUser?.role === 'SHIPPER' ? (
              <ShipperRouteMap currentUser={currentUser} />
            ) : (
              <LockerNetworkMapTab
                currentUser={currentUser}
                // GĐ8 — ADMIN KHÔNG truyền `onNavigateToPickup`: App.jsx chặn ADMIN khỏi tab
                // `customer` (xem effect kiểm `activeTab` ở trên), nên truyền vào chỉ tạo ra
                // nút bấm không có tác dụng. Nhánh ADMIN trong component đã đổi nút đó thành
                // "Xem chi tiết trạm". CUSTOMER vẫn nhận đủ prop và chạy y như cũ.
                onNavigateToPickup={currentUser?.role === 'ADMIN'
                  ? undefined
                  : (lockerId) => {
                      setCustomerLockerFilter(lockerId || null);
                      setActiveTab('customer');
                    }}
                onNavigateToShipper={() => setActiveTab('shipper')}
              />
            )
          )}

          {activeTab === 'shipper-map' && (
            <LockerNetworkMapTab
              currentUser={currentUser}
              onNavigateToPickup={undefined}
              onNavigateToShipper={() => setActiveTab('shipper')}
            />
          )}
          </div>
        </main>
      </div>
    </div>
  );
}
