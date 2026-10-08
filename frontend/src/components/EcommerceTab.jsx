import React, { useState, useEffect } from 'react';
import { productApi } from '../services/api';
import { store } from '../services/store';
import { resolveProductImage, resolveProductCategory, PRODUCT_IMAGE_FALLBACKS } from '../utils/productImages';
import {
  Box, ShoppingBag, ShoppingCart, ArrowRight, Check,
  Search, ShieldCheck
} from 'lucide-react';

const INITIAL_PRODUCTS = [
  {
    productId: 1,
    name: 'Tai nghe Bluetooth True Wireless Pro',
    price: 450000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.earbuds,
    description: 'Âm thanh chất lượng cao, pin 24 giờ, khử ồn chủ động ANC, hộp sạc nhỏ gọn.',
    requiredSize: 'S',
    weightKg: 0.2,
    category: 'Âm thanh'
  },
  {
    productId: 2,
    name: 'Áo Hoodie PTIT Sinh Viên 2026',
    price: 280000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.hoodie,
    description: 'Chất nỉ bông ấm áp, form rộng unisex phong cách sinh viên Học viện CNBCVT.',
    requiredSize: 'M',
    weightKg: 0.6,
    category: 'Thời trang'
  },
  {
    productId: 3,
    name: 'Balo Laptop Chống Nước Cao Cấp',
    price: 520000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.backpack,
    description: 'Ngăn chống sốc 15.6 inch, cổng sạc USB tích hợp, khóa số chống trộm an toàn.',
    requiredSize: 'L',
    weightKg: 1.1,
    category: 'Phụ kiện'
  },
  {
    productId: 4,
    name: 'Sách Lập Trình IoT với ESP32 & MQTT',
    price: 150000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.book,
    description: 'Giáo trình thực hành vi điều khiển ESP32, kết nối cảm biến và giao thức IoT.',
    requiredSize: 'S',
    weightKg: 0.4,
    category: 'Sách & Học tập'
  },
  {
    productId: 5,
    name: 'Bàn Phím Cơ Không Dây RGB PTIT Edition',
    price: 680000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.keyboard,
    description: 'Switch quang học siêu bền, kết nối 3 chế độ Bluetooth 5.2/2.4Ghz/Type-C.',
    requiredSize: 'M',
    weightKg: 0.8,
    category: 'Phụ kiện'
  },
  {
    productId: 6,
    name: 'Chuột Gaming Công Thái Học Không Dây',
    price: 320000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.mouse,
    description: 'Cảm biến quang 16.000 DPI, ôm sát lòng bàn tay, pin sạc dùng 30 ngày.',
    requiredSize: 'S',
    weightKg: 0.15,
    category: 'Phụ kiện'
  }
];

export default function EcommerceTab({ currentUser, onNavigateToCart }) {
  const [products, setProducts] = useState(INITIAL_PRODUCTS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [cartCount, setCartCount] = useState(() => store.getCartCount());
  const [toastMsg, setToastMsg] = useState(null);

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
        // Tự động chuyển đổi và chuẩn hóa ảnh nếu backend trả về link placehold.co cũ
        const enriched = res.data.data.map((item) => ({
          ...item,
          imageUrl: resolveProductImage(item),
          category: resolveProductCategory(item),
        }));
        setProducts(enriched);
      }
    } catch (err) {
      console.warn('Backend chưa phản hồi, dùng danh mục sản phẩm mẫu chuẩn CDN.');
    }
  };

  const handleAddToCart = (product) => {
    const itemToAdd = {
      ...product,
      imageUrl: resolveProductImage(product),
      category: resolveProductCategory(product),
    };
    store.addToCart(itemToAdd);
    setToastMsg(`Đã thêm "${product.name}" vào giỏ hàng`);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  const filteredProducts = products.filter((p) => {
    const category = resolveProductCategory(p);
    if (selectedCategory !== 'ALL' && category !== selectedCategory) {
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

  const getSizeBadge = (size) => {
    switch (size) {
      case 'S':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">Ngăn S</span>;
      case 'M':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">Ngăn M</span>;
      case 'L':
        return <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">Ngăn L</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 notranslate">
      {/* High-Trust Banner (Toss style) */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 mb-3">
            <span>Dịch Vụ Giao Hàng Vào Tủ Thông Minh</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Mua sắm & Nhận hàng tự động 24/7
          </h1>
          <p className="mt-2 text-slate-600 text-xs sm:text-sm leading-relaxed">
            Chọn món hàng bạn cần, thanh toán và nhận mã OTP 60 giây để mở ngăn tủ tại Ký túc xá PTIT bất kỳ lúc nào mà không cần chờ đợi shipper.
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Bảo mật bằng mã PIN động & Cảm biến tải trọng IoT</span>
          </div>
        </div>

        <button
          onClick={onNavigateToCart}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm py-3 px-5 rounded-xl shadow-xs flex items-center gap-2 transition cursor-pointer whitespace-nowrap"
        >
          <ShoppingCart className="w-4 h-4" />
          <span>Giỏ hàng ({cartCount})</span>
          <ArrowRight className="w-4 h-4 ml-0.5" />
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm kiếm sản phẩm theo tên..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3.5 py-2 bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
          />
        </div>

        <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
          {['ALL', 'Âm thanh', 'Thời trang', 'Phụ kiện', 'Sách & Học tập'].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {cat === 'ALL' ? 'Tất cả' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid (Shadcn Card style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filteredProducts.map((p) => (
          <div
            key={p.productId || p.id}
            className="bg-white rounded-2xl border border-slate-200/90 overflow-hidden shadow-xs hover:shadow-md transition flex flex-col justify-between"
          >
            <div className="p-4">
              <div className="h-44 bg-slate-100 rounded-xl mb-3 flex items-center justify-center overflow-hidden relative">
                <img
                  src={resolveProductImage(p)}
                  alt={p.name}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = resolveProductImage({ ...p, imageUrl: '' });
                  }}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                />
                <span className="absolute top-2.5 right-2.5 bg-white/90 backdrop-blur-sm text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded-md border border-slate-200/60 shadow-xs">
                  {resolveProductCategory(p)}
                </span>
                <span className="absolute bottom-2.5 left-2.5">
                  {getSizeBadge(p.requiredSize)}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                <span className="flex items-center gap-1">
                  <Box className="w-3.5 h-3.5 text-slate-400" /> Trọng lượng:
                </span>
                <span className="text-slate-700 font-medium font-mono">{p.weightKg} kg</span>
              </div>

              <h3 className="font-semibold text-slate-900 text-sm line-clamp-1">
                {p.name}
              </h3>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                {p.description}
              </p>
            </div>

            <div className="px-4 pb-4 pt-3 flex items-center justify-between border-t border-slate-100 bg-slate-50/60">
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Giá sản phẩm</span>
                <span className="text-blue-600 font-bold text-base font-mono">
                  {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(p.price)}
                </span>
              </div>
              <button
                onClick={() => handleAddToCart(p)}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition shadow-xs flex items-center gap-1 cursor-pointer"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Thêm</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Clean Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-white text-slate-900 px-4 py-3 rounded-xl shadow-lg border border-slate-200 flex items-center gap-3 animate-in slide-in-from-bottom-3 duration-150">
          <div className="w-6 h-6 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center shrink-0">
            <Check className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="text-xs font-semibold">{toastMsg}</p>
            <button
              onClick={onNavigateToCart}
              className="text-[11px] text-blue-600 hover:underline font-medium mt-0.5 flex items-center gap-1 cursor-pointer"
            >
              Mở giỏ hàng <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
