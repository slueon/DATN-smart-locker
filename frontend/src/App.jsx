import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import CartDrawer from './components/CartDrawer';
import EcommerceTab from './components/EcommerceTab';
import CartCheckoutTab from './components/CartCheckoutTab';
import CustomerPickupTab from './components/CustomerPickupTab';
import ShipperTab from './components/ShipperTab';
import AdminTab from './components/AdminTab';
import { store } from './services/store';

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('smart_locker_user');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return null;
      }
    }
    return null;
  });

  const getDefaultTab = (role) => {
    if (role === 'CUSTOMER') return 'ecommerce';
    if (role === 'SHIPPER') return 'shipper';
    if (role === 'ADMIN') return 'admin';
    return 'ecommerce';
  };

  const [activeTab, setActiveTab] = useState(() =>
    currentUser ? getDefaultTab(currentUser.role) : 'ecommerce'
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedStation, setSelectedStation] = useState('ALL');
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);
  const [cart, setCart] = useState(() => store.getCart());

  useEffect(() => {
    const handleCartUpdate = () => setCart(store.getCart());
    window.addEventListener('smart_locker_cart_updated', handleCartUpdate);
    return () => window.removeEventListener('smart_locker_cart_updated', handleCartUpdate);
  }, []);

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

  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex notranslate font-sans antialiased overflow-x-hidden">
      {/* Enterprise App Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        onLogout={handleLogout}
        selectedStation={selectedStation}
        setSelectedStation={setSelectedStation}
        cartCount={store.getCartCount()}
      />

      {/* Main Workspace Frame */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Header & Command Bar */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          currentUser={currentUser}
          onToggleCartDrawer={() => setIsCartDrawerOpen(true)}
          cartCount={store.getCartCount()}
          selectedStation={selectedStation}
          setSelectedStation={setSelectedStation}
        />

        {/* Dynamic Tab Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto pb-12">
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

      {/* Slide-over Cart Drawer */}
      <CartDrawer
        isOpen={isCartDrawerOpen}
        onClose={() => setIsCartDrawerOpen(false)}
        cart={cart}
        onNavigateToCheckout={() => {
          setIsCartDrawerOpen(false);
          setActiveTab('cart');
        }}
      />
    </div>
  );
}
