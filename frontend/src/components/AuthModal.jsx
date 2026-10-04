import React, { useState } from 'react';
import { authApi } from '../services/api';
import { LogIn, UserPlus, Shield, Truck, User, X, AlertCircle } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, onLoginSuccess }) {
  const [tab, setTab] = useState('login'); // 'login' hoặc 'register'
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Form đăng nhập
  const [loginUser, setLoginUser] = useState('khachhang');
  const [loginPass, setLoginPass] = useState('123456');

  // Form đăng ký (CHỈ CHO CUSTOMER)
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');

  if (!isOpen) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authApi.login({
        username: loginUser,
        password: loginPass,
      });
      if (res.data && res.data.success) {
        onLoginSuccess(res.data.data);
        onClose();
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (u, p) => {
    setLoginUser(u);
    setLoginPass(p);
    setErrorMsg('');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await authApi.register({
        fullName: regFullName,
        phone: regPhone,
        username: regUsername,
        password: regPassword,
      });
      if (res.data && res.data.success) {
        alert('Đăng ký tài khoản Khách hàng thành công! Đang tự động đăng nhập...');
        onLoginSuccess(res.data.data);
        onClose();
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.message || err.message || 'Đăng ký thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-150 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Lựa chọn Tab */}
        <div className="flex bg-slate-100 p-1 rounded-2xl mb-6">
          <button
            onClick={() => { setTab('login'); setErrorMsg(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition ${
              tab === 'login' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <LogIn className="w-4 h-4" /> Đăng Nhập
          </button>
          <button
            onClick={() => { setTab('register'); setErrorMsg(''); }}
            className={`flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition ${
              tab === 'register' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserPlus className="w-4 h-4" /> Đăng Ký (Khách Hàng)
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TAB 1: ĐĂNG NHẬP (DÀNH CHO CẢ 3 VAI TRÒ) */}
        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Tài khoản hoặc Số điện thoại
              </label>
              <input
                type="text"
                required
                placeholder="VD: khachhang, shipper, admin..."
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Mật khẩu</label>
              <input
                type="password"
                required
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="w-full text-xs px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-md shadow-indigo-600/30"
            >
              {loading ? 'Đang xác thực...' : 'Đăng Nhập'}
            </button>

            {/* PHÍM CHỌN NHANH ĐỂ DEMO */}
            <div className="pt-3 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 block mb-2 text-center">
                Đăng nhập nhanh tài khoản mẫu:
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleQuickLogin('khachhang', '123456')}
                  className="p-2 border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 rounded-xl text-[10px] text-center font-bold text-slate-700 transition"
                >
                  <User className="w-3.5 h-3.5 mx-auto text-indigo-600 mb-0.5" />
                  Khách Hàng
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickLogin('shipper', 'shipper123')}
                  className="p-2 border border-slate-200 hover:border-amber-500 hover:bg-amber-50 rounded-xl text-[10px] text-center font-bold text-slate-700 transition"
                >
                  <Truck className="w-3.5 h-3.5 mx-auto text-amber-600 mb-0.5" />
                  Shipper
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickLogin('admin', 'admin123')}
                  className="p-2 border border-slate-200 hover:border-purple-500 hover:bg-purple-50 rounded-xl text-[10px] text-center font-bold text-slate-700 transition"
                >
                  <Shield className="w-3.5 h-3.5 mx-auto text-purple-600 mb-0.5" />
                  Quản Trị Viên
                </button>
              </div>
            </div>
          </form>
        )}

        {/* TAB 2: ĐĂNG KÝ (CHỈ DÀNH CHO KHÁCH HÀNG) */}
        {tab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3.5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[11px] text-amber-800 leading-relaxed">
              💡 <strong>Lưu ý:</strong> Chức năng đăng ký này <strong>chỉ dành cho Khách Hàng</strong>. 
              Tài khoản <strong>Shipper</strong> và <strong>Quản Trị Viên</strong> sẽ do Quản trị viên cấp trong trang quản trị.
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Họ và tên của bạn</label>
              <input
                type="text"
                required
                placeholder="VD: Nguyễn Văn A"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                className="w-full text-xs px-3.5 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Số điện thoại nhận OTP</label>
              <input
                type="tel"
                required
                placeholder="VD: 0988123456"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
                className="w-full text-xs px-3.5 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Tên đăng nhập</label>
              <input
                type="text"
                required
                placeholder="VD: user01"
                value={regUsername}
                onChange={(e) => setRegUsername(e.target.value)}
                className="w-full text-xs px-3.5 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Mật khẩu</label>
              <input
                type="password"
                required
                placeholder="Tối thiểu 6 ký tự"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                className="w-full text-xs px-3.5 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition shadow-md shadow-indigo-600/30"
            >
              {loading ? 'Đang tạo tài khoản...' : 'Tạo Tài Khoản Khách Hàng'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
