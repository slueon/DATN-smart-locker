import axios from 'axios';

const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL : 'http://localhost:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

/* ─────────────────────────────────────────────────────────────────────────────
 * W4 — Xác thực Bearer token.
 *
 * Backend đã bật Spring Security: mọi endpoint (trừ /auth/login và /auth/register)
 * đều đòi `Authorization: Bearer <token>`. Token được cấp khi login và lưu trong
 * localStorage.smart_locker_user.token (do LoginPage lưu nguyên object user trả về).
 *
 * Hai điều bắt buộc, nếu làm sai sẽ gây lỗi rất khó hiểu cho người dùng:
 *
 * 1. KHÔNG có token thì KHÔNG được gọi API kèm vòng lặp đăng nhập. Nhánh fallback
 *    của LoginPage.jsx tạo user KHÔNG có token (khi backend lỗi); nếu request 401
 *    mà ta cứ xoá phiên + reload() thì sẽ thành vòng lặp reload vô hạn, người dùng
 *    thấy như "gõ đúng mật khẩu mà không vào được".
 *
 * 2. Chỉ điều hướng về trang đăng nhập MỘT LẦN bằng cờ `redirecting`, và không
 *    reload khi đường dẫn hiện tại đã là trang đăng nhập.
 * ───────────────────────────────────────────────────────────────────────────── */

const USER_KEY = 'smart_locker_user';

/** Đọc token phiên hiện tại từ localStorage. Không có thì trả null. */
export const getAuthToken = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user && user.token ? user.token : null;
  } catch {
    return null;
  }
};

/** Xoá phiên đăng nhập ở client. */
export const clearAuthSession = () => {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* localStorage bị chặn — bỏ qua */
  }
};

// Cờ chống vòng lặp: chỉ xử lý 401 một lần cho tới khi trang được tải lại.
let redirecting = false;

const isOnLoginScreen = () => {
  if (typeof window === 'undefined') return true;
  const path = (window.location.pathname || '').toLowerCase();
  const hash = (window.location.hash || '').toLowerCase();
  // Không đoán theo route cụ thể — coi "đang ở màn đăng nhập" khi đường dẫn
  // không có dấu hiệu của ứng dụng đã đăng nhập, hoặc do chính ta vừa điều hướng.
  return redirecting || path.includes('login') || hash.includes('login') || path === '/' || path === '';
};

api.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;

    // 401: token sai / hết hạn / không có. Phiên không còn dùng được.
    if (status === 401) {
      // Nếu request không hề mang token thì đây là "chưa đăng nhập", không phải "hết phiên"
      // → chỉ xoá phiên, KHÔNG điều hướng, KHÔNG reload (tránh vòng lặp với nhánh fallback).
      const hadToken = Boolean(error?.config?.headers?.Authorization);

      clearAuthSession();

      if (hadToken && !redirecting) {
        redirecting = true;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('smart_locker_unauthorized'));
          // Tải lại trang để App.jsx đọc lại localStorage (đã xoá) và hiện màn đăng nhập.
          window.location.reload();
        }
      }
    }

    // 403: đã đăng nhập nhưng không đủ quyền — KHÔNG xoá phiên, chỉ trả lỗi cho màn hình xử lý.
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  createAccountByAdmin: (data) => api.post('/auth/admin/create-user', data),
  getUsers: (role) => api.get(`/auth/users${role ? `?role=${role}` : ''}`),
};

export const productApi = {
  getAll: () => api.get('/products'),
  getById: (id) => api.get(`/products/${id}`),
};

export const lockerApi = {
  getAll: () => api.get('/lockers'),
  getById: (id) => api.get(`/lockers/${id}`),
  getCompartments: (id) => api.get(`/lockers/${id}/compartments`),
  checkCapacity: (lockerId, date) => api.get(`/lockers/${lockerId}/capacity?date=${date}`),
  forceUnlock: (lockerId, compIndex) => api.post(`/lockers/${lockerId}/compartments/${compIndex}/unlock`),

  /**
   * GĐ10 — bảo trì MỘT NGĂN. `body = { lock, reasonCode, note }`.
   * Backend tự lấy username từ token (không nhận từ client) để nhật ký không bị khai man.
   */
  setCompartmentMaintenance: (lockerId, compIndex, body) =>
    api.post(`/lockers/${lockerId}/compartments/${compIndex}/maintenance`, body),

  /** GĐ10 — bảo trì TOÀN TỦ. `body = { lock, reasonCode, note }`. */
  setLockerMaintenance: (lockerId, body) =>
    api.post(`/lockers/${lockerId}/maintenance`, body),
};

