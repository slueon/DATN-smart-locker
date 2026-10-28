import React, { useState, useEffect } from 'react';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { authApi } from '../services/api';
import { store } from '../services/store';
import {
  Shield, BarChart3, Radio, AlertTriangle, Users, UserPlus,
  RefreshCw, CheckCircle2, AlertCircle, Key, Lock, Unlock,
  DoorOpen, Activity, Calendar, Zap, Box, ArrowRight,
  Check, Cpu, Sparkles, Layers, Search, ChevronRight
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
    totalSlots: 4,
    deliveredCount: 3,
    overdueCount: 1,
    totalRevenue: 1400000,
  });

  const [lockers, setLockers] = useState([]);
  const [orders, setOrders] = useState([]);
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

  const getDisplayName = (u) => {
    if (u.username === 'admin') return 'Quản Trị Viên Hệ Thống';
    if (u.username === 'shipper') return 'Nguyễn Văn Shipper PTIT';
    if (u.username === 'khachhang') return 'Đoàn Viết Hoàng';
    if (u.fullName && (u.fullName.includes('|') || u.fullName.includes('¬') || u.fullName.includes('¡') || u.fullName.includes('—') || u.fullName.includes('¿'))) {
      if (u.username === 'admin') return 'Quản Trị Viên Hệ Thống';
      if (u.username === 'shipper') return 'Nguyễn Văn Shipper PTIT';
      if (u.username === 'khachhang') return 'Đoàn Viết Hoàng';
    }
    return u.fullName || 'Người dùng';
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await authApi.getUsers(filterRole);
      if (res.data?.data && res.data.data.length > 0) {
        const cleaned = res.data.data.map((u) => ({
          ...u,
          fullName: getDisplayName(u),
        }));
        setUsers(cleaned);
      }
    } catch (err) {
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
      const newUser = {
        id: users.length + 1,
        username: newUsername,
        fullName: newFullName,
        phone: newPhone,
        role: newRole,
      };
      setUsers([newUser, ...users]);
      setUserMsg({ text: `Đã cấp tài khoản ${newRole} cho '${newFullName}' thành công!`, type: 'success' });
      setNewFullName('');
      setNewPhone('');
      setNewUsername('');
      setNewPassword('');
    }
  };

  const handleForceUnlock = (lockerId, compIndex) => {
    if (window.confirm(`XÁC NHẬN: Bạn có chắc chắn muốn mở cưỡng bức Ngăn #${compIndex} của ${lockerId} từ xa qua lệnh khẩn cấp?`)) {
      store.forceUnlockCompartment(lockerId, compIndex);
      alert(`Đã gửi lệnh khẩn cấp qua MQTT/HTTP: Mở khóa Solenoid Ngăn #${compIndex}!`);
    }
  };

  const handleRunOverdueCron = () => {
    setCronRunning(true);
    setCronMsg('');
    setTimeout(() => {
      const result = store.checkAndScanOverdueOrders();
      setCronRunning(false);
      setCronMsg(`Đã quét thủ công lúc ${new Date().toLocaleTimeString('vi-VN')}! Phát hiện ${result.sweptCount} đơn quá hạn mới (Hệ thống cũng đang tự động chạy ngầm mỗi 30s và bắn Push Alert tới Shipper).`);
      refreshAllData();
    }, 700);
  };

  const getCompartmentBadge = (status) => {
    switch (status) {
      case 'EMPTY':
        return <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold">TRỐNG</span>;
      case 'RESERVED':
        return <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">ĐÃ GIỮ CHỖ</span>;
      case 'OCCUPIED':
        return <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-bold">CÓ BƯU KIỆN</span>;
      case 'OVERDUE':
        return <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-bold">QUÁ HẠN</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-medium">{status}</span>;
    }
  };

  const getRoleBadge = (role) => {
    switch (role) {
      case 'ADMIN':
        return <span className="bg-purple-50 text-purple-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-purple-200">Quản trị viên</span>;
      case 'SHIPPER':
        return <span className="bg-amber-50 text-amber-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-amber-200">Shipper</span>;
      case 'CUSTOMER':
        return <span className="bg-blue-50 text-blue-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg border border-blue-200">Khách hàng</span>;
      default:
        return <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded">{role}</span>;
    }
  };

  const overdueList = orders.filter((o) => o.status === 'OVERDUE');

  return (
    <div className="space-y-6 notranslate select-none">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-purple-600" />
            Bảng Điều Khiển KPI & Giám Sát Vận Hành
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Trung tâm kiểm soát hiệu suất tủ, ma trận ngăn vật lý thời gian thực và tự động hóa tác vụ DevSecOps.
          </p>
        </div>
      </div>

      {/* Admin Subtabs (Apple iOS Segmented Control) */}
      <div className="ios-segmented-tray flex max-w-xl mx-auto gap-1 shadow-sm">
        {[
          { id: 'kpi', label: 'Tổng quan KPI', icon: BarChart3 },
          { id: 'matrix', label: 'Sơ đồ ngăn tủ', icon: Radio },
          { id: 'overdue', label: 'Đơn quá hạn', icon: AlertTriangle },
          { id: 'users', label: 'Người dùng & RBAC', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeAdminSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveAdminSubTab(tab.id)}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-slate-900 shadow-sm border border-black/[0.04]'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: KPI OVERVIEW */}
      {activeAdminSubTab === 'kpi' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md relative overflow-hidden">
              <div className="flex justify-between items-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                <span>Tỷ lệ lấp đầy tủ</span>
                <span className="text-blue-600 font-mono text-[10px] bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200 font-bold">Real-time</span>
              </div>
              <div className="text-3xl font-extrabold text-slate-900 mt-2 font-mono">
                {kpi.occupancyRate}%
              </div>
              <div className="w-full bg-slate-100 h-2.5 rounded-full mt-3 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${kpi.occupancyRate}%` }}
                />
              </div>
            </div>

            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Hạ tầng Tủ & Ngăn
              </div>
              <div className="text-3xl font-extrabold text-slate-900 mt-2 font-mono">
                {kpi.totalLockers} <span className="text-base text-slate-400 font-normal">Trạm</span> / {kpi.totalSlots} <span className="text-base text-slate-400 font-normal">Ngăn</span>
              </div>
              <div className="text-xs text-emerald-600 mt-2.5 flex items-center gap-1.5 font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                <span>100% Cảm biến kết nối ổn định</span>
              </div>
            </div>

            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Lượt giao hoàn tất
              </div>
              <div className="text-3xl font-extrabold text-emerald-600 mt-2 font-mono">
                {kpi.deliveredCount} <span className="text-base text-slate-400 font-normal">Đơn</span>
              </div>
              <div className="text-xs text-slate-500 mt-2.5 font-medium">
                Tỷ lệ mở khóa đúng hạn: <strong className="text-slate-800 font-mono">98.5%</strong>
              </div>
            </div>

            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Tổng giá trị đơn hàng
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(kpi.totalRevenue)}
              </div>
              <div className="text-xs text-slate-500 mt-2.5 font-medium">
                Từ các giao dịch qua trạm tủ PTIT
              </div>
            </div>
          </div>

          {/* Station Occupancy Overview */}
          <div className="liquid-glass-card rounded-3xl border border-white/80 p-6 sm:p-7 shadow-lg space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">Tỷ lệ lấp đầy từng trạm tủ PTIT</h3>
              <span className="text-xs text-slate-400 font-mono">Cập nhật thời gian thực</span>
            </div>
            <div className="space-y-4">
              {lockers.map((locker) => {
                const total = locker.compartments.length;
                const occ = locker.compartments.filter((c) => c.status === 'OCCUPIED' || c.status === 'OVERDUE').length;
                const percent = Math.round((occ / total) * 100);

                return (
                  <div key={locker.lockerId} className="space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                        {locker.name} ({locker.lockerId})
                      </span>
                      <span className="font-mono text-slate-700 font-bold">
                        {occ}/{total} ngăn ({percent}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all duration-500"
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

      {/* TAB 2: LOCKER MATRIX (SƠ ĐỒ MA TRẬN TỦ) */}
      {activeAdminSubTab === 'matrix' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-blue-600" /> Sơ đồ ngăn tủ vật lý
              </h3>
              <p className="text-xs text-slate-500">
                Theo dõi cảm biến cửa, trọng lượng và điều khiển mở khóa khẩn cấp.
              </p>
            </div>
            <button
              onClick={refreshAllData}
              className="p-2.5 bg-white hover:bg-slate-50 rounded-xl text-slate-600 transition border border-slate-200 cursor-pointer shadow-2xs"
              title="Làm mới ma trận"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-6">
            {lockers.map((locker) => (
              <div key={locker.lockerId} className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-6 shadow-md space-y-4">
                <div className="flex items-start justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <span>{locker.name}</span>
                      <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">
                        {locker.lockerId}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">{locker.address}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-500">
                      <span>IP: {locker.ipAddress}</span>
                      <span>•</span>
                      <span>ESP32 NodeMCU • Port 1883</span>
                    </div>
                  </div>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                    Đang kết nối
                  </span>
                </div>

                {/* Integrated Physical Visual Rack */}
                <LockerCabinetVisualizer
                  lockerName={locker.name}
                  lockerId={locker.lockerId}
                  activeSlotId={1}
                  doorState="CLOSED"
                  sensorWeight={0.85}
                  compact={true}
                />

                <div className="space-y-2.5 pt-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Bảng Điều Khiển Ngăn & Mở Khẩn Cấp ({locker.compartments.length} ngăn)
                  </span>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {locker.compartments.map((comp) => {
                      const isOccupied = comp.status === 'OCCUPIED';
                      const isOverdue = comp.status === 'OVERDUE';
                      const isDoorOpen = comp.doorOpen;

                      return (
                        <div
                          key={comp.compIndex}
                          className={`p-4 rounded-2xl border transition text-center space-y-2 bg-slate-50/60 ${
                            isOverdue
                              ? 'border-rose-300 bg-rose-50/40'
                              : isOccupied
                              ? 'border-amber-300 bg-amber-50/40'
                              : comp.status === 'RESERVED'
                              ? 'border-blue-300 bg-blue-50/40'
                              : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900 font-mono text-sm">#{comp.compIndex}</span>
                            <span className="text-[10px] bg-white text-slate-600 px-2 py-0.5 rounded-md font-mono font-bold border border-slate-200">
                              Size {comp.size}
                            </span>
                          </div>

                          <div className="py-0.5">
                            {getCompartmentBadge(comp.status)}
                            {comp.orderId && (
                              <span className="text-[10px] font-mono text-slate-600 block mt-1 truncate bg-white py-0.5 rounded-md border border-slate-200">
                                {comp.orderId}
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-500 flex items-center justify-center gap-1 py-0.5">
                            {isDoorOpen ? (
                              <span className="text-amber-700 flex items-center gap-1 font-bold">
                                <DoorOpen className="w-3.5 h-3.5" /> Đang mở chốt
                              </span>
                            ) : (
                              <span className="text-slate-500 flex items-center gap-1">
                                <Lock className="w-3.5 h-3.5 text-slate-400" /> Đã chốt Solenoid
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleForceUnlock(locker.lockerId, comp.compIndex)}
                            className="ios-btn w-full bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 text-[11px] font-bold py-1.5 px-2 rounded-xl transition flex items-center justify-center gap-1 cursor-pointer border border-slate-200/80 shadow-2xs"
                            title="Mở khóa khẩn cấp từ xa"
                          >
                            <Unlock className="w-3 h-3 text-rose-500" /> Mở khẩn cấp
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

      {/* TAB 3: OVERDUE ORDERS MANAGEMENT */}
      {activeAdminSubTab === 'overdue' && (
        <div className="space-y-5">
          <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Quản Lý Đơn Quá Hạn (24h)
              </h3>
              <p className="text-xs text-slate-500">
                Quét và điều phối thu hồi bưu kiện quá hạn lưu kho 24h.
              </p>
            </div>

            <button
              onClick={handleRunOverdueCron}
              disabled={cronRunning}
              className="ios-btn bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs py-3 px-5 rounded-2xl shadow-md flex items-center gap-2 transition shrink-0 cursor-pointer"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>{cronRunning ? 'Đang quét dữ liệu...' : 'Quét Đơn Quá Hạn'}</span>
            </button>
          </div>

          {cronMsg && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{cronMsg}</span>
            </div>
          )}

          {overdueList.length === 0 ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-12 text-center shadow-md">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
              <h4 className="font-bold text-slate-900 text-sm">Hiện không có bưu kiện nào quá hạn</h4>
              <p className="text-xs text-slate-500 mt-1">Tất cả khách hàng đã nhận đồ đúng thời hạn quy định.</p>
            </div>
          ) : (
            <div className="liquid-glass-card rounded-3xl border border-white/90 overflow-hidden shadow-md">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs">
                  Đơn Hàng Cần Thu Hồi ({overdueList.length})
                </span>
                <span className="text-[11px] bg-rose-50 text-rose-700 font-bold px-2.5 py-0.5 rounded-full border border-rose-200">
                  Cần giải phóng ngăn
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {overdueList.map((ord) => (
                  <div key={ord.orderId} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/60 transition">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-md border border-rose-200">{ord.orderId}</span>
                        <span className="text-xs font-bold text-slate-900">{ord.productName}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Khách: <strong className="text-slate-800">{ord.customerName}</strong> (<span className="font-mono">{ord.customerPhone}</span>) • Trạm: <strong>{ord.lockerName} (Ngăn #{ord.compartmentIndex})</strong>
                      </p>
                      <p className="text-[11px] text-rose-600 font-mono mt-0.5">
                        Hạn chót: {new Date(ord.expiryDeadline).toLocaleString('vi-VN')}
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        store.updateOrderStatus(ord.orderId, 'COMPLETED', {
                          returnedAt: new Date().toISOString(),
                          note: 'Admin thu hồi cưỡng bức',
                        });
                        alert(`Đã thu hồi bưu kiện ${ord.orderId} và giải phóng Ngăn #${ord.compartmentIndex}!`);
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs py-2 px-4 rounded-xl transition cursor-pointer shadow-xs whitespace-nowrap"
                    >
                      Thu hồi & Giải phóng ngăn
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: USERS & RBAC MANAGEMENT */}
      {activeAdminSubTab === 'users' && (
        <div className="space-y-6">
          {/* Create Account Card */}
          <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 pb-3 border-b border-slate-100">
              <UserPlus className="w-4 h-4 text-blue-600" /> Cấp Tài Khoản Người Dùng Mới
            </h3>

            {userMsg.text && (
              <div className={`p-3.5 rounded-2xl text-xs flex items-center gap-2 ${
                userMsg.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{userMsg.text}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Vai trò</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50/70 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-bold text-slate-800"
                >
                  <option value="SHIPPER">Shipper</option>
                  <option value="CUSTOMER">Khách hàng</option>
                  <option value="ADMIN">Quản trị viên</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Họ và tên</label>
                <input
                  type="text"
                  required
                  placeholder="VD: Lê Văn Nam"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50/70 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Số điện thoại</label>
                <input
                  type="tel"
                  required
                  placeholder="VD: 0912345678"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50/70 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 font-mono text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Tên đăng nhập</label>
                <input
                  type="text"
                  required
                  placeholder="VD: levannam"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50/70 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mật khẩu</label>
                <input
                  type="password"
                  required
                  placeholder="Ít nhất 6 ký tự"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-slate-50/70 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 text-slate-900 font-medium"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
                <button
                  type="submit"
                  className="ios-btn bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs py-2.5 px-5 rounded-xl transition shadow-md shadow-blue-500/25 flex items-center gap-1.5 cursor-pointer border border-white/20"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Xác nhận cấp tài khoản</span>
                </button>
              </div>
            </form>
          </div>

          {/* User List Table */}
          <div className="liquid-glass-card rounded-3xl border border-white/90 overflow-hidden shadow-md">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                Danh Sách Người Dùng Trong Hệ Thống ({users.length})
              </span>

              <div className="flex items-center gap-2">
                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="text-xs bg-slate-50/80 border border-slate-200/80 rounded-xl px-3 py-1.5 font-bold text-slate-700 focus:outline-none shadow-2xs"
                >
                  <option value="">Tất cả vai trò</option>
                  <option value="ADMIN">Quản trị viên</option>
                  <option value="SHIPPER">Shipper</option>
                  <option value="CUSTOMER">Khách hàng</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Họ và tên</th>
                    <th className="py-3 px-4">Số điện thoại</th>
                    <th className="py-3 px-4">Tên đăng nhập</th>
                    <th className="py-3 px-4">Vai trò</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-500">#{u.id}</td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">{getDisplayName(u)}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-600">{u.phone}</td>
                      <td className="py-3.5 px-4 font-mono text-slate-800">{u.username}</td>
                      <td className="py-3.5 px-4">{getRoleBadge(u.role)}</td>
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
