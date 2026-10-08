import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:8080/api',
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
  getById: (id) => api.get(`/orders/${id}`),
  getByPhone: (phone) => api.get(`/orders/by-phone?phone=${phone}`),
};

export const shipperApi = {
  generateToken: (shipperId = 'SHIPPER_001') => api.post(`/shipper/token/generate?shipperId=${shipperId}`),
  verifyToken: (lockerId, dynamicToken) => api.post('/shipper/token/verify', { lockerId, dynamicToken }),
  depositPackage: (data) => api.post('/shipper/deposit', data),
};

export const pickupApi = {
  verifyPickup: (data) => api.post('/pickup/verify', data),
  requestOtp: (orderId) => api.post(`/pickup/request-otp?orderId=${orderId}`),
};

export default api;
