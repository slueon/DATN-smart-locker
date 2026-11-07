import React, { useState } from 'react';
import { authApi } from '../services/api';
import {
  LogIn, UserPlus, Shield, Truck, User,
  AlertCircle, Eye, EyeOff, Lock, Phone,
  CheckCircle2, Sparkles, ArrowRight, Cpu, Layers,
  ChevronRight, Activity
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
      // Fallback demo credentials
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
      console.warn('Backend offline, using demo fallback account:', err);
    }

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
    <div className="min-h-screen text-slate-900 flex items-center justify-center p-4 notranslate selection:bg-blue-600 selection:text-white relative">
      {/* Ambient Apple Aurora Mesh Wallpaper Canvas */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-32 -left-32 w-[650px] h-[650px] bg-gradient-to-br from-blue-500/35 to-indigo-600/30 rounded-full blur-[110px]" />
        <div className="absolute -bottom-32 -right-32 w-[650px] h-[650px] bg-gradient-to-br from-purple-500/30 to-pink-500/25 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-400/20 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200/80 text-blue-700 text-xs font-semibold mb-3 shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-blue-600" />
            <span>Đồ Án Tốt Nghiệp IoT • PTIT 2026</span>
          </div>

          <div className="flex items-center justify-center gap-2.5 mb-2">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Lock className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Smart<span className="text-blue-600">Locker</span>
            </h1>
          </div>
          <p className="text-slate-500 text-xs">
            Hệ thống tủ giao nhận hàng thông minh & bảo mật IoT Kiosk 24/7
          </p>
        </div>

        {/* Crisp Card Container (Apple Liquid Glass Card) */}
        <div className="liquid-glass-card rounded-[28px] p-6 sm:p-8 shadow-2xl relative">
          {/* iOS Segmented Tab Switcher */}
          <div className="ios-segmented-tray flex mb-6 gap-1">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                tab === 'login'
                  ? 'bg-white text-slate-900 shadow-sm border border-black/[0.04]'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng nhập</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                tab === 'register'
                  ? 'bg-white text-slate-900 shadow-sm border border-black/[0.04]'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng ký khách</span>
            </button>
          </div>

          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-4 p-3.5 bg-rose-50/90 border border-rose-200 text-rose-700 text-xs rounded-2xl flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span className="leading-relaxed font-medium">{errorMsg}</span>
            </div>
          )}

          {/* Login Tab */}
          {tab === 'login' && (
            <div className="space-y-5">
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Tên đăng nhập hoặc Số điện thoại
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      placeholder="VD: khachhang hoặc 0988123456"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50/70 hover:bg-white focus:bg-white border border-slate-200/80 text-slate-900 placeholder:text-slate-400 text-xs rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 transition"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700">
                      Mật khẩu
                    </label>
                    <span className="text-[11px] text-blue-600 hover:underline cursor-pointer font-semibold">
                      Quên mật khẩu?
                    </span>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      required
                      placeholder="Nhập mật khẩu truy cập"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50/70 hover:bg-white focus:bg-white border border-slate-200/80 text-slate-900 placeholder:text-slate-400 text-xs rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-600 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full ios-btn bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-2xl text-xs transition shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2 cursor-pointer mt-2 border border-white/20"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  ) : (
                    <LogIn className="w-4 h-4 shrink-0" />
                  )}
                  <span>{loading ? 'Đang xác thực hệ thống...' : 'Đăng nhập vào hệ thống'}</span>
                </button>
              </form>

              {/* 1-Click Quick Login Role Switcher for Demo */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Đăng Nhập Nhanh 1-Chạm (Tài Khoản Mẫu)
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">BCrypt Demo</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickLogin('khachhang', '123456')}
                    disabled={loading}
                    className="ios-btn group flex flex-col items-center gap-1 p-3 bg-blue-50/70 border border-blue-200/80 hover:bg-white hover:border-blue-400 rounded-2xl transition cursor-pointer text-left shadow-xs"
                  >
                    <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-0.5 shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                      <User className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 block text-center">Khách Hàng</span>
                    <span className="text-[10px] text-blue-600 font-mono">123456</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('shipper', 'shipper123')}
                    disabled={loading}
                    className="ios-btn group flex flex-col items-center gap-1 p-3 bg-amber-50/70 border border-amber-200/80 hover:bg-white hover:border-amber-400 rounded-2xl transition cursor-pointer text-left shadow-xs"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center mb-0.5 shadow-md shadow-amber-500/20 group-hover:scale-105 transition-transform">
                      <Truck className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 block text-center">Shipper</span>
                    <span className="text-[10px] text-amber-700 font-mono">shipper123</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('admin', 'admin123')}
                    disabled={loading}
                    className="ios-btn group flex flex-col items-center gap-1 p-3 bg-purple-50/70 border border-purple-200/80 hover:bg-white hover:border-purple-400 rounded-2xl transition cursor-pointer text-left shadow-xs"
                  >
                    <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center mb-0.5 shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform">
                      <Shield className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 block text-center">Quản Trị</span>
                    <span className="text-[10px] text-purple-700 font-mono">admin123</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Register Tab */}
          {tab === 'register' && (
            <div className="space-y-4">
              <div className="bg-blue-50/80 border border-blue-200/70 rounded-2xl p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  Đăng ký tài khoản nhận hàng cá nhân để quản lý bưu kiện và nhận mã OTP mở tủ tự động 24/7 tại Ký túc xá PTIT.
                </span>
              </div>

              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Họ và tên</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Nguyễn Văn An"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/50 hover:bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Số điện thoại (Nhận OTP bưu kiện)</label>
                  <input
                    type="tel"
                    required
                    placeholder="VD: 0988123456"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/50 hover:bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tên đăng nhập</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: nguyenvana"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50/50 hover:bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mật khẩu</label>
                  <div className="relative">
                    <input
                      type={regShowPass ? 'text' : 'password'}
                      required
                      placeholder="Ít nhất 6 ký tự..."
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50/50 hover:bg-white border border-slate-200 text-slate-900 placeholder:text-slate-400 text-xs rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 transition"
                    />
                    <button
                      type="button"
                      onClick={() => setRegShowPass(!regShowPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {regShowPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl text-xs transition shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 cursor-pointer mt-1"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{loading ? 'Đang tạo tài khoản...' : 'Hoàn tất đăng ký'}</span>
                </button>
              </form>
            </div>
          )}
        </div>

        {/* High-Trust Security Badge */}
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span>Mã hóa BCrypt & OTP Kép 60s</span>
          </div>
          <span>•</span>
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-blue-500" />
            <span>Xác thực cảm biến kép MC-38 & HX711</span>
          </div>
        </div>
      </div>
    </div>
  );
}
