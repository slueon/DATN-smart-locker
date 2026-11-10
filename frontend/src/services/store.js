// Centralized Interactive Store for Smart Locker Demo
// Đồng bộ dữ liệu giữa các vai trò (Khách hàng, Shipper, Quản trị viên)

const ORDERS_KEY = 'smart_locker_orders_data';
const NOTIFS_KEY = 'smart_locker_notifications_data';
const LOCKERS_KEY = 'smart_locker_lockers_data';

// Dữ liệu đơn hàng khởi tạo ban đầu
const DEFAULT_ORDERS = [];

// Dữ liệu thông báo ban đầu
const DEFAULT_NOTIFICATIONS = [];

// Dữ liệu ma trận các ngăn tủ: Tất cả 10 trạm tủ đều chỉ có 2 ngăn (Ngăn 1: Size S - Nhỏ, Ngăn 2: Size L - Lớn)
const DEFAULT_LOCKERS = [
  {
    lockerId: 'LOCKER_HN_01',
    name: 'Tủ Giao Nhận KTX A1 (Trụ Sở PTIT)',
    address: 'Sảnh Tầng 1, KTX A1, Học viện CNBCVT, Km10 Nguyễn Trãi, Q. Hà Đông',
    status: 'ONLINE',
    ipAddress: '192.168.1.105',
    latitude: 20.9808,
    longitude: 105.7876,
    lockerType: 'PHYSICAL',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_02',
    name: 'Tủ Giao Nhận Đại Học Hà Nội (HANU)',
    address: 'Cổng Chính ĐH Hà Nội, Km9 Đường Nguyễn Trãi, P. Trung Văn, Q. Nam Từ Liêm',
    status: 'ONLINE',
    ipAddress: '192.168.1.106',
    latitude: 20.9892,
    longitude: 105.7958,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_03',
    name: 'Tủ Giao Nhận Vinhomes Royal City (Ngã Tư Sở)',
    address: 'Sảnh R1, KĐT Vinhomes Royal City, 72A Nguyễn Trãi, P. Thượng Đình, Q. Thanh Xuân',
    status: 'ONLINE',
    ipAddress: '192.168.1.107',
    latitude: 21.0032,
    longitude: 105.8162,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_04',
    name: 'Tủ Giao Nhận Bến Xe Yên Nghĩa (Metro Hà Đông)',
    address: 'Sảnh Ga Yên Nghĩa (Tuyến Metro Cát Linh - Hà Đông), P. Yên Nghĩa, Q. Hà Đông',
    status: 'ONLINE',
    ipAddress: '192.168.1.108',
    latitude: 20.9542,
    longitude: 105.7538,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_05',
    name: 'Tủ Giao Nhận Trung Hòa - Nhân Chính (Cầu Giấy)',
    address: 'Tòa Nhà 17T1 Hoàng Đạo Thúy, KĐT Trung Hòa Nhân Chính, Q. Cầu Giấy',
    status: 'ONLINE',
    ipAddress: '192.168.1.109',
    latitude: 21.0088,
    longitude: 105.8035,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_06',
    name: 'Tủ Giao Nhận GO! Thăng Long (Trần Duy Hưng)',
    address: 'Đại Siêu Thị GO! Thăng Long, 222 Trần Duy Hưng, P. Trung Hòa, Q. Cầu Giấy',
    status: 'ONLINE',
    ipAddress: '192.168.1.110',
    latitude: 21.0068,
    longitude: 105.7918,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_07',
    name: 'Tủ Giao Nhận Aeon Mall Hà Đông (Dương Nội)',
    address: 'Cổng 1, TTTM Aeon Mall Hà Đông, Khu Đô Thị Dương Nội, Q. Hà Đông',
    status: 'ONLINE',
    connectionStatus: 'ONLINE',
    ipAddress: '192.168.1.111',
    latitude: 20.9882,
    longitude: 105.7548,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_08',
    name: 'Tủ Giao Nhận KĐT Mỗ Lao (Mulberry Lane)',
    address: 'Khu Chung Cư TSQ Mulberry Lane, KĐT Mỗ Lao, Q. Hà Đông',
    status: 'ONLINE',
    ipAddress: '192.168.1.112',
    latitude: 20.9858,
    longitude: 105.7822,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_09',
    name: 'Tủ Giao Nhận ĐH Khoa Học Tự Nhiên (VNU)',
    address: '334 Nguyễn Trãi, P. Thanh Xuân Trung, Q. Thanh Xuân, Hà Nội',
    status: 'ONLINE',
    ipAddress: '192.168.1.113',
    latitude: 20.9968,
    longitude: 105.8078,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  },
  {
    lockerId: 'LOCKER_HN_10',
    name: 'Tủ Giao Nhận Trung Tâm Hành Chính Hà Đông',
    address: 'Phố Tô Hiệu, P. Hà Cầu, Q. Hà Đông (Gần Ga Metro La Khê)',
    status: 'ONLINE',
    ipAddress: '192.168.1.114',
    latitude: 20.9678,
    longitude: 105.7738,
    lockerType: 'SIMULATED',
    lastHeartbeat: new Date().toISOString(),
    compartments: [
      { compIndex: 1, size: 'S', status: 'EMPTY', orderId: null, doorOpen: false },
      { compIndex: 2, size: 'L', status: 'EMPTY', orderId: null, doorOpen: false },
    ]
  }
];

