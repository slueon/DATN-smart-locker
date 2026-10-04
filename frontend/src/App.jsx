import React, { useState } from 'react';
import LoginPage from './components/LoginPage';
import Navbar from './components/Navbar';
import EcommerceTab from './components/EcommerceTab';
import CartCheckoutTab from './components/CartCheckoutTab';
import CustomerPickupTab from './components/CustomerPickupTab';
import ShipperTab from './components/ShipperTab';
import AdminTab from './components/AdminTab';

export default function App() {
  // Kiểm tra localStorage để xem người dùng đã đăng nhập chưa
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('smart_locker_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null; // Chưa đăng nhập → hiển thị LoginPage
  });

  // Tab mặc định theo vai trò
  const getDefaultTab = (role) => {
    if (role === 'CUSTOMER') return 'ecommerce';
    if (role === 'SHIPPER') return 'shipper';
    if (role === 'ADMIN') return 'admin';
    return 'ecommerce';
  };

  const [activeTab, setActiveTab] = useState(() =>
    currentUser ? getDefaultTab(currentUser.role) : 'ecommerce'
  );

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    localStorage.setItem('smart_locker_user', JSON.stringify(user));
    setActiveTab(getDefaultTab(user.role));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('smart_locker_user');
    setActiveTab('ecommerce');
  };

  // Nếu chưa đăng nhập → hiển thị trang Login riêng biệt toàn màn hình
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Đã đăng nhập → hiển thị giao diện chính theo vai trò
  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 font-sans flex flex-col notranslate">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      <main className="flex-1 pb-12">
        {activeTab === 'ecommerce' && (
          <EcommerceTab
            currentUser={currentUser}
            onNavigateToCart={() => setActiveTab('cart')}
          />
        )}
        {activeTab === 'cart' && (
          <CartCheckoutTab
            currentUser={currentUser}
            onNavigateToOrders={() => setActiveTab('customer')}
            onNavigateToStore={() => setActiveTab('ecommerce')}
          />
        )}
        {activeTab === 'customer' && (
          <CustomerPickupTab currentUser={currentUser} />
        )}
        {activeTab === 'shipper' && (
          <ShipperTab currentUser={currentUser} />
        )}
        {activeTab === 'admin' && (
          <AdminTab currentUser={currentUser} />
        )}
      </main>
    </div>
  );
}
