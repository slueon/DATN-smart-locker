import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CustomerPickupTab from './components/CustomerPickupTab';
import ShipperTab from './components/ShipperTab';
import ShipperRecallTab from './components/ShipperRecallTab';
import AdminTab from './components/AdminTab';
import LockerNetworkMapTab from './components/LockerNetworkMapTab';
import IoTDock from './components/IoTDock';

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('smart_locker_user');
    if (saved) {
      try {
        const u = JSON.parse(saved);
        if (u) {
          if (u.username === 'admin') u.fullName = 'Quản Trị Viên Hệ Thống';
          else if (u.username === 'shipper') u.fullName = 'Nguyễn Văn Shipper PTIT';
          else if (u.username === 'khachhang') u.fullName = 'Đoàn Viết Hoàng';
          localStorage.setItem('smart_locker_user', JSON.stringify(u));
        }
        return u;
      } catch {
        return null;
      }
    }
    return null;
  });

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

  // Đảm bảo mỗi vai trò chỉ được truy cập các tab thuộc thẩm quyền của mình
  useEffect(() => {
    if (currentUser?.role === 'ADMIN') {
      if (!['admin', 'gis-map'].includes(activeTab)) {
        setActiveTab('admin');
      }
    } else if (currentUser?.role === 'SHIPPER') {
      if (!['shipper', 'shipper-recall', 'gis-map'].includes(activeTab)) {
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
    localStorage.setItem('smart_locker_user', JSON.stringify(user));
    setActiveTab(getDefaultTab(user.role));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('smart_locker_user');
    setActiveTab('customer');
  };

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen text-slate-900 flex notranslate font-sans antialiased overflow-x-hidden selection:bg-blue-600 selection:text-white relative">
      {/* Apple Liquid Glass Dynamic Wallpaper Mesh Canvas */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-24 -left-24 w-[650px] h-[650px] rounded-full bg-gradient-to-br from-blue-500/35 to-indigo-600/30 blur-[110px]" />
        <div className="absolute top-1/4 -right-24 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-purple-500/30 to-pink-500/25 blur-[120px]" />
        <div className="absolute -bottom-32 left-1/4 w-[750px] h-[750px] rounded-full bg-gradient-to-br from-cyan-400/30 to-blue-600/30 blur-[130px]" />
        <div className="absolute top-2/3 right-1/4 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-emerald-400/25 to-teal-500/25 blur-[100px]" />
      </div>

      {/* Enterprise App Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={handleLogout}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen relative z-10">
        {/* Top Header & Command Bar */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          currentUser={currentUser}
        />

        {/* Dynamic Tab Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-16">
          {activeTab === 'customer' && (
            <CustomerPickupTab currentUser={currentUser} />
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
            <LockerNetworkMapTab
              currentUser={currentUser}
              onNavigateToPickup={() => setActiveTab('customer')}
              onNavigateToShipper={() => setActiveTab('shipper')}
            />
          )}
        </main>
      </div>

      {/* Floating ESP32 Telemetry Terminal Dock (Dynamic Island style) */}
      <IoTDock />
    </div>
  );
}
