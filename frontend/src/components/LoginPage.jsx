import React, { useState } from 'react';
import { authApi } from '../services/api';
// GĐ52 — logo "ngăn tủ" dùng chung. `Lock` VẪN GIỮ import: dòng ~219 dùng nó làm icon ô mật khẩu
// (không phải logo — điều cấm #3).
import BrandLogo from './BrandLogo';
import { LogIn, AlertCircle, Eye, EyeOff, Lock, Phone } from 'lucide-react';

export default function LoginPage({ onLoginSuccess }) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [canReplaceSession, setCanReplaceSession] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Login form
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  const showLoginError = (message) => {
    const error = message || 'Đăng nhập thất bại.';
    setErrorMsg(error);
    setCanReplaceSession(error.toLowerCase().includes('đang đăng nhập trên một phiên khác'));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setCanReplaceSession(false);
    try {
      const res = await authApi.login({ username: loginUser, password: loginPass });
      if (res.data?.success) {
        onLoginSuccess(res.data.data);
        return;
      }
      showLoginError(res.data?.message);
    } catch (err) {
      showLoginError(err.response?.data?.message || 'Không thể kết nối máy chủ để xác thực tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  const handleReplaceSession = async () => {
    if (!window.confirm('Thao tác này sẽ đăng xuất phiên cũ (nếu còn tồn tại). Bạn có muốn tiếp tục không?')) {
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setCanReplaceSession(false);
    try {
      const res = await authApi.replaceSession({ username: loginUser, password: loginPass });
      if (res.data?.success) {
        onLoginSuccess(res.data.data);
        return;
      }
      showLoginError(res.data?.message);
    } catch (err) {
      showLoginError(err.response?.data?.message || 'Không thể kết nối máy chủ để xác thực tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center p-4 notranslate selection:bg-blue-600 selection:text-white relative">
      {/* GĐ49a — BỎ 3 blob aurora (trước đây `blur-[100..120px]` xanh/tím/cyan).
          Nền phẳng đã đặt ở `index.css` body; LoginPage vẫn tự đặt `bg-slate-100` để trang
          đăng nhập đúng màu ngay cả khi được render ngoài layout chính. */}

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            {/* GĐ52 — logo "ngăn tủ" (44px). Nền bo góc nằm trong SVG nên bỏ lớp `div` nền xanh. */}
            <BrandLogo className="w-11 h-11" />
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Smart<span className="text-blue-600">Locker</span>
            </h1>
          </div>
        </div>

        {/* Card Container — GĐ49a: thẻ trắng viền rõ, không kính mờ */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm relative">
          {/* Error Banner */}
          {errorMsg && (
            <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span className="leading-relaxed font-medium">{errorMsg}</span>
            </div>
          )}

          {canReplaceSession && (
            <div className="mb-4">
              <p className="mb-2 text-xs text-slate-600">
                Nếu bạn không còn sử dụng được phiên cũ, hãy xác nhận để thu hồi phiên đó.
              </p>
              <button
                type="button"
                onClick={handleReplaceSession}
                disabled={loading}
                className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
              >
                Thu hồi phiên cũ và đăng nhập tại đây
              </button>
            </div>
          )}

          {/* Chỉ còn ĐĂNG NHẬP: tài khoản do Admin cấp (tab "Người dùng"); bỏ đăng ký khách và
              khối "Tài khoản mẫu" đăng nhập nhanh. */}
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
                      onChange={(e) => {
                        setLoginUser(e.target.value);
                        setCanReplaceSession(false);
                      }}
                      className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition"
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
                      onChange={(e) => {
                        setLoginPass(e.target.value);
                        setCanReplaceSession(false);
                      }}
                      className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-300 text-slate-900 placeholder:text-slate-400 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition"
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
                  className="w-full ios-btn bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                  ) : (
                    <LogIn className="w-4 h-4 shrink-0" />
                  )}
                  <span>{loading ? 'Đang xác thực hệ thống...' : 'Đăng nhập vào hệ thống'}</span>
                </button>
              </form>
        </div>

        {/* High-Trust Security Badge — GĐ49a: `text-slate-600` để đạt ≥4.5:1 (slate-400 chỉ 2.4:1). */}
      </div>
    </div>
  );
}
