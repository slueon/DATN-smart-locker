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
    imageUrl: 'https://placehold.co/300x200?text=Earbuds',
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
    qrToken: 'PKUP-789210-A1B2',
    otpCode: '852963',
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
    qrToken: 'PKUP-654123-C3D4',
    otpCode: '147258',
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
    qrToken: 'PKUP-543219-E5F6',
    otpCode: '369852',
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
    otpCode: '951753',
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
  // Lấy toàn bộ đơn hàng
  getOrders: () => {
    try {
      const data = localStorage.getItem(ORDERS_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    localStorage.setItem(ORDERS_KEY, JSON.stringify(DEFAULT_ORDERS));
    return DEFAULT_ORDERS;
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

  // Lấy danh sách thông báo theo SĐT khách
  getNotifications: (phone) => {
    try {
      const data = localStorage.getItem(NOTIFS_KEY);
      const list = data ? JSON.parse(data) : DEFAULT_NOTIFICATIONS;
      if (!phone) return list;
      return list.filter((n) => !n.phone || n.phone === phone);
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

  // Sinh mã OTP ngẫu nhiên 6 số và gửi về mục thông báo của khách
  requestOtpForOrder: (orderId) => {
    const orders = store.getOrders();
    const order = orders.find((o) => o.orderId === orderId);
    if (!order) return null;

    // Sinh mã 6 số
    const newOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Cập nhật OTP trong đơn hàng
    store.updateOrderStatus(orderId, order.status, { otpCode: newOtp });

    // Tạo thông báo mới gửi về tài khoản khách hàng
    store.addNotification({
      phone: order.customerPhone,
      orderId: order.orderId,
      title: 'Mã OTP Nhận Hàng Tại Tủ',
      message: `Mã OTP nhận đơn hàng ${order.orderId} tại ${order.lockerName} - Ngăn #${order.compartmentIndex} là: ${newOtp} (Hiệu lực trong 5 phút).`,
      type: 'OTP_REQUEST',
    });

    return newOtp;
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

  // ===== QUẢN LÝ GIỎ HÀNG (CART HELPERS) =====
  getCart: () => {
    try {
      const data = localStorage.getItem(CART_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {}
    localStorage.setItem(CART_KEY, JSON.stringify(DEFAULT_CART));
    return DEFAULT_CART;
  },

  addToCart: (product) => {
    const cart = store.getCart();
    const existing = cart.find((item) => item.productId === product.productId);
    let updated;
    if (existing) {
      updated = cart.map((item) =>
        item.productId === product.productId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      );
    } else {
      updated = [...cart, { ...product, quantity: 1 }];
    }
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  updateCartQuantity: (productId, delta) => {
    const cart = store.getCart();
    const updated = cart
      .map((item) => {
        if (item.productId === productId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : null;
        }
        return item;
      })
      .filter(Boolean);
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  removeFromCart: (productId) => {
    const cart = store.getCart();
    const updated = cart.filter((item) => item.productId !== productId);
    localStorage.setItem(CART_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return updated;
  },

  clearCart: () => {
    localStorage.setItem(CART_KEY, JSON.stringify([]));
    window.dispatchEvent(new Event('smart_locker_cart_updated'));
    return [];
  },

  getCartCount: () => {
    const cart = store.getCart();
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }
};
