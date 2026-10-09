import { resolveProductImage, PRODUCT_IMAGE_FALLBACKS } from '../utils/productImages.js';

// Centralized Interactive Store for Smart Locker Demo
// Đồng bộ dữ liệu giữa các vai trò (Khách hàng, Shipper, Quản trị viên)

const ORDERS_KEY = 'smart_locker_orders_data';
const NOTIFS_KEY = 'smart_locker_notifications_data';
const LOCKERS_KEY = 'smart_locker_lockers_data';
const CART_KEY = 'smart_locker_cart_data';

const DEFAULT_CART = [
  {
    productId: 1,
    name: 'Tai nghe Bluetooth True Wireless Pro',
    price: 450000,
    imageUrl: PRODUCT_IMAGE_FALLBACKS.earbuds,
    requiredSize: 'S',
    weightKg: 0.2,
    quantity: 1,
  }
];

// Dữ liệu đơn hàng khởi tạo ban đầu
const DEFAULT_ORDERS = [
  {
    orderId: 'ORD-789210',
    customerName: 'Đoàn Viết Hoàng',
    customerPhone: '0988123456',
    productName: 'Tai nghe Bluetooth True Wireless Pro',
    productPrice: 450000,
    deliveryType: 'LOCKER',
    lockerId: 'LOCKER_HN_01',
    lockerName: 'Tủ Giao Nhận KTX A1',
    lockerAddress: 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội',
    compartmentIndex: 2,
    compartmentSize: 'M',
    orderDate: '2026-10-03',
    expectedDate: '2026-10-04',
    depositedAt: '2026-10-04T08:30:00',
    expiryDeadline: '2026-10-05T23:59:59', // Hết 24h00 ngày hôm sau
    status: 'DEPOSITED', // ĐÃ VÀO TỦ (SẴN SÀNG LẤY)
    totalAmount: 450000,
    paymentMethod: 'ONLINE_VIETQR',
    paymentStatus: 'PAID',
    qrToken: 'PKUP-789210-A1B2',
    otpCode: null,
    otpExpiresAt: null,
  },
  {
    orderId: 'ORD-654123',
    customerName: 'Đoàn Viết Hoàng',
    customerPhone: '0988123456',
    productName: 'Áo Hoodie PTIT Sinh Viên 2026',
    productPrice: 280000,
    deliveryType: 'LOCKER',
    lockerId: 'LOCKER_HN_01',
    lockerName: 'Tủ Giao Nhận KTX A1',
    lockerAddress: 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội',
    compartmentIndex: 1,
    compartmentSize: 'S',
    orderDate: '2026-10-04',
    expectedDate: '2026-10-04',
    status: 'PENDING', // ĐANG CHỜ SHIPPER GIAO
    totalAmount: 280000,
    paymentMethod: 'ONLINE_VIETQR',
    paymentStatus: 'PAID',
    qrToken: 'PKUP-654123-C3D4',
    otpCode: null,
    otpExpiresAt: null,
  },
  {
    orderId: 'ORD-543219',
    customerName: 'Đoàn Viết Hoàng',
    customerPhone: '0988123456',
    productName: 'Balo Laptop Chống Nước PTIT',
    productPrice: 520000,
    deliveryType: 'LOCKER',
    lockerId: 'LOCKER_HN_02',
    lockerName: 'Tủ Giao Nhận Thư Viện',
    lockerAddress: 'Sảnh tầng 1, Nhà Thư Viện, Học viện CNBCVT, Hà Đông, Hà Nội',
    compartmentIndex: 3,
    compartmentSize: 'L',
    orderDate: '2026-09-30',
    expectedDate: '2026-10-01',
    depositedAt: '2026-10-01T09:00:00',
    status: 'COMPLETED', // ĐÃ NHẬN THÀNH CÔNG
    totalAmount: 520000,
    paymentMethod: 'ONLINE_VIETQR',
    paymentStatus: 'PAID',
    qrToken: 'PKUP-543219-E5F6',
    otpCode: null,
    otpExpiresAt: null,
  },
  {
    orderId: 'ORD-432108',
    customerName: 'Nguyễn Văn Tuấn',
    customerPhone: '0912345678',
    productName: 'Sách Lập Trình IoT ESP32',
    productPrice: 150000,
    deliveryType: 'LOCKER',
    lockerId: 'LOCKER_HN_01',
    lockerName: 'Tủ Giao Nhận KTX A1',
    lockerAddress: 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội',
    compartmentIndex: 3,
    compartmentSize: 'S',
    orderDate: '2026-10-01',
    expectedDate: '2026-10-02',
    depositedAt: '2026-10-02T10:00:00',
    expiryDeadline: '2026-10-03T23:59:59', // ĐÃ QUÁ HẠN
    status: 'OVERDUE', // QUÁ HẠN LƯU KHO
    totalAmount: 150000,
    qrToken: 'PKUP-432108-G7H8',
    otpCode: null,
    otpExpiresAt: null,
  }
];

