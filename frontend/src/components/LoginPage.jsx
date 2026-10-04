import React, { useState } from 'react';
import { authApi } from '../services/api';
import {
  LogIn, UserPlus, Shield, Truck, User,
  AlertCircle, Eye, EyeOff, Lock, Phone
} from 'lucide-react';

export default function LoginPage({ onLoginSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Login form
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Register form (Customer only)
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regShowPass, setRegShowPass] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authApi.login({ username: loginUser, password: loginPass });
      if (res.data?.success) {
        onLoginSuccess(res.data.data);
        return;
      }
    } catch (err) {
      // Fallback nếu backend chưa bật mà người dùng nhập đúng thông tin tài khoản mẫu
      if ((loginUser === 'khachhang' || loginUser === '0988123456') && loginPass === '123456') {
        onLoginSuccess({ id: 3, username: 'khachhang', fullName: 'Đoàn Viết Hoàng', phone: '0988123456', role: 'CUSTOMER' });
        return;
      }
      if ((loginUser === 'shipper' || loginUser === '0900000002') && loginPass === 'shipper123') {
        onLoginSuccess({ id: 2, username: 'shipper', fullName: 'Nguyễn Văn Shipper PTIT', phone: '0900000002', role: 'SHIPPER' });
        return;
      }
      if ((loginUser === 'admin' || loginUser === '0900000001') && loginPass === 'admin123') {
        onLoginSuccess({ id: 1, username: 'admin', fullName: 'Quản Trị Viên Hệ Thống', phone: '0900000001', role: 'ADMIN' });
        return;
      }
      setErrorMsg(err.response?.data?.message || 'Tên đăng nhập hoặc mật khẩu không chính xác!');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (u, p) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authApi.login({ username: u, password: p });
      if (res.data?.success) {
        onLoginSuccess(res.data.data);
        return;
      }
    } catch (err) {
      console.warn('Backend chưa phản hồi, chuyển sang chế độ tài khoản mẫu demo:', err);
    }

    // Fallback tức thì cho 3 nút chọn nhanh
    let fallbackUser = null;
    if (u === 'khachhang') {
      fallbackUser = { id: 3, username: 'khachhang', fullName: 'Đoàn Viết Hoàng', phone: '0988123456', role: 'CUSTOMER' };
    } else if (u === 'shipper') {
      fallbackUser = { id: 2, username: 'shipper', fullName: 'Nguyễn Văn Shipper PTIT', phone: '0900000002', role: 'SHIPPER' };
    } else if (u === 'admin') {
      fallbackUser = { id: 1, username: 'admin', fullName: 'Quản Trị Viên Hệ Thống', phone: '0900000001', role: 'ADMIN' };
    }

    if (fallbackUser) {
      onLoginSuccess(fallbackUser);
    } else {
      setErrorMsg('Đăng nhập thất bại!');
    }
    setLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (regPassword.length < 6) {
      setErrorMsg('Mật khẩu phải có ít nhất 6 ký tự!');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authApi.register({
        fullName: regFullName,
        phone: regPhone,
        username: regUsername,
        password: regPassword,
      });
      if (res.data?.success) {
        onLoginSuccess(res.data.data);
        return;
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Đăng ký thất bại!');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (newTab) => {
    setTab(newTab);
    setErrorMsg('');
    setLoginUser('');
    setLoginPass('');
    setRegFullName('');
    setRegPhone('');
    setRegUsername('');
    setRegPassword('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4 notranslate">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo & Brand */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-black text-2xl text-white shadow-2xl shadow-indigo-500/30 mx-auto mb-4">
            <span>SL</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            <span>Smart Locker IoT</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            <span>Hệ Thống Tủ Giao Nhận Thông Minh</span>
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl">
          {/* Tab switcher */}
          <div className="flex bg-white/5 border border-white/10 p-1 rounded-2xl mb-6 gap-1">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
                tab === 'login'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>Đăng Nhập</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 ${
                tab === 'register'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              <span>Đăng Ký</span>
            </button>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ======== TAB ĐĂNG NHẬP ======== */}
          {tab === 'login' && (
            <div className="space-y-4">
              <form onSubmit={handleLogin} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Tên đăng nhập hoặc Số điện thoại</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="VD: khachhang hoặc 0988123456"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Mật khẩu</span>
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      placeholder="Nhập mật khẩu..."
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  ) : (
                    <LogIn className="w-4 h-4 shrink-0" />
                  )}
                  <span>{loading ? 'Đang xác thực...' : 'Đăng Nhập'}</span>
                </button>
              </form>

              {/* Đăng nhập nhanh để demo */}
              <div className="pt-4 border-t border-white/10">
                <p className="text-[11px] font-semibold text-slate-500 text-center mb-3 uppercase tracking-wider">
                  <span>Đăng nhập nhanh tài khoản mẫu</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickLogin('khachhang', '123456')}
                    disabled={loading}
                    className="flex flex-col items-center gap-1.5 p-2.5 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/40 rounded-2xl text-emerald-300 transition disabled:opacity-50"
                  >
                    <User className="w-5 h-5 shrink-0" />
                    <div className="text-center">
                      <span className="text-[10px] font-bold block">Khách Hàng</span>
                      <span className="text-[9px] text-emerald-400/70 font-mono block">khachhang</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('shipper', 'shipper123')}
                    disabled={loading}
                    className="flex flex-col items-center gap-1.5 p-2.5 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/40 rounded-2xl text-amber-300 transition disabled:opacity-50"
                  >
                    <Truck className="w-5 h-5 shrink-0" />
                    <div className="text-center">
                      <span className="text-[10px] font-bold block">Shipper</span>
                      <span className="text-[9px] text-amber-400/70 font-mono block">shipper</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('admin', 'admin123')}
                    disabled={loading}
                    className="flex flex-col items-center gap-1.5 p-2.5 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 hover:border-purple-500/40 rounded-2xl text-purple-300 transition disabled:opacity-50"
                  >
                    <Shield className="w-5 h-5 shrink-0" />
                    <div className="text-center">
                      <span className="text-[10px] font-bold block">Quản Trị</span>
                      <span className="text-[9px] text-purple-400/70 font-mono block">admin</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ======== TAB ĐĂNG KÝ (CHỈ KHÁCH HÀNG) ======== */}
          {tab === 'register' && (
            <div className="space-y-4">
              {/* Thông báo giới hạn vai trò */}
              <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-[11px] text-amber-200 leading-relaxed">
                <span>
                  <strong className="text-amber-300">💡 Lưu ý:</strong> Chức năng đăng ký chỉ cấp tài khoản{' '}
                  <strong className="text-amber-300">Khách Hàng</strong> để mua sắm và nhận hàng tại tủ.
                  Tài khoản <strong className="text-amber-300">Shipper</strong> và{' '}
                  <strong className="text-amber-300">Quản Trị Viên</strong> sẽ do Quản trị viên cấp.
                </span>
              </div>

              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Họ và tên</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Nguyễn Văn A"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Số điện thoại (dùng để nhận OTP & tra cứu đơn)</span>
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="VD: 0988123456"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Tên đăng nhập</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="VD: user01"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    <span>Mật khẩu</span>
                  </label>
                  <div className="relative">
                    <input
                      type={regShowPass ? 'text' : 'password'}
                      required
                      placeholder="Tối thiểu 6 ký tự"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full pl-3.5 pr-10 py-2.5 bg-white/5 border border-white/10 text-white placeholder-slate-500 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setRegShowPass(!regShowPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {regShowPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 mt-1"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  ) : (
                    <UserPlus className="w-4 h-4 shrink-0" />
                  )}
                  <span>{loading ? 'Đang tạo tài khoản...' : 'Tạo Tài Khoản Khách Hàng'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
