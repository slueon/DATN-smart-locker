import React from 'react';
import { ShoppingCart, X, Plus, Minus, Trash2, ArrowRight } from 'lucide-react';
import { store } from '../services/store';

export default function CartDrawer({
  isOpen,
  onClose,
  cart,
  onNavigateToCheckout
}) {
  if (!isOpen) return null;

  const calculateTotal = () => {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  const handleUpdateQty = (productId, delta) => {
    store.updateCartQuantity(productId, delta);
  };

  const handleRemove = (productId) => {
    store.removeFromCart(productId);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden select-none">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col justify-between animate-in slide-in-from-right duration-250">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Giỏ Hàng Của Bạn</h3>
                <span className="text-[11px] text-slate-400">{cart.length} món hàng được chọn</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Cart Item List */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 divide-y divide-slate-100">
            {cart.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs font-semibold text-slate-700">Giỏ hàng của bạn đang trống</p>
                <p className="text-[11px] text-slate-400 mt-1">Hãy thêm các món đồ công nghệ từ cửa hàng</p>
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.productId} className="py-3.5 first:pt-0 flex items-center justify-between gap-3 text-xs">
                  <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden shrink-0 border border-slate-200/60">
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-slate-900 truncate text-xs">{item.name}</h4>
                    <span className="text-blue-600 font-bold font-mono text-[11px] block mt-0.5">
                      {new Intl.NumberFormat('vi-VN').format(item.price)} đ
                    </span>
                    <span className="text-[10px] text-slate-500">Kích cỡ yêu cầu: Ngăn {item.requiredSize}</span>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 p-1 rounded-lg shrink-0">
                    <button
                      onClick={() => handleUpdateQty(item.productId, -1)}
                      className="p-1 hover:bg-slate-200 rounded text-slate-600 transition cursor-pointer"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-4 text-center font-bold text-slate-900 text-xs font-mono">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleUpdateQty(item.productId, 1)}
                      className="p-1 hover:bg-slate-200 rounded text-slate-600 transition cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  <button
                    onClick={() => handleRemove(item.productId)}
                    className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                    title="Xóa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Footer Checkout CTA */}
          {cart.length > 0 && (
            <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/70 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Tạm tính:</span>
                <span className="text-base font-bold text-slate-900 font-mono">
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(calculateTotal())}
                </span>
              </div>

              <button
                onClick={() => {
                  onClose();
                  onNavigateToCheckout();
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
              >
                <span>Tiến hành Đặt chỗ & Chọn Tủ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
