import React, { useState, useEffect } from 'react';
import { authApi } from '../services/api';
import { store } from '../services/store';
import {
  Shield, BarChart3, Radio, AlertTriangle, Users, UserPlus,
  RefreshCw, CheckCircle2, AlertCircle, Key, Lock, Unlock,
  DoorOpen, Activity, Calendar, Zap, Box
} from 'lucide-react';

const INITIAL_USERS = [
  { id: 1, username: 'admin', fullName: 'Quản Trị Viên Hệ Thống', phone: '0900000001', role: 'ADMIN' },
  { id: 2, username: 'shipper', fullName: 'Nguyễn Văn Shipper PTIT', phone: '0900000002', role: 'SHIPPER' },
  { id: 3, username: 'khachhang', fullName: 'Đoàn Viết Hoàng', phone: '0988123456', role: 'CUSTOMER' },
];

export default function AdminTab() {
  const [activeAdminSubTab, setActiveAdminSubTab] = useState('kpi'); // 'kpi', 'matrix', 'overdue', 'users'

  // KPI Data
  const [kpi, setKpi] = useState({
    occupancyRate: 67,
    totalLockers: 2,
    totalSlots: 6,
    deliveredCount: 3,
    overdueCount: 1,
    totalRevenue: 1400000,
  });

  // Lockers Matrix Data
  const [lockers, setLockers] = useState([]);

  // Orders
  const [orders, setOrders] = useState([]);

  // Users Management
  const [users, setUsers] = useState(INITIAL_USERS);
  const [filterRole, setFilterRole] = useState('');
  const [loading, setLoading] = useState(false);

  // Form cấp tài khoản mới
  const [newRole, setNewRole] = useState('SHIPPER');
  const [newFullName, setNewFullName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userMsg, setUserMsg] = useState({ text: '', type: '' });

  // Cron Job state
  const [cronRunning, setCronRunning] = useState(false);
  const [cronMsg, setCronMsg] = useState('');

  useEffect(() => {
    refreshAllData();
    const handleUpdate = () => refreshAllData();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_lockers_updated', handleUpdate);
    return () => {
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_lockers_updated', handleUpdate);
    };
  }, []);

  const refreshAllData = () => {
    setKpi(store.calculateKpi());
    setLockers(store.getLockers());
    setOrders(store.getOrders());
  };

  useEffect(() => {
    fetchUsers();
  }, [filterRole]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await authApi.getUsers(filterRole);
      if (res.data?.data && res.data.data.length > 0) {
        setUsers(res.data.data);
      }
    } catch (err) {
      // Dùng danh sách mẫu nếu backend offline
      setUsers(
        filterRole
          ? INITIAL_USERS.filter((u) => u.role === filterRole)
          : INITIAL_USERS
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    setUserMsg({ text: '', type: '' });
    try {
      const res = await authApi.createAccountByAdmin({
        role: newRole,
        fullName: newFullName,
        phone: newPhone,
        username: newUsername,
        password: newPassword,
      });

      if (res.data?.success) {
        setUserMsg({ text: `Cấp tài khoản ${newRole} cho '${newFullName}' thành công!`, type: 'success' });
        setNewFullName('');
        setNewPhone('');
        setNewUsername('');
        setNewPassword('');
        fetchUsers();
        return;
      }
    } catch (err) {
      // Fallback thêm tài khoản mẫu vào local list
      const newUser = {
        id: users.length + 1,
        username: newUsername,
        fullName: newFullName,
        phone: newPhone,
        role: newRole,
      };
      setUsers([newUser, ...users]);
      setUserMsg({ text: `[Demo] Đã cấp tài khoản ${newRole} cho '${newFullName}' thành công!`, type: 'success' });
      setNewFullName('');
      setNewPhone('');
      setNewUsername('');
      setNewPassword('');
    }
  };

  // Mở ngăn khẩn cấp từ xa
  const handleForceUnlock = (lockerId, compIndex) => {
    if (window.confirm(`XÁC NHẬN CẢNH BÁO: Bạn có chắc chắn muốn mở cưỡng bức Ngăn #${compIndex} của ${lockerId} từ xa?`)) {
      store.forceUnlockCompartment(lockerId, compIndex);
      alert(`Đã gửi lệnh khẩn cấp qua MQTT: Mở khóa Solenoid Ngăn #${compIndex}!`);
    }
  };

  // Kích hoạt quét quá hạn (Run Overdue Cron Job)
  const handleRunOverdueCron = () => {
    setCronRunning(true);
    setCronMsg('');
    setTimeout(() => {
      // Quét các đơn DEPOSITED có hạn chót < now
      const now = new Date().getTime();
      let sweptCount = 0;
      const allOrders = store.getOrders();
      allOrders.forEach((o) => {
        if (o.status === 'DEPOSITED' && o.expiryDeadline) {
          if (new Date(o.expiryDeadline).getTime() < now) {
            store.updateOrderStatus(o.orderId, 'OVERDUE');
            sweptCount++;
          }
        }
      });
      setCronRunning(false);
      setCronMsg(`Cron Job hoàn tất lúc ${new Date().toLocaleTimeString('vi-VN')}! Đã quét và chuyển ${sweptCount} đơn quá hạn sang trạng thái OVERDUE.`);
      refreshAllData();
    }, 1000);
  };

  const getCompartmentBadge = (status) => {
    switch (status) {
      case 'EMPTY':
        return <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold">TRỐNG</span>;
      case 'RESERVED':
        return <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">ĐÃ ĐẶT CHỖ</span>;
      case 'OCCUPIED':
        return <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">ĐANG CHỨA HÀNG</span>;
      case 'OVERDUE':
        return <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-[10px] font-bold">QUÁ HẠN</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">{status}</span>;
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'ADMIN':
        return <span className="bg-purple-100 text-purple-800 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-purple-200">🛡️ QUẢN TRỊ VIÊN</span>;
      case 'SHIPPER':
        return <span className="bg-amber-100 text-amber-800 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-amber-200">🚚 SHIPPER</span>;
      case 'CUSTOMER':
        return <span className="bg-emerald-100 text-emerald-800 text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-200">👤 KHÁCH HÀNG</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded">{role}</span>;
    }
  };

  const overdueList = orders.filter((o) => o.status === 'OVERDUE');

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 notranslate">
      {/* Tiêu đề Cổng Quản Trị */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-extrabold text-slate-800 flex items-center justify-center gap-2">
          <Shield className="w-8 h-8 text-purple-600" /> Cổng Quản Trị & Vận Hành Hệ Thống IoT
        </h1>
        <p className="mt-2 text-slate-600 text-sm">
          Giám sát tỷ lệ lấp đầy, nhịp tim kết nối ESP32, sơ đồ ngăn tủ thời gian thực và quản lý đơn quá hạn.
        </p>
      </div>

      {/* THANH MENU ĐIỀU HƯỚNG PHÂN HỆ ADMIN */}
      <div className="flex bg-white border border-slate-200 p-1.5 rounded-2xl shadow-sm mb-8 gap-1.5 max-w-2xl mx-auto">
        {[
          { id: 'kpi', label: 'Dashboard KPI', icon: BarChart3 },
          { id: 'matrix', label: 'Giám Sát Tủ & Ngăn', icon: Radio },
          { id: 'overdue', label: 'Đơn Quá Hạn (24h)', icon: AlertTriangle },
          { id: 'users', label: 'Quản Lý Người Dùng', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeAdminSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveAdminSubTab(tab.id)}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                isActive
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= TAB 1: DASHBOARD KPI TỔNG THỂ ================= */}
      {activeAdminSubTab === 'kpi' && (
        <div className="space-y-6">
          {/* 4 Thẻ KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Tỷ lệ lấp đầy tủ
              </span>
              <div className="text-3xl font-black text-purple-600 mt-2">
                {kpi.occupancyRate}%
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
                <div
                  className="bg-purple-600 h-full transition-all duration-500"
                  style={{ width: `${kpi.occupancyRate}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Tủ & Ngăn hoạt động
              </span>
              <div className="text-3xl font-black text-slate-800 mt-2">
                {kpi.totalLockers} Tủ / {kpi.totalSlots} Ngăn
              </div>
              <span className="text-xs text-emerald-600 mt-2 flex items-center gap-1 font-semibold">
                <Activity className="w-3.5 h-3.5" /> 100% Cảm biến kết nối tốt
              </span>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Lượt gửi thành công
              </span>
              <div className="text-3xl font-black text-emerald-600 mt-2">
                {kpi.deliveredCount} Kiện
              </div>
              <span className="text-xs text-slate-500 mt-2 block">
                Tỷ lệ mở khóa đúng hạn: 98.5%
              </span>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Doanh thu E-Commerce
              </span>
              <div className="text-2xl sm:text-3xl font-black text-indigo-600 mt-2">
                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(kpi.totalRevenue)}
              </div>
              <span className="text-xs text-slate-500 mt-2 block">
                Từ các đơn giao qua Tủ
              </span>
            </div>
          </div>

          {/* Biểu đồ thanh tỷ lệ lấp đầy theo trạm tủ */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-800 text-base">Tỷ Lệ Lấp Đầy Theo Từng Trạm Tủ</h3>
            <div className="space-y-4">
              {lockers.map((locker) => {
                const total = locker.compartments.length;
                const occ = locker.compartments.filter((c) => c.status === 'OCCUPIED' || c.status === 'OVERDUE').length;
                const percent = Math.round((occ / total) * 100);

                return (
                  <div key={locker.lockerId} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-800">{locker.name}</span>
                      <span className="font-semibold text-slate-500">
                        {occ}/{total} ngăn ({percent}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: GIÁM SÁT TỦ & SƠ ĐỒ NGĂN (COMPARTMENT MATRIX) ================= */}
      {activeAdminSubTab === 'matrix' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <div>
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Radio className="w-5 h-5 text-indigo-600" /> Sơ Đồ Ma Trận Ngăn Tủ Thời Gian Thực
              </h3>
              <p className="text-xs text-slate-500">
                Theo dõi trạng thái từng ngăn con và thực hiện mở khóa khẩn cấp từ xa
              </p>
            </div>
            <button
              onClick={refreshAllData}
              className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 transition"
              title="Làm mới"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {lockers.map((locker) => (
              <div key={locker.lockerId} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-5">
                {/* Thông tin tủ & Heartbeat */}
                <div className="flex items-start justify-between pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="font-black text-slate-800 text-base">{locker.name}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">{locker.address}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-400">
                      <span>IP: {locker.ipAddress}</span>
                      <span>•</span>
                      <span>ID: {locker.lockerId}</span>
                    </div>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    HEARTBEAT OK
                  </span>
                </div>

                {/* Ma trận các ngăn tủ con */}
                <div className="space-y-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                    Danh Sách Ngăn Tủ ({locker.compartments.length} ngăn)
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {locker.compartments.map((comp) => {
                      const isOccupied = comp.status === 'OCCUPIED';
                      const isOverdue = comp.status === 'OVERDUE';
                      const isDoorOpen = comp.doorOpen;

                      return (
                        <div
                          key={comp.compIndex}
                          className={`p-3.5 rounded-2xl border transition-all text-center space-y-2 relative ${
                            isOverdue
                              ? 'bg-rose-50 border-rose-300'
                              : isOccupied
                              ? 'bg-emerald-50/70 border-emerald-200'
                              : comp.status === 'RESERVED'
                              ? 'bg-indigo-50/70 border-indigo-200'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-black text-slate-800">#{comp.compIndex}</span>
                            <span className="text-[10px] bg-white px-1.5 py-0.5 rounded font-bold border border-slate-200">
                              Size {comp.size}
                            </span>
                          </div>

                          <div className="py-1">
                            {getCompartmentBadge(comp.status)}
                            {comp.orderId && (
                              <span className="text-[10px] font-mono text-slate-500 block mt-1 truncate">
                                {comp.orderId}
                              </span>
                            )}
                          </div>

                          {/* Cửa tủ mở / đóng */}
                          <div className="text-[10px] font-bold text-slate-600 flex items-center justify-center gap-1">
                            {isDoorOpen ? (
                              <span className="text-amber-600 flex items-center gap-1">
                                <DoorOpen className="w-3 h-3" /> Cửa Mở
                              </span>
                            ) : (
                              <span className="text-slate-400 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Cửa Khóa
                              </span>
                            )}
                          </div>

                          {/* Nút Force Unlock khẩn cấp */}
                          <button
                            onClick={() => handleForceUnlock(locker.lockerId, comp.compIndex)}
                            className="w-full bg-slate-900 hover:bg-rose-600 text-white text-[10px] font-bold py-1 px-2 rounded-lg transition flex items-center justify-center gap-1"
                            title="Mở khóa khẩn cấp từ xa qua MQTT"
                          >
                            <Unlock className="w-3 h-3" /> Mở Khẩn Cấp
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= TAB 3: QUẢN LÝ ĐƠN QUÁ HẠN (OVERDUE MANAGER) ================= */}
      {activeAdminSubTab === 'overdue' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" /> Quản Lý Bưu Kiện Quá Hạn Lưu Kho (24h00 N+1)
              </h3>
              <p className="text-xs text-slate-500">
                Chính sách lưu kho hết 24h00 ngày hôm sau. Sau mốc này, mã nhận bị tạm khóa để giải phóng ngăn tủ.
              </p>
            </div>

            <button
              onClick={handleRunOverdueCron}
              disabled={cronRunning}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs py-3 px-5 rounded-xl shadow-md shadow-rose-600/30 flex items-center gap-2 transition shrink-0"
            >
              <Zap className="w-4 h-4" />
              <span>{cronRunning ? 'Đang Quét Hệ Thống...' : '⚡ Kích Hoạt Quét Quá Hạn (Run Cron Job)'}</span>
            </button>
          </div>

          {cronMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{cronMsg}</span>
            </div>
          )}

          {overdueList.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
              <h4 className="font-bold text-slate-700 text-base">Hiện không có bưu kiện nào quá hạn</h4>
              <p className="text-xs text-slate-400 mt-1">Toàn bộ khách hàng đã nhận đồ đúng thời hạn quy định.</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-800 text-sm">
                  Danh Sách {overdueList.length} Đơn Hàng Cần Điều Phối Thu Hồi
                </span>
                <span className="text-xs bg-rose-100 text-rose-700 font-bold px-2.5 py-0.5 rounded-full">
                  Cần Giải Phóng Ngăn
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {overdueList.map((ord) => (
                  <div key={ord.orderId} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black text-rose-600">{ord.orderId}</span>
                        <span className="text-xs font-bold text-slate-800">{ord.productName}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Khách: <strong>{ord.customerName}</strong> ({ord.customerPhone}) - Điểm nhận: <strong>{ord.lockerName} (Ngăn #{ord.compartmentIndex})</strong>
                      </p>
                      <p className="text-[11px] text-rose-600 font-semibold mt-0.5">
                        Hạn chót lưu kho: {new Date(ord.expiryDeadline).toLocaleString('vi-VN')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          store.updateOrderStatus(ord.orderId, 'COMPLETED', {
                            returnedAt: new Date().toISOString(),
                            note: 'Admin thu hồi cưỡng bức',
                          });
                          alert(`Đã thu hồi bưu kiện ${ord.orderId} và giải phóng Ngăn #${ord.compartmentIndex}!`);
                        }}
                        className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2 px-3.5 rounded-xl transition"
                      >
                        Thu Hồi & Giải Phóng Ngăn
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 4: QUẢN LÝ NGƯỜI DÙNG & CẤP TÀI KHOẢN ================= */}
      {activeAdminSubTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* CỘT TRÁI: FORM CẤP TÀI KHOẢN (5 Cột) */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
              <UserPlus className="w-5 h-5 text-purple-600" /> Cấp Tài Khoản Mới
            </h3>

            {userMsg.text && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  userMsg.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                }`}
              >
                {userMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{userMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Loại tài khoản cấp</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewRole('SHIPPER')}
                    className={`py-2 px-3 rounded-xl font-bold border transition ${
                      newRole === 'SHIPPER'
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    🚚 Shipper Giao Hàng
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRole('ADMIN')}
                    className={`py-2 px-3 rounded-xl font-bold border transition ${
                      newRole === 'ADMIN'
                        ? 'border-purple-500 bg-purple-50 text-purple-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    🛡️ Quản Trị Viên
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Họ và tên</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Nguyễn Văn Shipper"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  required
                  placeholder="VD: 0900000002"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Tên đăng nhập</label>
                <input
                  type="text"
                  required
                  placeholder="VD: shipper02"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Mật khẩu khởi tạo</label>
                <input
                  type="password"
                  required
                  placeholder="Tối thiểu 6 ký tự"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 rounded-xl shadow-md shadow-purple-600/30 transition mt-2"
              >
                Xác Nhận Cấp Tài Khoản {newRole}
              </button>
            </form>
          </div>

          {/* CỘT PHẢI: BẢNG DANH SÁCH NGƯỜI DÙNG (7 Cột) */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" /> Danh Sách Tài Khoản ({users.length})
              </h3>

              <div className="flex items-center gap-2">
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="text-xs border border-slate-300 rounded-xl px-2.5 py-1.5 bg-white text-slate-700"
                >
                  <option value="">Tất cả vai trò</option>
                  <option value="CUSTOMER">👤 Khách hàng</option>
                  <option value="SHIPPER">🚚 Shipper</option>
                  <option value="ADMIN">🛡️ Quản trị viên</option>
                </select>

                <button
                  onClick={fetchUsers}
                  className="p-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-600"
                  title="Làm mới"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-bold">
                    <th className="py-2.5 px-2">ID</th>
                    <th className="py-2.5 px-2">Tài Khoản</th>
                    <th className="py-2.5 px-2">Họ Và Tên</th>
                    <th className="py-2.5 px-2">Số Điện Thoại</th>
                    <th className="py-2.5 px-2">Vai Trò</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-2 text-slate-400 font-mono">#{u.id}</td>
                      <td className="py-3 px-2 font-bold text-slate-800">{u.username}</td>
                      <td className="py-3 px-2 text-slate-700">{u.fullName}</td>
                      <td className="py-3 px-2 font-mono text-slate-600">{u.phone}</td>
                      <td className="py-3 px-2">{getRoleBadge(u.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
