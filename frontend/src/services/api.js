import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

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
};

export const orderApi = {
  checkout: (data) => api.post('/orders/checkout', data),
  getById: (id, phone) => api.get(`/orders/${id}${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`),
  getByPhone: (phone) => api.get(`/orders/by-phone?phone=${encodeURIComponent(phone)}`),
};

export const shipperApi = {
  generateToken: (shipperId = 'SHIPPER_001') => api.post(`/shipper/token/generate?shipperId=${shipperId}`),
  verifyToken: (lockerId, dynamicToken) => api.post('/shipper/token/verify', { lockerId, dynamicToken }),
  depositPackage: (data) => api.post('/shipper/deposit', data),
  getOverdueOrders: (lockerId) => api.get(`/shipper/overdue-orders${lockerId ? `?lockerId=${lockerId}` : ''}`),
  recallOverdue: (orderId) => api.post(`/shipper/recall-overdue?orderId=${encodeURIComponent(orderId)}`),
};

export const pickupApi = {
  verifyPickup: (data) => api.post('/pickup/verify', data),
  requestOtp: (orderId, customerPhone) => 
    api.post(`/pickup/request-otp?orderId=${orderId}${customerPhone ? `&customerPhone=${encodeURIComponent(customerPhone)}` : ''}`),
};

export default api;