export const orderApi = {
  checkout: (data) => api.post('/orders/checkout', data),
  getById: (id, phone) => api.get(`/orders/${id}${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`),
  getByPhone: (phone) => api.get(`/orders/by-phone?phone=${encodeURIComponent(phone)}`),
};

export const shipperApi = {
  // T3: shipperId lấy từ token đăng nhập ở backend — KHÔNG gửi query nữa (trước đây
  // gửi `?shipperId=` và bất kỳ ai cũng khai được shipper khác).
  generateToken: () => api.post('/shipper/token/generate'),
  verifyToken: (lockerId, dynamicToken) => api.post('/shipper/token/verify', { lockerId, dynamicToken }),
  depositPackage: (data) => api.post('/shipper/deposit', data),
  getOverdueOrders: (lockerId) => api.get(`/shipper/overdue-orders${lockerId ? `?lockerId=${lockerId}` : ''}`),
  recallOverdue: (orderId) => api.post(`/shipper/recall-overdue?orderId=${encodeURIComponent(orderId)}`),

  // T3 — đặt trước ngăn trên web.
  getPendingOrders: (lockerId) =>
    api.get('/shipper/orders/pending' + (lockerId ? '?lockerId=' + encodeURIComponent(lockerId) : '')),
  reserveCompartment: (orderId, body) =>
    api.post('/shipper/orders/' + encodeURIComponent(orderId) + '/reserve', body),
  cancelReserve: (orderId) =>
    api.delete('/shipper/orders/' + encodeURIComponent(orderId) + '/reserve'),
};

export const pickupApi = {
  verifyPickup: (data) => api.post('/pickup/verify', data),
  requestOtp: (orderId, customerPhone) => 
    api.post(`/pickup/request-otp?orderId=${orderId}${customerPhone ? `&customerPhone=${encodeURIComponent(customerPhone)}` : ''}`),
};

export const mqttApi = {
  sendCommand: (data) => api.post('/mqtt/command', data),
  getRecentLogs: () => api.get('/mqtt/recent-logs'),
  /** GĐ7 — lịch sử mở tủ (ADMIN xem tất cả, SHIPPER xem lệnh của mình). */
  getCommandLogs: (lockerId, limit) => {
    const params = new URLSearchParams();
    if (lockerId) params.set('lockerId', lockerId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return api.get(`/mqtt/command-logs${qs ? `?${qs}` : ''}`);
  },
};

/**
 * GĐ7 — API quản trị. Chỉ vai trò ADMIN gọi được (backend khoá bằng
 * `.requestMatchers("/api/admin/**").hasRole("ADMIN")`); SHIPPER/CUSTOMER sẽ nhận 403.
 */
export const adminApi = {
  /** Danh sách đơn, lọc tuỳ chọn theo trạng thái / tủ. */
  getOrders: (status, lockerId) => {
    const params = new URLSearchParams();
    if (status && status !== 'ALL') params.set('status', status);
    if (lockerId && lockerId !== 'ALL') params.set('lockerId', lockerId);
    const qs = params.toString();
    return api.get(`/admin/orders${qs ? `?${qs}` : ''}`);
  },

  /** GĐ10 — nhật ký bảo trì tủ/ngăn (ai khoá, vì sao, lúc nào). */
  getMaintenanceLogs: (lockerId, limit) => {
    const params = new URLSearchParams();
    if (lockerId && lockerId !== 'ALL') params.set('lockerId', lockerId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return api.get(`/admin/maintenance-logs${qs ? `?${qs}` : ''}`);
  },
};

export default api;