export const store = {
  // Lấy toàn bộ đơn hàng (Hệ thống mới: khởi đầu 0 đơn)
  getOrders: () => {
    try {
      const ORDERS_VERSION = 'v7_all_orders_brand_new_clean';
      if (localStorage.getItem('smart_locker_orders_ver') !== ORDERS_VERSION) {
        localStorage.setItem('smart_locker_orders_ver', ORDERS_VERSION);
        localStorage.setItem(ORDERS_KEY, JSON.stringify([]));
        localStorage.setItem(NOTIFS_KEY, JSON.stringify([]));
        return [];
      }

      const data = localStorage.getItem(ORDERS_KEY);
      if (data) {
        let parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {}
    localStorage.setItem(ORDERS_KEY, JSON.stringify([]));
    return [];
  },

  // Tạo thêm 1 đơn hàng chờ nạp cho tài khoản Đoàn Viết Hoàng gửi về Tủ KTX A1 (LOCKER_HN_01)
  generateSamplePendingOrder: (customLockerId = 'LOCKER_HN_01') => {
    const lockers = store.getLockers();
    const targetLocker = lockers.find((l) => l.lockerId === 'LOCKER_HN_01') || lockers[0];

    const sampleProducts = [
      { name: 'Áo Hoodie PTIT Sinh Viên 2026', price: 280000, size: 'S', comp: 1 },
      { name: 'Tai nghe Bluetooth True Wireless Pro', price: 450000, size: 'S', comp: 1 },
      { name: 'Balo Laptop Chống Nước PTIT', price: 520000, size: 'L', comp: 2 },
      { name: 'Chuột Công Thái Học Không Dây Logitech MX Master', price: 650000, size: 'S', comp: 1 },
      { name: 'Pin Sạc Dự Phòng Polymer 20.000mAh 22.5W', price: 380000, size: 'S', comp: 1 },
      { name: 'Bình Giữ Nhiệt Thông Minh LED 500ml', price: 195000, size: 'S', comp: 1 },
      { name: 'Bàn Phím Cơ Không Dây RGB Low-Profile', price: 850000, size: 'L', comp: 2 },
    ];
    const randProd = sampleProducts[Math.floor(Math.random() * sampleProducts.length)];
    const randSuffix = Math.floor(100000 + Math.random() * 900000);
    const randId = `ORD-${randSuffix}`;

    const newOrder = {
      orderId: randId,
      customerName: 'Đoàn Viết Hoàng',
      customerPhone: '0988123456',
      productName: randProd.name,
      productPrice: randProd.price,
      deliveryType: 'LOCKER',
      lockerId: targetLocker.lockerId,
      lockerName: targetLocker.name,
      lockerAddress: targetLocker.address,
      compartmentIndex: randProd.comp,
      compartmentSize: randProd.size,
      orderDate: new Date().toISOString().split('T')[0],
      expectedDate: new Date().toISOString().split('T')[0],
      status: 'PENDING',
      totalAmount: randProd.price,
      paymentMethod: 'ONLINE_VIETQR',
      paymentStatus: 'PAID',
      qrToken: `PKUP-${randSuffix}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      otpCode: null,
      otpExpiresAt: null,
    };

    const currentOrders = store.getOrders();
    currentOrders.unshift(newOrder);
    localStorage.setItem(ORDERS_KEY, JSON.stringify(currentOrders));
    window.dispatchEvent(new Event('smart_locker_store_updated'));
    return newOrder;
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

  // Kiểm tra sức chứa của tủ theo ngày (Hỗ trợ Local Store / Offline / Graceful Degradation)
  checkLockerCapacity: (lockerId, targetDate) => {
    const lockers = store.getLockers();
    const locker = lockers.find((l) => l.lockerId === lockerId) || lockers[0];
    const totalSlots = locker && Array.isArray(locker.compartments) ? locker.compartments.length : 2;

    const todayStr = new Date().toISOString().split('T')[0];
    const reqDate = targetDate || todayStr;
    const isToday = reqDate === todayStr;

    const orders = store.getOrders();
    let remainingSlots = 0;

    if (isToday) {
      // 1. Ngày HÔM NAY: Sức chứa khả dụng dựa trên số ngăn vật lý thực tế đang TRỐNG (EMPTY)
      // trừ đi số đơn hàng PENDING hôm nay đang chờ Shipper nạp (nếu chưa gán chiếm ngăn)
      const physicalEmptyCount = locker && Array.isArray(locker.compartments)
        ? locker.compartments.filter((c) => c.status === 'EMPTY' || !c.status).length
        : totalSlots;

      // Đơn PENDING hôm nay chưa gán ngăn hoặc ngăn của nó vẫn còn ghi EMPTY chờ nạp
      const pendingOrdersWithoutReservedComp = orders.filter((o) => {
        if (o.lockerId !== lockerId || o.deliveryType !== 'LOCKER') return false;
        if (o.status !== 'PENDING') return false;
        const orderDate = o.expectedDate || (o.orderDate ? o.orderDate.split('T')[0] : null);
        if (orderDate !== todayStr) return false;
        if (!o.compartmentIndex) return true;
        const comp = locker?.compartments?.find((c) => c.compIndex === o.compartmentIndex);
        return comp && comp.status === 'EMPTY';
      });

      remainingSlots = Math.max(0, physicalEmptyCount - pendingOrdersWithoutReservedComp.length);
    } else {
      // 2. Ngày TƯƠNG LAI: Sức chứa dựa trên tổng slot trừ đi số đơn đặt trước cho ngày đó
      const futureBookedOrders = orders.filter((o) => {
        if (o.lockerId !== lockerId || o.deliveryType !== 'LOCKER') return false;
        if (o.status === 'COMPLETED' || o.status === 'CANCELLED') return false;
        const orderDate = o.expectedDate || (o.orderDate ? o.orderDate.split('T')[0] : null);
        return orderDate === reqDate;
      });

      remainingSlots = Math.max(0, totalSlots - futureBookedOrders.length);
    }

    const available = remainingSlots > 0;

    // Tìm tối đa 3 ngày thay thế còn chỗ trong 7 ngày tới
    const alternativeAvailableDates = [];
    if (!available) {
      const baseDate = new Date(reqDate);
      for (let i = 1; i <= 7; i++) {
        const nextD = new Date(baseDate);
        nextD.setDate(nextD.getDate() + i);
        const nextDateStr = nextD.toISOString().split('T')[0];

        const nextBookings = orders.filter((o) => {
          if (o.lockerId !== lockerId || o.deliveryType !== 'LOCKER') return false;
          if (o.status === 'COMPLETED' || o.status === 'CANCELLED') return false;
          const orderDate = o.expectedDate || (o.orderDate ? o.orderDate.split('T')[0] : null);
          return orderDate === nextDateStr;
        });

        if (totalSlots - nextBookings.length > 0) {
          alternativeAvailableDates.push(nextDateStr);
          if (alternativeAvailableDates.length >= 3) break;
        }
      }
    }

    return {
      lockerId: locker ? locker.lockerId : lockerId,
      lockerName: locker ? locker.name : 'Tủ Giao Nhận KTX A1',
      requestedDate: reqDate,
      isAvailable: available,
      available: available,
      remainingSlots,
      totalSlots,
      allowHomeDeliveryFallback: true,
      alternativeAvailableDates,
    };
  },

  // Lưu đơn hàng mới (từ trang Checkout)
  createOrder: (order, options = {}) => {
    // Nếu có kích hoạt kiểm tra sức chứa (ví dụ từ UI checkout)
    if (order.deliveryType === 'LOCKER' && order.lockerId && options.validateCapacity) {
      const cap = store.checkLockerCapacity(order.lockerId, order.expectedDate);
      if (!cap.available || cap.remainingSlots <= 0) {
        throw new Error(`Tủ ${cap.lockerName || order.lockerId} đã hết chỗ vào ngày ${order.expectedDate || 'hôm nay'}! Vui lòng chọn ngày khác hoặc Giao tận nhà.`);
      }
    }

    const list = store.getOrders();
    const updated = [order, ...list];
    localStorage.setItem(ORDERS_KEY, JSON.stringify(updated));

    // Cập nhật ngăn tủ tương ứng
    if (order.lockerId && order.compartmentIndex) {
      store.updateCompartmentStatus(order.lockerId, order.compartmentIndex, 'RESERVED', order.orderId);
    }

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
    if (!order || order.status !== 'DEPOSITED') return null;

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
      const LOCKERS_VERSION = 'v7_all_lockers_brand_new_clean';
      if (localStorage.getItem('smart_locker_lockers_ver') !== LOCKERS_VERSION) {
        localStorage.setItem('smart_locker_lockers_ver', LOCKERS_VERSION);
        localStorage.setItem(LOCKERS_KEY, JSON.stringify(DEFAULT_LOCKERS));
        return DEFAULT_LOCKERS;
      }

      const data = localStorage.getItem(LOCKERS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          // Tự động đồng bộ tọa độ WGS84 mới và bổ sung trạm thiếu
          const defaultMap = new Map(DEFAULT_LOCKERS.map((l) => [l.lockerId, l]));
          const updated = parsed.map((l) => {
            const def = defaultMap.get(l.lockerId);
            const comps = (l.compartments && l.compartments.length === 2)
              ? l.compartments
              : (def ? def.compartments : (l.compartments || []).slice(0, 2));
            if (def) {
              return {
                ...l,
                name: def.name,
                address: def.address,
                latitude: def.latitude,
                longitude: def.longitude,
                status: 'ONLINE',
                connectionStatus: 'ONLINE',
                lockerType: def.lockerType,
                compartments: comps,
                availableCompartments: comps.filter((c) => c.status === 'EMPTY').length,
              };
            }
            return {
              ...l,
              status: 'ONLINE',
              connectionStatus: 'ONLINE',
              compartments: comps,
              availableCompartments: comps.filter((c) => c.status === 'EMPTY').length,
            };
          });
          const existingIds = new Set(updated.map((l) => l.lockerId));
          const missing = DEFAULT_LOCKERS.filter((l) => !existingIds.has(l.lockerId));
          const finalLockers = [...updated, ...missing];
          localStorage.setItem(LOCKERS_KEY, JSON.stringify(finalLockers));
          return finalLockers;
        }
      }
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
  //
  // W5 — chỉ cập nhật trạng thái `doorOpen` khi server XÁC NHẬN lệnh thành công.
  // Trước đây hàm này bắn lệnh rồi set `doorOpen: true` ngay, không chờ kết quả:
  // backend trả 401/403 thì admin vẫn thấy cửa mở trong khi cửa đóng — nguy hiểm hơn báo lỗi.
  forceUnlockCompartment: async (lockerId, compIndex) => {
    const ok = await store.triggerMqttCommand(lockerId, compIndex, 'OPEN_DOOR', 'ADMIN_FORCE_UNLOCK');

    if (!ok) {
      // KHÔNG set doorOpen. Trả false để màn hình hiện cảnh báo cho admin.
      return false;
    }

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
    return true;
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

  // Bắn lệnh MQTT trực tiếp từ Web UI xuống Backend qua API.
  //
  // W5 — BẮT BUỘC: hàm này trả về true/false theo kết quả THẬT của server.
  // Trước đây nó `await fetch(...)` rồi bỏ qua response: backend trả 401/403/500 thì
  // UI vẫn báo "đã mở cửa" trong khi cửa không mở. Với nút "mở khóa khẩn cấp" của
  // admin, báo thành công giả còn nguy hiểm hơn báo lỗi — nên phải kiểm res.ok.
  triggerMqttCommand: async (lockerId, compIndex, action = 'OPEN_DOOR', triggeredBy = 'WEB_UI', orderId = null) => {
    try {
      const payload = {
        lockerId: lockerId || 'LOCKER_HN_01',
        compIndex: compIndex || 1,
        action: action || 'OPEN_DOOR',
        triggeredBy: triggeredBy,
        orderId: orderId || null,
      };
      const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : 'http://localhost:8080/api';

      if (typeof fetch === 'undefined') {
        return false;
      }

      // Gắn token phiên đăng nhập — backend đã bật xác thực, /api/mqtt/command chỉ cho ADMIN.
      let token = null;
      try {
        const rawUser = localStorage.getItem('smart_locker_user');
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          token = parsed && parsed.token ? parsed.token : null;
        }
      } catch {
        token = null;
      }

      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch(`${baseUrl}/mqtt/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      // 401/403/500 → coi như THẤT BẠI. Không được báo cửa đã mở.
      if (!res.ok) {
        console.warn(`[MQTT Push] Server từ chối lệnh ${triggeredBy} (HTTP ${res.status}) — CỬA CHƯA MỞ.`);
        return false;
      }

      console.log(`[MQTT Push] Sent ${triggeredBy} for ${lockerId} #${compIndex} (HTTP ${res.status})`);
      return true;
    } catch (e) {
      console.warn('[MQTT Push] Failed to trigger MQTT command:', e?.message || e);
      return false;
    }
  }
};