// Dữ liệu thông báo ban đầu
const DEFAULT_NOTIFICATIONS = [
  {
    id: 1,
    phone: '0988123456',
    orderId: 'ORD-789210',
    title: 'Kiện hàng đã về Tủ KTX A1!',
    message: 'Đơn hàng ORD-789210 đã được Shipper nạp vào Tủ KTX A1 - Ngăn #2. Hạn chót lấy hàng: 24h00 ngày mai.',
    type: 'DEPOSITED',
    createdAt: '2026-10-04T08:31:00',
    isRead: false,
  }
];

// Dữ liệu ma trận các ngăn tủ
const DEFAULT_LOCKERS = [
  {
    lockerId: 'LOCKER_HN_01',
    name: 'Tủ Giao Nhận KTX A1',
    address: 'Sảnh tầng 1, KTX A1, Học viện CNBCVT, Hà Đông, Hà Nội',
    status: 'ONLINE',
    ipAddress: '192.168.1.105',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'RESERVED', orderId: 'ORD-654123', doorOpen: false },
      { compIndex: 2, size: 'M', status: 'OCCUPIED', orderId: 'ORD-789210', doorOpen: false },
      { compIndex: 3, size: 'L', status: 'OVERDUE', orderId: 'ORD-432108', doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_02',
    name: 'Tủ Giao Nhận Thư Viện',
    address: 'Sảnh tầng 1, Nhà Thư Viện, Học viện CNBCVT, Hà Đông, Hà Nội',
    status: 'ONLINE',
    ipAddress: '192.168.1.106',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'M', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 3, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  }
];

