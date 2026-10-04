import React, { useState, useEffect } from 'react';
import { productApi } from '../services/api';
import { store } from '../services/store';
import {
  Box, ShoppingBag, ShoppingCart, ArrowRight, Check,
  Search, Tag, Sparkles
} from 'lucide-react';

const INITIAL_PRODUCTS = [
  {
    productId: 1,
    name: 'Tai nghe Bluetooth True Wireless Pro',
    price: 450000,
    imageUrl: 'https://placehold.co/300x200?text=Earbuds',
    description: 'Âm thanh chất lượng cao, pin 24h, chống nước IPX5, hộp sạc nhỏ gọn.',
    requiredSize: 'S',
    weightKg: 0.2,
    category: 'Âm Thanh'
  },
  {
    productId: 2,
    name: 'Áo Hoodie PTIT Sinh Viên 2026',
    price: 280000,
    imageUrl: 'https://placehold.co/300x200?text=Hoodie',
    description: 'Chất nỉ bông ấm áp, form rộng thời trang sinh viên Học viện CNBCVT.',
    requiredSize: 'M',
    weightKg: 0.6,
    category: 'Thời Trang'
  },
  {
    productId: 3,
    name: 'Balo Laptop Công Nghệ Chống Nước',
    price: 520000,
    imageUrl: 'https://placehold.co/300x200?text=Backpack',
    description: 'Ngăn chống sốc 15.6 inch, tích hợp cổng sạc USB và khóa kéo chống trộm.',
    requiredSize: 'L',
    weightKg: 1.1,
    category: 'Phụ Kiện'
  },
  {
    productId: 4,
    name: 'Sách Lập Trình IoT với ESP32',
    price: 150000,
    imageUrl: 'https://placehold.co/300x200?text=Book',
    description: 'Tài liệu hướng dẫn thực hành vi điều khiển, cảm biến và giao thức MQTT.',
    requiredSize: 'S',
    weightKg: 0.4,
    category: 'Sách & Giáo Trình'
  },
  {
    productId: 5,
    name: 'Bàn Phím Cơ Không Dây RGB PTIT',
    price: 680000,
    imageUrl: 'https://placehold.co/300x200?text=Keyboard',
    description: 'Switch quang học siêu bền, kết nối Bluetooth 5.2, đèn LED đa hiệu ứng.',
    requiredSize: 'M',
    weightKg: 0.8,
    category: 'Phụ Kiện'
  },
  {
    productId: 6,
    name: 'Chuột Gaming Công Thái Học Không Dây',
    price: 320000,
    imageUrl: 'https://placehold.co/300x200?text=Mouse',
    description: 'Độ nhạy 16000 DPI, thiết kế ôm tay chống mỏi, pin sạc Type-C dùng 1 tháng.',
    requiredSize: 'S',
    weightKg: 0.15,
    category: 'Phụ Kiện'
  }
];

export default function EcommerceTab({ currentUser, onNavigateToCart }) {
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [cartCount, setCartCount] = useState(() => store.getCartCount());
  const [toastMsg, setToastMsg] = useState(null);

  // Tải danh mục sản phẩm từ backend (nếu có)
  useEffect(() => {
    fetchProducts();
    const handleCartUpdate = () => setCartCount(store.getCartCount());
    window.addEventListener('smart_locker_cart_updated', handleCartUpdate);
    return () => window.removeEventListener('smart_locker_cart_updated', handleCartUpdate);
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await productApi.getAll();
      if (res.data?.data && res.data.data.length > 0) {
        setProducts(res.data.data);
      }
    } catch (err) {
      console.warn('Backend chưa sẵn sàng, dùng danh mục sản phẩm mẫu.');
    }
  };

  const handleAddToCart = (product) => {
    store.addToCart(product);
    setToastMsg(`Đã thêm "${product.name}" vào giỏ hàng!`);
    setTimeout(() => {
      setToastMsg(null);
    }, 3500);
  };

  const filteredProducts = products.filter((p) => {
    if (selectedCategory !== 'ALL' && p.category && p.category !== selectedCategory) {
      return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchDesc = p.description?.toLowerCase().includes(q);
      return matchName || matchDesc;
    }
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 notranslate">
      {/* Banner Tiêu Đề */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight sm:text-4xl">
          Sàn Mua Sắm Công Nghệ & Sinh Viên PTIT
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl mx-auto text-sm">
          Lựa chọn các mặt hàng yêu thích, thêm vào giỏ và đặt nhận hàng chủ động tại Tủ giao nhận thông minh.
        </p>

        {/* Nút Chuyển Nhanh Sang Trang Giỏ Hàng & Thanh Toán */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={onNavigateToCart}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2.5 px-5 rounded-2xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Xem Giỏ Hàng & Thanh Toán ({cartCount} món)</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>
        </div>
      </div>

      {/* Thanh Tìm Kiếm & Lọc Danh Mục */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm sản phẩm theo tên hoặc mô tả..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          {['ALL', 'Âm Thanh', 'Thời Trang', 'Phụ Kiện', 'Sách & Giáo Trình'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat === 'ALL' ? 'Tất Cả' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* LƯỚI SẢN PHẨM RỘNG RÃI (GRID 3-4 CỘT) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProducts.map((p) => (
          <div
            key={p.productId}
            className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between group"
          >
            <div className="p-4">
              {/* Hình ảnh */}
              <div className="h-44 bg-slate-100 rounded-2xl mb-3 flex items-center justify-center overflow-hidden relative">
                <img
                  src={p.imageUrl || 'https://placehold.co/300x200?text=Product'}
                  alt={p.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {p.category || 'Công nghệ'}
                </span>
              </div>

              {/* Thông tin kích thước & khối lượng */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Size ngăn: {p.requiredSize}
                </span>
                <span className="text-[11px] text-slate-400 font-medium">
                  {p.weightKg} kg
                </span>
              </div>

              <h3 className="font-bold text-slate-800 text-sm line-clamp-1 group-hover:text-indigo-600 transition">
                {p.name}
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                {p.description}
              </p>
            </div>

            {/* Chân thẻ sản phẩm: Giá & Nút thêm vào giỏ */}
            <div className="px-4 pb-4 pt-2 flex items-center justify-between border-t border-slate-100">
              <span className="text-indigo-600 font-black text-base">
                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.price)}
              </span>
              <button
                onClick={() => handleAddToCart(p)}
                className="bg-slate-900 hover:bg-indigo-600 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>+ Thêm Vào Giỏ</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* TOAST THÔNG BÁO THÊM GIỎ HÀNG THÀNH CÔNG */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-3 animate-bounce">
          <div className="w-7 h-7 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 stroke-[3]" />
          </div>
          <div>
            <p className="text-xs font-bold">{toastMsg}</p>
            <button
              onClick={onNavigateToCart}
              className="text-[11px] text-indigo-300 hover:text-white underline font-semibold mt-0.5"
            >
              Đi đến Giỏ Hàng & Thanh Toán ➔
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