export const store = {
  // Lấy toàn bộ đơn hàng (tự động làm sạch mã cũ và tự động phát hiện đơn quá hạn)
  getOrders: () => {
    try {
      const data = localStorage.getItem(ORDERS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        const now = Date.now();
        let hasOverdueChange = false;

        const cleaned = parsed.map((o) => {
          let updated = o;
          // Nếu đơn hàng có mã cũ mà chưa có trường otpExpiresAt, xóa mã tĩnh để khách ấn tạo OTP mới
          if (o.otpCode && !o.otpExpiresAt) {
            updated = { ...updated, otpCode: null, otpExpiresAt: null };
          }
          // Tự động nhận diện đơn quá hạn lưu kho (24h00 hôm sau) mà không cần Admin can thiệp
          if (o.status === 'DEPOSITED' && o.expiryDeadline && new Date(o.expiryDeadline).getTime() < now) {
            updated = { ...updated, status: 'OVERDUE' };
            hasOverdueChange = true;
          }
          return updated;
        });

        if (hasOverdueChange) {
          localStorage.setItem(ORDERS_KEY, JSON.stringify(cleaned));
          cleaned.forEach((ord) => {
            if (ord.status === 'OVERDUE' && ord.lockerId && ord.compartmentIndex) {
              store.updateCompartmentStatus(ord.lockerId, ord.compartmentIndex, 'OVERDUE', ord.orderId);
            }
          });
        }
        return cleaned;
      }
    } catch (e) {}
    localStorage.setItem(ORDERS_KEY, JSON.stringify(DEFAULT_ORDERS));
    return DEFAULT_ORDERS;
  },

  // Tự động quét và phát hiện đơn quá hạn ngầm (Event-Driven Push Notification đến Shipper & Khách)
  checkAndScanOverdueOrders: () => {
    try {
      const list = store.getOrders();
      const now = Date.now();
      let sweptCount = 0;
      const newlyOverdueOrders = [];

      list.forEach((o) => {
        if (o.status === 'DEPOSITED' && o.expiryDeadline) {
          if (new Date(o.expiryDeadline).getTime() < now) {
            o.status = 'OVERDUE';
            sweptCount++;
            newlyOverdueOrders.push(o);
          }
        }
      });

      if (sweptCount > 0) {
        localStorage.setItem(ORDERS_KEY, JSON.stringify(list));

        // Cập nhật trạng thái ngăn tủ và bắn Push Notifications chủ động
        newlyOverdueOrders.forEach((ord) => {
          if (ord.lockerId && ord.compartmentIndex) {
            store.updateCompartmentStatus(ord.lockerId, ord.compartmentIndex, 'OVERDUE', ord.orderId);
          }

          // 1. Gửi thông báo đến tài khoản Khách hàng
          store.addNotification({
            phone: ord.customerPhone,
            orderId: ord.orderId,
            title: '⚠️ Bưu kiện quá hạn lưu kho',
            message: `Bưu kiện ${ord.orderId} tại ${ord.lockerName} đã quá hạn lưu kho 24h00. Mã mở tủ đã tạm khóa. Shipper sẽ tiến hành thu hồi về kho bãi.`,
            type: 'OVERDUE_CUSTOMER',
          });

          // 2. Gửi lệnh điều phối Push Notification đến toàn bộ Shipper
          store.addNotification({
            targetRole: 'SHIPPER',
            role: 'SHIPPER',
            phone: '0900000002',
            orderId: ord.orderId,
            title: '🚨 Lệnh Thu Hồi Bưu Kiện Quá Hạn!',
            message: `Phát hiện bưu kiện ${ord.orderId} tại ${ord.lockerName} - Ngăn #${ord.compartmentIndex} đã quá hạn lưu kho. Vui lòng tới trạm thu hồi để giải phóng ngăn tủ!`,
            type: 'OVERDUE_ALERT',
          });
        });

        window.dispatchEvent(new Event('smart_locker_store_updated'));
        window.dispatchEvent(
          new CustomEvent('smart_locker_overdue_detected', {
            detail: { count: sweptCount, orders: newlyOverdueOrders },
          })
        );
      }

      return { sweptCount, newlyOverdueOrders };
    } catch (e) {
      console.error('Lỗi quét đơn quá hạn ngầm:', e);
      return { sweptCount: 0, newlyOverdueOrders: [] };
    }
  },

  // Thu hồi tất cả các bưu kiện quá hạn về kho bãi trong 1 thao tác
  returnAllOverdueOrders: () => {
    const list = store.getOrders();
    const overdueList = list.filter((o) => o.status === 'OVERDUE');
    if (overdueList.length === 0) return 0;

    const now = new Date().toISOString();
    const updated = list.map((ord) => {
      if (ord.status === 'OVERDUE') {
        if (ord.lockerId && ord.compartmentIndex) {
          store.updateCompartmentStatus(ord.lockerId, ord.compartmentIndex, 'EMPTY', null);
        }
        return {
          ...ord,
          status: 'COMPLETED',
          returnedAt: now,
          note: 'Đã thu hồi hàng loạt về kho do quá hạn lưu kho',
        };
      }
      return ord;
    });

    localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));

    // Thêm thông báo xác nhận thu hồi hoàn tất
    store.addNotification({
      targetRole: 'SHIPPER',
      role: 'SHIPPER',
      phone: '0900000002',
      title: '✅ Đã hoàn tất thu hồi bưu kiện quá hạn',
      message: `Shipper đã thu hồi thành công ${overdueList.length} bưu kiện quá hạn về kho bãi và giải phóng các ngăn tủ trống.`,
      type: 'RECALL_SUCCESS',
    });

    window.dispatchEvent(new Event('smart_locker_store_updated'));
    return overdueList.length;
  },

  // Lưu đơn hàng mới (từ trang Checkout)
  createOrder: (order) => {
    const list = store.getOrders();
    const updated = [order, ...list];
    localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));

    // Cập nhật ngăn tủ tương ứng
    store.updateCompartmentStatus(order.lockerId, order.compartmentIndex, 'RESERVED', order.orderId);

    // Kích hoạt event cập nhật
    window.dispatchEvent(new Event('smart_locker_store_updated'));
    return order;
  },

  // Cập nhật trạng thái đơn hàng (PENDING -> DEPOSITED -> COMPLETED / OVERDUE)
  updateOrderStatus: (orderId, newStatus, extraData = {}) => {
    const list = store.getOrders();
    const updated = list.map((ord) => {
      if (ord.orderId === orderId) {
        return { ...ord, status: newStatus, ...extraData };
      }
      return ord;
    });
    localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));

    // Tìm đơn hàng để cập nhật trạng thái ngăn tủ tương ứng
    const found = updated.find((o) => o.orderId === orderId);
    if (found && found.lockerId && found.compartmentIndex) {
      if (newStatus === 'DEPOSITED') {
        store.updateCompartmentStatus(found.lockerId, found.compartmentIndex, 'OCCUPIED', found.orderId);
      } else if (newStatus === 'COMPLETED') {
        store.updateCompartmentStatus(found.lockerId, found.compartmentIndex, 'EMPTY', null);
      } else if (newStatus === 'OVERDUE') {
        store.updateCompartmentStatus(found.lockerId, found.compartmentIndex, 'OVERDUE', found.orderId);
      }
    }

    window.dispatchEvent(new Event('smart_locker_store_updated'));
  },

  // Lấy danh sách thông báo theo SĐT khách hoặc Role
  getNotifications: (phone, role = null) => {
    try {
      const data = localStorage.getItem(NOTIFS_KEY);
      const list = data ? JSON.parse(data) : DEFAULT_NOTIFICATIONS;
      if (!phone && !role) return list;
      return list.filter((n) => {
        if (role === 'SHIPPER' && (n.targetRole === 'SHIPPER' || n.role === 'SHIPPER')) return true;
        if (role === 'ADMIN' && (n.targetRole === 'ADMIN' || n.role === 'ADMIN')) return true;
        if (phone && n.phone === phone) return true;
        if (!n.phone && !n.targetRole) return true;
        return false;
      });
    } catch (e) {
      return DEFAULT_NOTIFICATIONS;
    }
  },

  // Thêm thông báo mới (ví dụ khi sinh mã OTP hoặc khi hàng về)
  addNotification: (notif) => {
    try {
      const data = localStorage.getItem(NOTIFS_KEY);
      const list = data ? JSON.parse(data) : DEFAULT_NOTIFICATIONS;
      const newNotif = {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        isRead: false,
        ...notif,
      };
      const updated = [newNotif, ...list];
      localStorage.setItem(NOTIFS_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event('smart_locker_notifs_updated'));
      return newNotif;
    } catch (e) {}
  },

  // Đánh dấu tất cả thông báo đã đọc
  markAllNotificationsRead: (phone) => {
    try {
      const data = localStorage.getItem(NOTIFS_KEY);
      const list = data ? JSON.parse(data) : DEFAULT_NOTIFICATIONS;
      const updated = list.map((n) => {
        if (!phone || n.phone === phone) {
          return { ...n, isRead: true };
        }
        return n;
      });
      localStorage.setItem(NOTIFS_KEY, JSON.stringify(updated));
      window.dispatchEvent(new Event('smart_locker_notifs_updated'));
    } catch (e) {}
  },

  // Sinh mã OTP ngẫu nhiên 6 số và chỉ có hiệu lực trong 5 phút
  requestOtpForOrder: (orderId, customOtp = null) => {
    const orders = store.getOrders();
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) return null;

    // Sinh mã OTP 6 số
    const newOtp = customOtp || Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // Có hiệu lực 5 phút (300s)

    // Cập nhật OTP và hạn sử dụng trong đơn hàng
    store.updateOrderStatus(orderId, order.status, {
      otpCode: newOtp,
      otpCreatedAt: now.toISOString(),
      otpExpiresAt: expiresAt,
    });

    // Tạo thông báo mới gửi về tài khoản khách hàng
    store.addNotification({
      phone: order.customerPhone,
      orderId: order.orderId,
      title: 'Mã OTP Nhận Hàng Tại Tủ (5 phút)',
      message: `Mã OTP nhận đơn hàng ${order.orderId} tại ${order.lockerName} - Ngăn #${order.compartmentIndex} là: ${newOtp} (Chỉ có hiệu lực trong 5 phút).`,
      type: 'OTP_REQUEST',
    });

    return { otpCode: newOtp, otpExpiresAt: expiresAt };
  },

  // Lấy dữ liệu danh sách tủ và ngăn
  getLockers: () => {
    try {
      const data = localStorage.getItem(LOCKERS_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    localStorage.setItem(LOCKERS_KEY, JSON.stringify(DEFAULT_LOCKERS));
    return DEFAULT_LOCKERS;
  },

  // Cập nhật trạng thái ngăn tủ
  updateCompartmentStatus: (lockerId, compIndex, status, orderId = null, doorOpen = false) => {
    const lockers = store.getLockers();
    const updated = lockers.map((l) => {
      if (l.lockerId === lockerId) {
        return {
          ...l,
          compartments: l.compartments.map((c) => {
            if (c.compIndex === compIndex) {
              return { ...c, status, orderId, doorOpen };
            }
            return c;
          })
        };
      }
      return l;
    });
    localStorage.setItem(LOCKERS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_lockers_updated'));
  },

  // Mở ngăn khẩn cấp từ xa (Admin Remote Force Unlock)
  forceUnlockCompartment: (lockerId, compIndex) => {
    const lockers = store.getLockers();
    const updated = lockers.map((l) => {
      if (l.lockerId === lockerId) {
        return {
          ...l,
          compartments: l.compartments.map((c) => {
            if (c.compIndex === compIndex) {
              return { ...c, doorOpen: true };
            }
            return c;
          })
        };
      }
      return l;
    });
    localStorage.setItem(LOCKERS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_lockers_updated'));
  },

  // Tính toán KPI cho Admin
  calculateKpi: () => {
    const orders = store.getOrders();
    const lockers = store.getLockers();

    let totalSlots = 0;
    let occupiedSlots = 0;

    lockers.forEach((l) => {
      l.compartments.forEach((c) => {
        totalSlots++;
        if (c.status === 'OCCUPIED' || c.status === 'OVERDUE') {
          occupiedSlots++;
        }
      });
    });

    const occupancyRate = totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0;
    const deliveredCount = orders.filter((o) => o.status === 'DEPOSITED' || o.status === 'COMPLETED').length;
    const overdueCount = orders.filter((o) => o.status === 'OVERDUE').length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    return {
      occupancyRate,
      totalLockers: lockers.length,
      totalSlots,
      deliveredCount,
      overdueCount,
      totalRevenue,
    };
  },

  // ===== QUẢN LÝ GIỎ HÀNG CÔ LẬP THEO TỪNG TÀI KHOẢN (USER-ISOLATED CART HELPERS) =====
  getUserCartKey: (userParam) => {
    if (userParam) {
      if (typeof userParam === 'string') return `smart_locker_cart_${userParam}`;
      if (userParam.username) return `smart_locker_cart_${userParam.username}`;
      if (userParam.phone) return `smart_locker_cart_${userParam.phone}`;
      if (userParam.id) return `smart_locker_cart_user_${userParam.id}`;
    }
    try {
      const raw = localStorage.getItem('smart_locker_user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u) {
          if (u.username) return `smart_locker_cart_${u.username}`;
          if (u.phone) return `smart_locker_cart_${u.phone}`;
          if (u.id) return `smart_locker_cart_user_${u.id}`;
        }
      }
    } catch (e) {}
    return 'smart_locker_cart_guest';
  },

  getCart: (userParam) => {
    const key = store.getUserCartKey(userParam);
    try {
      const data = localStorage.getItem(key);
      if (data !== null) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => ({
            ...item,
            imageUrl: resolveProductImage(item),
          }));
        }
      }
    } catch (e) {}

    // Chỉ tài khoản demo mặc định 'khachhang' mới nạp DEFAULT_CART nếu chưa có
    // Mọi tài khoản khác (User B, tài khoản đăng ký mới) khởi tạo giỏ hàng rỗng []
    const isDemoCustomer = key === 'smart_locker_cart_khachhang' || key === 'smart_locker_cart_0988123456';
    const initialCart = isDemoCustomer ? DEFAULT_CART : [];
    localStorage.setItem(key, JSON.stringify(initialCart));
    return initialCart.map((item) => ({
      ...item,
      imageUrl: resolveProductImage(item),
    }));
  },

  addToCart: (product, userParam) => {
    const key = store.getUserCartKey(userParam);
    const cleanProduct = {
      ...product,
      imageUrl: resolveProductImage(product),
    };
    const cart = store.getCart(userParam);
    const existing = cart.find((item) => item.productId === cleanProduct.productId);
    let updated;
    if (existing) {
      updated = cart.map((item) =>
        item.productId === cleanProduct.productId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    } else {
      updated = [...cart, { ...cleanProduct, quantity: 1 }];
    }
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  updateCartQuantity: (productId, delta, userParam) => {
    const key = store.getUserCartKey(userParam);
    const cart = store.getCart(userParam);
    const updated = cart
      .map((item) => {
        if (item.productId === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter(Boolean);
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  removeFromCart: (productId, userParam) => {
    const key = store.getUserCartKey(userParam);
    const cart = store.getCart(userParam);
    const updated = cart.filter((item) => item.productId !== productId);
    localStorage.setItem(key, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  clearCart: (userParam) => {
    const key = store.getUserCartKey(userParam);
    localStorage.setItem(key, JSON.stringify([]));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return [];
  },

  getCartCount: (userParam) => {
    const cart = store.getCart(userParam);
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }
};
