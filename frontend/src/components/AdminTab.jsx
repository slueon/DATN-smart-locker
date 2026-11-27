import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
// GĐ41 — bỏ `shipperApi` khỏi import: ADMIN không còn gọi API thu hồi (đã grep cả file, 0 chỗ dùng).
import { authApi, lockerApi, adminApi, mqttApi } from '../services/api';
import { store } from '../services/store';
import { getLockerHealth } from '../utils/lockerHealth';
import { describeActor, actorBadgeClass } from '../utils/commandLogActor';
import {
  Shield, BarChart3, Radio, AlertTriangle, Users, UserPlus,
  RefreshCw, CheckCircle2, AlertCircle, Key, Lock, Unlock,
  DoorOpen, Activity, Calendar, Zap, Box, Package, ArrowRight,
  Check, Cpu, Sparkles, Layers, Search, ChevronRight, Wrench, Trash2
} from 'lucide-react';

const INITIAL_USERS = [
  { id: 1, username: 'admin', fullName: 'Quản Trị Viên Hệ Thống', phone: '0900000001', role: 'ADMIN' },
  { id: 2, username: 'shipper', fullName: 'Nguyễn Văn Shipper PTIT', phone: '0900000002', role: 'SHIPPER' },
  { id: 3, username: 'khachhang', fullName: 'Đoàn Viết Hoàng', phone: '0988123456', role: 'CUSTOMER' },
];

export default function AdminTab({ currentUser }) {
  const [activeAdminSubTab, setActiveAdminSubTab] = useState('kpi'); // 'kpi', 'matrix', 'overdue', 'users', 'logs'
  const [maintenanceResult, setMaintenanceResult] = useState(null);

  /**
   * GĐ7 — lịch sử mở tủ (`command_logs`) cho tab "Lịch sử mở tủ".
   *
   * <p>Bảng này trước đây đã ghi mọi lệnh mở tủ nhưng không có cách nào xem lại trên web —
   * muốn biết "tủ mở lúc nào, ngăn nào" phải gõ SQL tay. Nay đọc qua
   * `GET /api/mqtt/command-logs` (ADMIN/SHIPPER), tối đa 20 dòng gần nhất cho gọn màn hình.
   */
  const [commandLogs, setCommandLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState(null);

  // KPI Data
  const [kpi, setKpi] = useState({
    occupancyRate: 0,
    totalLockers: 10,
    totalSlots: 20,
    deliveredCount: 0,
    overdueCount: 0,
    totalRevenue: 0,
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
  const [roleUpdatingId, setRoleUpdatingId] = useState(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [adminCustomers, setAdminCustomers] = useState([]);
  const [adminShippers, setAdminShippers] = useState([]);
  const [orderForm, setOrderForm] = useState({
    customerUsername: '',
    lockerId: '',
    shipperUserId: '',
    productName: '',
    totalAmount: '',
  });
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMessage, setOrderMessage] = useState(null);
  const [assigningOrderId, setAssigningOrderId] = useState(null);

  // Cron Job state
  const [cronRunning, setCronRunning] = useState(false);
  const [cronMsg, setCronMsg] = useState('');

  // GĐ41 — ĐÃ XOÁ state `recallMsg` + `recallingOrderId`: ADMIN không còn quyền thu hồi
  // (user chốt 16/11: "quyền thu hồi chỉ có tài khoản shipper"). Bảng đơn quá hạn giờ CHỈ ĐỌC.

  /**
   * GĐ5-B1 — KPI Admin lấy từ API THẬT thay vì localStorage.
   *
   * <p><b>Phần tủ/ngăn dùng API:</b> `lockerApi.getAll()` rồi `lockerApi.getCompartments(id)`
   * cho từng tủ, gọi **song song bằng `Promise.all`** — 10 request tuần tự sẽ chậm gấp 10.
   *
   * <p><b>Công thức giữ đúng logic gốc `store.calculateKpi()`</b> (Chief chốt):
   * <ul>
   *   <li>{@code totalSlots} = MỌI ngăn của mọi tủ — {@code OUT_OF_SERVICE} vẫn tính vì
   *       ngăn đó có thật, chỉ đang bảo trì.</li>
   *   <li>{@code occupiedSlots} = ngăn {@code OCCUPIED} hoặc {@code OVERDUE}.</li>
   *   <li><b>{@code RESERVED} KHÔNG tính vào lấp đầy</b> — shipper đặt trước nhưng chưa có
   *       hàng thật trong ngăn, tính vào sẽ thổi phồng mức sử dụng.</li>
   *   <li>{@code occupancyRate = Math.round(occupied / total * 100)}.</li>
   * </ul>
   * Mốc kiểm với dữ liệu thật hiện tại (19 EMPTY + 1 OCCUPIED trên 20 ngăn): **5%**.
   *
   * <p><b>3 chỉ số đơn hàng VẪN đọc localStorage</b> ({@code deliveredCount},
   * {@code overdueCount}, {@code totalRevenue}) — backend chưa có endpoint trả danh sách đơn
   * cho ADMIN (không có `/api/orders` all), và {`orderApi.getByPhone`} chỉ trả đơn của một
   * SĐT. Ghi vào tồn đọng thay vì tự thêm endpoint ngoài phạm vi thẻ.
   */
  const refreshAllData = async () => {
    try {
      const lockerRes = await lockerApi.getAll();
      const apiLockers = lockerRes?.data?.data || [];

      // Gọi SONG SONG compartments của từng tủ.
      const compLists = await Promise.all(
        apiLockers.map(async (locker) => {
          try {
            const res = await lockerApi.getCompartments(locker.lockerId);
            return { locker, compartments: res?.data?.data || [] };
          } catch {
            // Một tủ lỗi không được làm sập cả dashboard: coi như không có ngăn.
            return { locker, compartments: [] };
          }
        })
      );

      // Gắn `compartments` vào từng tủ để phần hiển thị ma trận phía dưới dùng lại được.
      const mergedLockers = compLists.map(({ locker, compartments }) => ({
        ...locker,
        compartments,
      }));
      setLockers(mergedLockers);

      let totalSlots = 0;
      let occupiedSlots = 0;
      mergedLockers.forEach((l) => {
        l.compartments.forEach((c) => {
          totalSlots++;
          const st = String(c.status || '').toUpperCase();
          if (st === 'OCCUPIED' || st === 'OVERDUE') occupiedSlots++;
        });
      });

      // GĐ7 — 3 chỉ số đơn hàng lấy từ API THẬT (`GET /api/admin/orders`).
      //
      // Trước GĐ7 phải đọc `store.getOrders()` vì backend không có endpoint danh sách đơn cho
      // ADMIN. Hệ quả cũ: `deliveredCount`/`overdueCount`/`totalRevenue` chỉ đúng nếu
      // localStorage đã đồng bộ — số liệu sai lệch so với DB thật mà không ai biết.
      //
      // Lỗi API này KHÔNG được làm hỏng phần tủ/ngăn ở trên (đã tính xong): bọc riêng try/catch,
      // giữ số cũ nếu lỗi thay vì ghi đè bằng 0.
      let deliveredCount = 0;
      let overdueCount = 0;
      let totalRevenue = 0;
      try {
        const ordersRes = await adminApi.getOrders('ALL');
        const apiOrders = ordersRes?.data?.data || [];
        setOrders(apiOrders);
        deliveredCount = apiOrders.filter(
          (o) => o.status === 'DEPOSITED' || o.status === 'COMPLETED'
        ).length;
        overdueCount = apiOrders.filter((o) => o.status === 'OVERDUE').length;
        totalRevenue = apiOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0);
      } catch (orderErr) {
        // 403 (không phải ADMIN) / mất mạng: giữ số 0 thay vì bịa, và nói rõ trong console.
        console.warn('[AdminTab] Không tải được danh sách đơn:', orderErr?.message);
      }

      setKpi({
        occupancyRate: totalSlots > 0 ? Math.round((occupiedSlots / totalSlots) * 100) : 0,
        totalLockers: mergedLockers.length,
        totalSlots,
        deliveredCount,
        overdueCount,
        totalRevenue,
      });
    } catch (err) {
      // Mất mạng / 401: giữ số liệu cũ trên màn hình thay vì xoá trắng dashboard.
      console.warn('[AdminTab] Không tải được danh sách tủ từ API:', err?.message);
    }
  };

  /**
   * GĐ7 — tải 20 lệnh mở tủ gần nhất.
   *
   * <p><b>Vì sao đọc theo tab (không tải cùng KPI):</b> bảng `command_logs` là dữ liệu vận hành,
   * phần lớn lần vào dashboard admin không cần xem. Tải sẵn sẽ làm chậm màn KPI mà không ai
   * dùng. Hàm này chỉ chạy khi bấm vào tab "Lịch sử mở tủ".
   */
  const loadCommandLogs = async () => {
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const res = await mqttApi.getCommandLogs(null, 20);
      setCommandLogs(res?.data?.data || []);
    } catch (err) {
      setLogsError(
        err?.response?.data?.message
          || 'Không tải được lịch sử mở tủ. Kiểm tra quyền ADMIN và backend.'
      );
      setCommandLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  // GĐ7 — chỉ tải lịch sử mở tủ khi thực sự mở tab đó (xem lý do trong `loadCommandLogs`).
  useEffect(() => {
    if (activeAdminSubTab === 'logs') {
      loadCommandLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAdminSubTab]);

  // GĐ8 — logic sức khoẻ trạm đã tách ra utils/lockerHealth.js để LockerNetworkMapTab
  // dùng CHUNG. Giữ hai bản copy là hai màn hình sẽ hiển thị mâu thuẫn ngay khi ai đó sửa
  // ngưỡng ở một nơi. Chỉ còn healthBadgeClass/healthDotClass ở đây vì đó là class
  // Tailwind riêng của màn admin (bản đồ dùng mã màu hex, không dùng class).
  const healthBadgeClass = (tone) => {
    if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (tone === 'amber') return 'bg-amber-50 text-amber-800 border-amber-300';
    if (tone === 'rose') return 'bg-rose-50 text-rose-700 border-rose-200';
    return 'bg-slate-100 text-slate-600 border-slate-300';
  };

  const healthDotClass = (tone) => {
    if (tone === 'emerald') return 'bg-emerald-500 animate-pulse';
    if (tone === 'amber') return 'bg-amber-500';
    if (tone === 'rose') return 'bg-rose-500';
    return 'bg-slate-400';
  };

  const getDisplayName = (u) => {    if (u.username === 'admin') return 'Quản Trị Viên Hệ Thống';
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

  useEffect(() => {
    refreshAllData();
    const refreshTimer = setInterval(refreshAllData, 10000);
    const handleUpdate = () => refreshAllData();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    window.addEventListener('smart_locker_lockers_updated', handleUpdate);
    return () => {
      clearInterval(refreshTimer);
      window.removeEventListener('smart_locker_store_updated', handleUpdate);
      window.removeEventListener('smart_locker_lockers_updated', handleUpdate);
    };
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [filterRole]);

  useEffect(() => {
    if (activeAdminSubTab !== 'orders' && activeAdminSubTab !== 'overdue') return;
    Promise.allSettled([adminApi.getCustomers(), adminApi.getShippers()])
      .then(([customerResult, shipperResult]) => {
        setAdminCustomers(customerResult.status === 'fulfilled'
          ? (customerResult.value?.data?.data || []) : []);
        setAdminShippers(shipperResult.status === 'fulfilled'
          ? (shipperResult.value?.data?.data || []) : []);
      });
  }, [activeAdminSubTab]);

  const handleCreateAdminOrder = async (event) => {
    event.preventDefault();
    setOrderMessage(null);
    if (!orderForm.customerUsername || !orderForm.lockerId) {
      setOrderMessage({ type: 'error', text: 'Chọn khách hàng và tủ đích.' });
      return;
    }
    setOrderBusy(true);
    try {
      const res = await adminApi.createOrder({
        customerUsername: orderForm.customerUsername,
        lockerId: orderForm.lockerId,
        shipperUserId: orderForm.shipperUserId ? Number(orderForm.shipperUserId) : null,
        productName: orderForm.productName.trim(),
        totalAmount: orderForm.totalAmount ? Number(orderForm.totalAmount) : 0,
        paymentMethod: 'ONLINE_VIETQR',
        paymentStatus: 'PAID',
      });
      if (!res?.data?.success) {
        setOrderMessage({ type: 'error', text: res?.data?.message || 'Không thể tạo đơn.' });
        return;
      }
      setOrderMessage({
        type: 'success',
        text: `Đã tạo ${res.data.data.orderId}${res.data.data.assignedShipperUsername
          ? ` và phân công cho ${res.data.data.assignedShipperUsername}.`
          : '. Đơn chưa được phân công.'}`,
      });
      setOrderForm((prev) => ({
        ...prev,
        productName: '',
        totalAmount: '',
      }));
      refreshAllData();
    } catch (err) {
      setOrderMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể tạo đơn.',
      });
    } finally {
      setOrderBusy(false);
    }
  };

  const handleAssignShipper = async (orderId, shipperUserId) => {
    if (!shipperUserId) return;
    setAssigningOrderId(orderId);
    setOrderMessage(null);
    try {
      const res = await adminApi.assignShipper(orderId, { shipperUserId: Number(shipperUserId) });
      if (res?.data?.success) {
        setOrderMessage({ type: 'success', text: `Đã phân công đơn ${orderId}.` });
        refreshAllData();
      } else {
        setOrderMessage({ type: 'error', text: res?.data?.message || 'Không thể phân công.' });
      }
    } catch (err) {
      setOrderMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể phân công đơn.',
      });
    } finally {
      setAssigningOrderId(null);
    }
  };

  const handleDeletePendingOrder = async (orderId) => {
    setAssigningOrderId(orderId);
    setOrderMessage(null);
    try {
      const res = await adminApi.deletePendingOrder(orderId);
      if (res?.data?.success) {
        setOrderMessage({ type: 'success', text: `Đã xoá đơn ${orderId}.` });
        refreshAllData();
      } else {
        setOrderMessage({ type: 'error', text: res?.data?.message || 'Không thể xoá đơn.' });
      }
    } catch (err) {
      setOrderMessage({
        type: 'error',
        text: err?.response?.data?.message || 'Không thể xoá đơn.',
      });
    } finally {
      setAssigningOrderId(null);
    }
  };

  useEffect(() => {
    if (!maintenanceResult) return undefined;
    const timer = setTimeout(() => setMaintenanceResult(null), 5000);
    return () => clearTimeout(timer);
  }, [maintenanceResult]);

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
      setUserMsg({
        text: res.data?.message || 'Máy chủ không tạo được tài khoản.',
        type: 'error',
      });
    } catch (err) {
      setUserMsg({
        text: err?.response?.data?.message || err?.message || 'Không kết nối được máy chủ, tài khoản CHƯA được tạo.',
        type: 'error',
      });
    }
  };

  const handleUpdateUserRole = async (user, role) => {
    if (!user || role === user.role) return;
    setUserMsg({ text: '', type: '' });
    setRoleUpdatingId(user.id);
    try {
      const res = await authApi.updateUserRole(user.id, role);
      if (!res.data?.success || !res.data?.data) {
        setUserMsg({ text: res.data?.message || 'Máy chủ không cập nhật được vai trò.', type: 'error' });
        return;
      }

      const updatedUser = { ...user, ...res.data.data };
      setUsers((previous) => {
        const updated = previous.map((item) => item.id === user.id ? updatedUser : item);
        return filterRole && updatedUser.role !== filterRole
          ? updated.filter((item) => item.id !== user.id)
          : updated;
      });
      setUserMsg({ text: `Đã cập nhật vai trò tài khoản '${user.username}'.`, type: 'success' });
    } catch (err) {
      setUserMsg({
        text: err?.response?.data?.message || err?.message || 'Không thể cập nhật vai trò.',
        type: 'error',
      });
    } finally {
      setRoleUpdatingId(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!pendingDeleteUser) return;
    const user = pendingDeleteUser;
    setUserMsg({ text: '', type: '' });
    setDeletingUserId(user.id);
    try {
      const res = await authApi.deleteUser(user.id);
      if (!res.data?.success) {
        setUserMsg({ text: res.data?.message || 'Máy chủ không xóa được tài khoản.', type: 'error' });
        return;
      }

      setUsers((previous) => previous.filter((item) => item.id !== user.id));
      setPendingDeleteUser(null);
      setUserMsg({ text: `Đã xóa tài khoản '${user.username}'. Lịch sử đơn hàng được giữ nguyên.`, type: 'success' });
    } catch (err) {
      setUserMsg({
        text: err?.response?.data?.message || err?.message || 'Không thể xóa tài khoản.',
        type: 'error',
      });
    } finally {
      setDeletingUserId(null);
    }
  };

  /**
   * GĐ13 — mở khoá khẩn cấp. Bỏ `window.confirm` + 2 `alert()`, dùng xác nhận 2 bước trong trang
   * và một state message duy nhất (`unlockResult`) cho đồng bộ với 2 nút thu hồi/quét ở việc 1.
   *
   * <p>Vì sao phải bỏ `alert`: hộp thoại modal của trình duyệt chặn toàn bộ trang, không style được,
   * không đọc được bằng screen reader nhất quán, và — quan trọng hơn — nó chỉ hiện MỘT LẦN rồi
   * biến mất, nên khi thao tác hàng loạt người vận hành không còn dấu vết nào để đối chiếu. Message
   * trong trang thì ở lại tới lần bấm sau.
   *
   * <p>`store.forceUnlockCompartment` ĐƯỢC GIỮ: bên trong nó gọi API thật
   * (`POST /api/lockers/{id}/compartments/{i}/unlock`) và trả `true` chỉ khi server nhận lệnh — đã
   * sửa từ W5, không phải đường ghi localStorage.
   */
  const [unlockTarget, setUnlockTarget] = useState(null); // { lockerId, compIndex }
  const [unlockResult, setUnlockResult] = useState(null); // { type: 'success'|'error', text }
  const [unlockBusyLocal, setUnlockBusyLocal] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  const handleForceUnlock = (lockerId, compIndex) => {
    // Bước 1: chỉ mở hộp xác nhận, KHÔNG gọi API (0 request).
    setUnlockResult(null);
    setUnlockTarget({ lockerId, compIndex });
  };

  const handleConfirmForceUnlock = async () => {
    if (!unlockTarget) return;
    const { lockerId, compIndex } = unlockTarget;
    setUnlockTarget(null);
    setUnlockBusyLocal(true);
    const ok = await store.forceUnlockCompartment(lockerId, compIndex);
    if (ok) {
      setUnlockResult({
        type: 'success',
        text: `Đã gửi lệnh mở khoá Solenoid Ngăn #${compIndex} của ${lockerId} tới máy chủ.`,
      });
    } else {
      setUnlockResult({
        type: 'error',
        text: `KHÔNG mở được Ngăn #${compIndex}. Máy chủ từ chối hoặc không gửi được lệnh. Cửa tủ VẪN ĐANG ĐÓNG.`,
      });
    }
    setUnlockBusyLocal(false);
  };

  const requestMaintenance = async (lockerId, compIndex, lock) => {
    setMaintenanceBusy(true);
    setMaintenanceResult(null);
    try {
      const body = { lock, reasonCode: 'GIA_CO', note: null };
      if (compIndex != null) {
        await lockerApi.setCompartmentMaintenance(lockerId, compIndex, body);
      } else {
        await lockerApi.setLockerMaintenance(lockerId, body);
      }
      setMaintenanceResult({
        type: 'success',
        text: compIndex != null
          ? `Đã ${lock ? 'khoá' : 'mở khoá'} ngăn #${compIndex} của ${lockerId}.`
          : `Đã ${lock ? 'khoá' : 'mở khoá'} toàn tủ ${lockerId}.`,
      });
      await refreshAllData();
    } catch (err) {
      setMaintenanceResult({
        type: 'error',
        text: err?.response?.data?.message || 'Không thực hiện được bảo trì.',
      });
    } finally {
      setMaintenanceBusy(false);
    }
  };

  /**
   * GĐ13 — quét đơn quá hạn bằng API THẬT.
   *
   * <p>Trước đây gọi `store.checkAndScanOverdueOrders()` — hàm đó duyệt một mảng trong
   * `localStorage` rồi trả `sweptCount`, nên con số "phát hiện X đơn" là của trình duyệt và CSDL
   * không hề đổi. Nay gọi `POST /api/admin/scan-overdue`, chạy đúng tác vụ `@Scheduled` và trả số
   * đơn thật vừa chuyển `OVERDUE`.
   */
  const handleRunOverdueCron = async () => {
    setCronRunning(true);
    setCronMsg('');
    try {
      const res = await adminApi.scanOverdue();
      const changed = res?.data?.data ?? 0;
      setCronMsg(`Đã quét lúc ${new Date().toLocaleTimeString('vi-VN')} — ${changed} đơn vừa chuyển sang OVERDUE. (Hệ thống cũng tự chạy ngầm mỗi 10 phút.)`);
      await refreshAllData();
    } catch (err) {
      setCronMsg(err?.response?.data?.message || 'Không quét được đơn quá hạn. Kiểm tra đăng nhập ADMIN và backend.');
    } finally {
      setCronRunning(false);
    }
  };

  // GĐ41 — ĐÃ XOÁ `handleRecallOverdue`.
  //
  // User chốt 16/11: "quyền thu hồi chỉ có tài khoản shipper". ADMIN chỉ XEM danh sách đơn quá
  // hạn. Lý do kỹ thuật: thu hồi nay bắt buộc xác thực mã QR shipper (GĐ41), mà admin không có
  // phiên QR shipper; `SecurityConfig` cũng đã đổi `recall-overdue` sang `hasRole("SHIPPER")` nên
  // nếu để nút lại thì bấm sẽ ra 403 — nút chết, tệ hơn không có nút.
  // State `recallMsg`/`recallingOrderId` cũng đã xoá (không còn dùng ở đâu khác).

  const getCompartmentBadge = (status) => {
    switch (status) {
      case 'EMPTY':
        return <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-bold">TRỐNG</span>;
      case 'RESERVED':
        return <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">ĐÃ GIỮ CHỖ</span>;
      case 'PENDING_OPENED':
        return <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded text-[10px] font-bold">ĐANG NẠP HÀNG</span>;
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

  /**
   * GĐ49d — hai nhóm tủ, và TỶ LỆ THẬT thay cho 2 con số gõ cứng của GĐ48.
   *
   * <p><b>Vì sao phải tách "tủ thật" / "tủ ảo":</b> phần cứng chỉ có 1 tủ (`Tu_1` → `LOCKER_HN_01`),
   * 9 tủ còn lại là dữ liệu mẫu (`isVirtual = true`) nên KHÔNG bao giờ có nhịp tim. Trộn lẫn thì
   * admin đọc "10 trạm" rồi tưởng 10 thiết bị đang chạy, trong khi 9 cái không tồn tại về phần cứng.
   *
   * <p><b>"X/Y tủ thật có nhịp tim &lt; 5 phút"</b> — thay hẳn chuỗi gõ cứng "100% Cảm biến kết nối
   * ổn định". Nguồn: `lockerApi.getAll()` (`isVirtual`) + `getLockerHealth` (`key === 'ONLINE'`
   * nghĩa là `ageMs &lt;= HEARTBEAT_FRESH_MS = 5 phút`). KHÔNG đọc `connectionStatus`: DB ghi
   * `ONLINE` cho cả 10 tủ dù có tủ im 3 ngày (MAP — bẫy #2), nên con số đó sẽ luôn là "10/10".
   *
   * <p><b>"Tỷ lệ hoàn tất"</b> — thay hẳn "Tỷ lệ mở khóa đúng hạn: 98.5%". Con số 98.5% đó không
   * có nguồn nào trong CSDL/API (không có bảng nào ghi "lần mở khoá có đúng hạn hay không"), nên
   * GIỮ nó là bịa số (điều cấm #3). Tỷ lệ hoàn tất thì tính được từ chính danh sách đơn admin đã
   * tải: `deliveredCount / orders.length`.
   */
  const realLockers = lockers.filter((l) => l?.isVirtual !== true);
  const virtualLockers = lockers.filter((l) => l?.isVirtual === true);
  const realOnline = realLockers.filter((l) => getLockerHealth(l).key === 'ONLINE').length;
  const completionRate = orders.length > 0
    ? Math.round((kpi.deliveredCount / orders.length) * 100)
    : 0;

  return (
    <div className="space-y-6 notranslate select-none">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-2 border-b border-slate-200/80">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-purple-600" />
            Bảng Điều Khiển KPI & Giám Sát Vận Hành
          </h1>
        </div>
      </div>

      {/* Admin Subtabs — GĐ49d: 1 DÒNG, nhãn ngắn. `max-w-xl` cũ (576px) chia 5 tab còn 115px/nút
          nên "Người dùng & RBAC" gãy 2–3 dòng, mà tiêu đề trang lại rộng hơn thanh tab trông lệch.
          Nay tray rộng hết hàng, `whitespace-nowrap` chống gãy chữ, `overflow-x-auto` phòng màn hẹp. */}
      <div className="ios-segmented-tray flex w-full gap-1 shadow-sm overflow-x-auto">
        {[
          { id: 'kpi', label: 'Tổng quan', icon: BarChart3 },
          { id: 'matrix', label: 'Sơ đồ ngăn', icon: Radio },
          { id: 'overdue', label: 'Quá hạn', icon: AlertTriangle },
          { id: 'users', label: 'Người dùng', icon: Users },
          { id: 'orders', label: 'Đơn & phân công', icon: Package },
          // GĐ7 — xem lại lịch sử mở tủ: ai mở, tủ nào, ngăn nào, lúc nào.
          { id: 'logs', label: 'Lịch sử mở tủ', icon: Key },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeAdminSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveAdminSubTab(tab.id)}
              // Màn hẹp: nút giữ đúng bề rộng chữ (`shrink-0`) để tray cuộn ngang — trước đây
              // `flex-1 min-w-0` ép nút nhỏ hơn chữ `nowrap` nên nhãn tràn đè lên nhau (lỗi mobile).
              // Từ `md` trở lên mới chia đều hết hàng như cũ.
              className={`shrink-0 md:flex-1 md:min-w-0 py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-slate-900 shadow-sm border border-black/[0.04]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
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
              <div className="flex justify-between items-center text-xs font-bold text-slate-600 uppercase tracking-wider">
                <span>Tỷ lệ lấp đầy tủ</span>              </div>
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
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Hạ tầng Tủ & Ngăn
              </div>
              <div className="text-3xl font-extrabold text-slate-900 mt-2 font-mono">
                {kpi.totalLockers} <span className="text-base text-slate-600 font-normal">Trạm</span> / {kpi.totalSlots} <span className="text-base text-slate-600 font-normal">Ngăn</span>
              </div>
              {/* GĐ49d — THAY "100% Cảm biến kết nối ổn định". Câu cũ là số gõ cứng, và nó nói
                  ngược màn hình ngay bên cạnh (HN_01 lúc đó đang "Mất kết nối · 1 giờ trước").
                  Nay: đếm tủ THẬT có nhịp tim < 5 phút (`getLockerHealth` = nguồn sự thật duy nhất). */}
              <div className="text-xs text-slate-600 mt-2.5 flex items-center gap-1.5 font-medium">
                <span className={`w-2 h-2 rounded-full inline-block ${
                  realLockers.length > 0 && realOnline === realLockers.length
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-amber-500'
                }`} />
                <span>
                  <strong className={realLockers.length > 0 && realOnline === realLockers.length ? 'text-emerald-700' : 'text-amber-700'}>
                    {realOnline}/{realLockers.length}
                  </strong>
                  {' '}tủ thật có nhịp tim &lt; 5 phút
                </span>
              </div>
            </div>

            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Lượt giao hoàn tất
              </div>
              <div className="text-3xl font-extrabold text-emerald-600 mt-2 font-mono">
                {kpi.deliveredCount} <span className="text-base text-slate-600 font-normal">Đơn</span>
              </div>
              {/* GĐ49d — THAY "Tỷ lệ mở khóa đúng hạn: 98.5%" (số gõ cứng, không nguồn).
                  Nay là tỷ lệ hoàn tất tính từ danh sách đơn admin vừa tải. */}
              <div className="text-xs text-slate-600 mt-2.5 font-medium">
                Tỷ lệ hoàn tất: <strong className="text-slate-800 font-mono">{completionRate}%</strong>
                <span className="text-slate-600"> ({kpi.deliveredCount}/{orders.length} đơn)</span>
              </div>
            </div>

            <div className="liquid-glass-card p-5 sm:p-6 rounded-3xl border border-white/90 shadow-md">
              <div className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Tổng giá trị đơn hàng
              </div>
              <div className="text-2xl font-extrabold text-slate-900 mt-2 font-mono">
                {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(kpi.totalRevenue)}
              </div>
              <div className="text-xs text-slate-600 mt-2.5 font-medium">
                Từ các giao dịch qua trạm tủ PTIT
              </div>
            </div>
          </div>

          {/* Station Occupancy Overview — GĐ49d: TÁCH "Tủ thật" (lên đầu) và "Tủ ảo (demo)".
              Trước đây 10 dòng trộn lẫn: 1 tủ có thiết bị + 9 tủ dữ liệu mẫu, cùng một kiểu chữ,
              nên admin không phân biệt được cái nào là hạ tầng thật. Nhóm "Tủ thật" đứng trước,
              chữ đậm hơn; nhóm demo nằm dưới, có ghi rõ "không có thiết bị". */}
          <div className="liquid-glass-card rounded-3xl border border-white/80 p-6 sm:p-7 shadow-lg space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-sm">Tỷ lệ lấp đầy theo trạm</h3>            </div>
            {[
              {
                key: 'real',
                tieuDe: 'Tủ thật',
                phu: `${realLockers.length} trạm có thiết bị`,
                ds: realLockers,
                noiBat: true,
              },
              {
                key: 'virtual',
                tieuDe: 'Tủ ảo (demo)',
                phu: `${virtualLockers.length} trạm khai báo trong CSDL, không có thiết bị`,
                ds: virtualLockers,
                noiBat: false,
              },
            ].map((nhom) => (
              <div key={nhom.key} className="space-y-4">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${
                    nhom.noiBat ? 'text-slate-900' : 'text-slate-600'
                  }`}>
                    {nhom.tieuDe}
                  </span>
                  <span className="text-[11px] text-slate-600 font-medium">{nhom.phu}</span>
                </div>
                {nhom.ds.length === 0 ? (
                  <p className="text-xs text-slate-600 italic">Không có trạm nào trong nhóm này.</p>
                ) : (
                  <div className="space-y-4">
                    {nhom.ds.map((locker) => {
                      const total = locker.compartments.length;
                      const occ = locker.compartments.filter((c) => c.status === 'OCCUPIED' || c.status === 'OVERDUE').length;
                      // Chống chia cho 0: tủ lỗi API (compartments rỗng) sẽ cho percent = NaN → thanh bar vỡ.
                      const percent = total > 0 ? Math.round((occ / total) * 100) : 0;
                      const health = getLockerHealth(locker);

                      return (
                        <div key={locker.lockerId} className="space-y-2">
                          <div className="flex justify-between items-center text-xs gap-2">
                            <span className="font-bold text-slate-800 flex items-center gap-2 min-w-0">
                              {/* GĐ5-B2 — chấm màu theo trạng thái kết nối thật, không còn luôn xanh. */}
                              <span
                                className={`w-2 h-2 rounded-full inline-block shrink-0 ${healthDotClass(health.tone)}`}
                                title={`${health.label} — ${health.rel}`}
                              />
                              <span className="truncate">{locker.name} ({locker.lockerId})</span>
                              {health.key !== 'ONLINE' && (
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${healthBadgeClass(health.tone)}`}
                                >
                                  {health.label} · {health.rel}
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-slate-700 font-bold shrink-0">
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
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB ĐƠN & PHÂN CÔNG */}
      {activeAdminSubTab === 'orders' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <form onSubmit={handleCreateAdminOrder} className="xl:col-span-4 liquid-glass-card rounded-2xl border border-white/90 p-5 shadow-md space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              Tạo đơn & phân công
            </h3>

            {orderMessage && (
              <div className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                orderMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                {orderMessage.text}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-700">Khách hàng</span>
              <select
                value={orderForm.customerUsername}
                onChange={(e) => setOrderForm((prev) => ({ ...prev, customerUsername: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">Chọn khách hàng</option>
                {adminCustomers.map((customer) => (
                  <option key={customer.userId} value={customer.username}>
                    {customer.fullName} · {customer.phone}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-700">Tủ đích</span>
              <select
                value={orderForm.lockerId}
                onChange={(e) => setOrderForm((prev) => ({ ...prev, lockerId: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">Chọn tủ</option>
                {lockers.map((locker) => (
                  <option key={locker.lockerId} value={locker.lockerId}>
                    {locker.name || locker.lockerId}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-700">Shipper phụ trách</span>
              <select
                value={orderForm.shipperUserId}
                onChange={(e) => setOrderForm((prev) => ({ ...prev, shipperUserId: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">Chưa phân công</option>
                {adminShippers.map((shipper) => (
                  <option key={shipper.userId} value={shipper.userId}>
                    {shipper.fullName} · {shipper.username}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-700">Tên bưu kiện</span>
              <input
                value={orderForm.productName}
                onChange={(e) => setOrderForm((prev) => ({ ...prev, productName: e.target.value }))}
                placeholder="VD: Pin sạc dự phòng"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-bold text-slate-700">Tổng tiền</span>
              <input
                type="number"
                min="0"
                value={orderForm.totalAmount}
                onChange={(e) => setOrderForm((prev) => ({ ...prev, totalAmount: e.target.value }))}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </label>

            <button
              type="submit"
              disabled={orderBusy}
              className="w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {orderBusy ? 'Đang tạo…' : 'Tạo đơn'}
            </button>
          </form>

          <div className="xl:col-span-8 liquid-glass-card rounded-2xl border border-white/90 p-5 shadow-md">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Đơn chờ giao & phân công</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-[10px] uppercase text-slate-600">
                  <tr>
                    <th className="py-2 pr-3">Đơn</th>
                    <th className="py-2 pr-3">Khách hàng</th>
                    <th className="py-2 pr-3">Tủ</th>
                    <th className="py-2 pr-3">Shipper</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.filter((order) => order.status === 'PENDING' || order.status === 'PENDING_OPENED').map((order) => (
                    <tr key={order.orderId} className="border-b border-slate-100">
                      <td className="py-3 pr-3 font-mono font-bold text-blue-700">{order.orderId}</td>
                      <td className="py-3 pr-3">
                        <div className="font-bold text-slate-900">{order.customerName}</div>
                        <div className="font-mono text-slate-500">{order.customerPhone}</div>
                      </td>
                      <td className="py-3 pr-3">{order.lockerName || order.lockerId || 'Chưa gán tủ'}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={order.assignedShipperUsername || ''}
                            onChange={(e) => {
                              const selected = adminShippers.find((shipper) => shipper.username === e.target.value);
                              if (selected) handleAssignShipper(order.orderId, selected.userId);
                            }}
                            disabled={assigningOrderId === order.orderId}
                            className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px]"
                          >
                            <option value="">Chưa phân công</option>
                            {adminShippers.map((shipper) => (
                              <option key={shipper.userId} value={shipper.username}>
                                {shipper.fullName}
                              </option>
                            ))}
                          </select>
                          {(order.status === 'PENDING' || order.status === 'PENDING_OPENED') && (
                            <button
                              type="button"
                              onClick={() => handleDeletePendingOrder(order.orderId)}
                              disabled={assigningOrderId === order.orderId}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              Xoá
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              <p className="text-xs text-slate-600">
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
                    <p className="text-xs text-slate-600 mt-0.5">{locker.address}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-600">
                      <span>IP: {locker.ipAddress}</span>
                      <span>•</span>
                      <span>ESP32 NodeMCU • MQTT TLS 8883</span>
                    </div>
                  </div>
                  {/* GĐ5-B2 — badge này TRƯỚC ĐÂY ghi cứng "Đang kết nối" màu xanh cho mọi tủ,
                      kể cả tủ im lặng 3 ngày (đo thật: HN_04–10 heartbeat cách 4638 phút).
                      Nay suy từ `lastHeartbeat`: xanh < 5 phút, vàng 5–60 phút, đỏ > 60 phút. */}
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`border text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${healthBadgeClass(getLockerHealth(locker).tone)}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full inline-block ${healthDotClass(getLockerHealth(locker).tone)}`}
                      />
                      {getLockerHealth(locker).label}
                    </span>
                    <span className="text-[10px] text-slate-600 font-mono">
                      {getLockerHealth(locker).rel}
                    </span>
                    <button
                      type="button"
                      onClick={() => requestMaintenance(
                        locker.lockerId,
                        null,
                        String(locker.connectionStatus || '').toUpperCase() !== 'MAINTENANCE'
                      )}
                      disabled={maintenanceBusy}
                      className={`mt-1 text-[10px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer disabled:opacity-60 flex items-center gap-1 ${
                        String(locker.connectionStatus || '').toUpperCase() === 'MAINTENANCE'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <Wrench className="w-3 h-3" />
                      {String(locker.connectionStatus || '').toUpperCase() === 'MAINTENANCE'
                        ? 'Mở khoá toàn tủ'
                        : 'Bảo trì toàn tủ'}
                    </button>
                  </div>
                </div>

                {/* Integrated Physical Visual Rack */}
                <LockerCabinetVisualizer
                  lockerName={locker.name}
                  lockerId={locker.lockerId}
                  compartments={locker.compartments?.map((comp) => ({
                    id: comp.compIndex,
                    // GĐ18 — bỏ phần "(Size …)" khỏi name; visualizer không đọc `name` nữa nhưng
                    // giữ chuỗi có size ở đây là mầm để chỗ khác hiện lại cỡ ngăn.
                    name: `Ngăn #${comp.compIndex}`,
                    size: comp.size,
                    status: (comp.status === 'EMPTY' || !comp.status) ? 'AVAILABLE' : comp.status,
                    // GĐ5 — DB lưu GRAM (`MqttService:1069` ghi thẳng payload loadcell),
                    // còn `LockerCabinetVisualizer` hiểu `weight`/`sensorWeight` là KG.
                    // Đây là chỗ ĐANG SAI SẴN (đưa gram vào chỗ hiểu kg → hiện 109.80 kg cho
                    // kiện 109.8 g). Quy đổi tại chỗ truyền, giữ nguyên contract của component.
                    weight: (Number(comp.currentWeight) || Number(comp.weight) || 0) / 1000,
                    door: comp.doorOpen ? 'OPEN' : 'CLOSED',
                    orderCode: comp.orderId || null,
                  }))}
                  activeSlotId={null}
                  doorState="CLOSED"
                  sensorWeight={0.0}
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
                      // GĐ65b — API danh sách ngăn KHÔNG trả `orderId`, nên khớp theo tủ + số ngăn.
                      const pendingOpened = orders.find((order) =>
                        order.status === 'PENDING_OPENED'
                        && order.lockerId === locker.lockerId
                        && Number(order.compartmentIndex) === Number(comp.compIndex));
                      const physicalStatus = pendingOpened ? 'PENDING_OPENED' : comp.status;

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
                            {/* GĐ18 — bỏ badge "Size {comp.size}": mọi ngăn dùng được như nhau,
                                hiện cỡ chỉ khiến ADMIN tưởng còn phân biệt size. */}
                          </div>

                          <div className="py-0.5">
                            {getCompartmentBadge(physicalStatus)}
                            {comp.orderId && (
                              <span className="text-[10px] font-mono text-slate-600 block mt-1 truncate bg-white py-0.5 rounded-md border border-slate-200">
                                {comp.orderId}
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-600 flex items-center justify-center gap-1 py-0.5">
                            {isDoorOpen ? (
                              <span className="text-amber-700 flex items-center gap-1 font-bold">
                                <DoorOpen className="w-3.5 h-3.5" /> Đang mở chốt
                              </span>
                            ) : (
                              <span className="text-slate-600 flex items-center gap-1">
                                <Lock className="w-3.5 h-3.5 text-slate-400" /> Đã chốt Solenoid
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => handleForceUnlock(locker.lockerId, comp.compIndex)}
                            disabled={unlockBusyLocal}
                            className="ios-btn w-full bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 text-[11px] font-bold py-1.5 px-2 rounded-xl transition flex items-center justify-center gap-1 cursor-pointer border border-slate-200/80 shadow-2xs disabled:opacity-50"
                            title="Mở khóa khẩn cấp từ xa"
                          >
                            <Unlock className="w-3 h-3 text-rose-500" /> Mở khẩn cấp
                          </button>

                          <button
                            type="button"
                            onClick={() => requestMaintenance(
                              locker.lockerId,
                              comp.compIndex,
                              comp.status !== 'OUT_OF_SERVICE'
                            )}
                            disabled={comp.status === 'OCCUPIED' || comp.status === 'OVERDUE' || maintenanceBusy}
                            title={comp.status === 'OCCUPIED' || comp.status === 'OVERDUE'
                              ? 'Thu hồi hoặc giải phóng ngăn trước khi bảo trì'
                              : comp.status === 'OUT_OF_SERVICE'
                                ? 'Mở khoá bảo trì ngăn này'
                                : 'Khoá ngăn để bảo trì'}
                            className="mt-1 w-full text-[10px] font-bold py-1.5 px-2 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                          >
                            <Wrench className="w-3 h-3" />
                            {comp.status === 'OUT_OF_SERVICE' ? 'Mở lại ngăn' : 'Bảo trì ngăn'}
                          </button>

                          {/* GĐ13 — xác nhận 2 bước NGAY TẠI NGĂN, thay `window.confirm`.
                              Bấm "Mở khẩn cấp" chỉ mở hộp này (0 request). */}
                          {unlockTarget && unlockTarget.lockerId === locker.lockerId
                            && unlockTarget.compIndex === comp.compIndex && (
                            <div className="mt-1.5 p-2 rounded-lg bg-rose-50 border border-rose-200 space-y-1.5">
                              <p className="text-[10px] text-rose-800 leading-snug">
                                Mở cưỡng bức Ngăn #{comp.compIndex} của {locker.lockerId}?
                              </p>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={handleConfirmForceUnlock}
                                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold py-1 rounded-md cursor-pointer"
                                >
                                  Xác nhận mở
                                </button>
                                <button
                                  onClick={() => setUnlockTarget(null)}
                                  className="px-2 bg-white border border-slate-300 text-slate-700 text-[10px] font-bold py-1 rounded-md cursor-pointer"
                                >
                                  Huỷ
                                </button>
                              </div>
                            </div>
                          )}

                          {unlockResult && (
                            <p
                              className={`mt-1 text-[10px] font-medium leading-snug ${
                                unlockResult.type === 'success' ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {unlockResult.text}
                            </p>
                          )}
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

      {activeAdminSubTab === 'matrix' && maintenanceResult && typeof document !== 'undefined' && createPortal(
        <div
          role="status"
          className={`fixed top-5 right-5 z-[100000] max-w-sm rounded-xl border px-4 py-3 text-xs font-semibold shadow-xl ${
            maintenanceResult.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {maintenanceResult.text}
        </div>,
        document.body
      )}

      {/* TAB 3: OVERDUE ORDERS MANAGEMENT */}
      {activeAdminSubTab === 'overdue' && (
        <div className="space-y-5">
          <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" /> Quản Lý Đơn Quá Hạn (24h)
              </h3>
              <p className="text-xs text-slate-600">
                Quét đơn quá hạn và phân công rõ shipper phụ trách từng bưu kiện.
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

          {orderMessage && (
            <div className={`p-3.5 border text-xs rounded-2xl ${
              orderMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {orderMessage.text}
            </div>
          )}

          {overdueList.length === 0 ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-12 text-center shadow-md">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
              <h4 className="font-bold text-slate-900 text-sm">Hiện không có bưu kiện nào quá hạn</h4>
              <p className="text-xs text-slate-600 mt-1">Tất cả khách hàng đã nhận đồ đúng thời hạn quy định.</p>
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
                      <p className="text-xs text-slate-600 mt-1">
                        Khách: <strong className="text-slate-800">{ord.customerName}</strong> (<span className="font-mono">{ord.customerPhone}</span>) • Trạm: <strong>{ord.lockerName} (Ngăn #{ord.compartmentIndex})</strong>
                      </p>
                      <p className="text-[11px] text-rose-600 font-mono mt-0.5">
                        Hạn chót: {new Date(ord.expiryDeadline).toLocaleString('vi-VN')}
                      </p>
                    </div>

                    <div className="flex flex-col items-start sm:items-end gap-1.5">
                      <label className="text-[10px] font-semibold text-slate-600" htmlFor={`assign-overdue-${ord.orderId}`}>
                        Shipper thu hồi
                      </label>
                      <select
                        id={`assign-overdue-${ord.orderId}`}
                        value={ord.assignedShipperUsername || ''}
                        onChange={(e) => {
                          const selected = adminShippers.find((shipper) => shipper.username === e.target.value);
                          if (selected) handleAssignShipper(ord.orderId, selected.userId);
                        }}
                        disabled={assigningOrderId === ord.orderId || adminShippers.length === 0}
                        className="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                      >
                        <option value="">Chưa phân công</option>
                        {adminShippers.map((shipper) => (
                          <option key={shipper.userId} value={shipper.username}>
                            {shipper.fullName} · {shipper.username}
                          </option>
                        ))}
                      </select>
                      {ord.assignedShipperUsername ? (
                        <span className="text-[10px] text-emerald-700">
                          Chỉ shipper này nhận thông báo và xử lý đơn
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700">Chưa shipper nào được giao</span>
                      )}
                    </div>
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
                {userMsg.type === 'success'
                  ? <CheckCircle2 className="w-4 h-4 shrink-0" />
                  : <AlertCircle className="w-4 h-4 shrink-0" />}
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
                <thead className="bg-slate-50/80 border-b border-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Họ và tên</th>
                    <th className="py-3 px-4">Số điện thoại</th>
                    <th className="py-3 px-4">Tên đăng nhập</th>
                    <th className="py-3 px-4">Vai trò</th>
                    <th className="py-3 px-4">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => {
                    const isCurrentUser = currentUser?.username?.toLowerCase() === u.username?.toLowerCase();
                    const isProtectedAccount = u.username?.toLowerCase() === 'admin';
                    // Admin không được đổi vai trò hay xoá quản trị viên KHÁC (backend cũng chặn).
                    const isOtherAdmin = u.role === 'ADMIN' && !isCurrentUser;
                    const isPendingDelete = pendingDeleteUser?.id === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3.5 px-4 font-mono font-bold text-slate-600">#{u.id}</td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">{getDisplayName(u)}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-600">{u.phone}</td>
                        <td className="py-3.5 px-4 font-mono text-slate-800">{u.username}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            {getRoleBadge(u.role)}
                            <select
                              aria-label={`Đổi vai trò cho ${u.username}`}
                              value={u.role}
                              disabled={isCurrentUser || isOtherAdmin || roleUpdatingId === u.id}
                              onChange={(e) => handleUpdateUserRole(u, e.target.value)}
                              title={isCurrentUser
                                ? 'Không thể tự đổi vai trò tài khoản đang đăng nhập'
                                : isOtherAdmin
                                ? 'Không thể đổi vai trò của quản trị viên khác'
                                : 'Đổi vai trò người dùng'}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="CUSTOMER">Khách hàng</option>
                              <option value="SHIPPER">Shipper</option>
                              <option value="ADMIN">Quản trị viên</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {isPendingDelete ? (
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={handleDeleteUser}
                                disabled={deletingUserId === u.id}
                                className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                              >
                                {deletingUserId === u.id ? 'Đang xóa…' : 'Xác nhận xóa'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDeleteUser(null)}
                                disabled={deletingUserId === u.id}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteUser(u)}
                              disabled={isCurrentUser || isProtectedAccount || isOtherAdmin || deletingUserId != null}
                              title={
                                isCurrentUser
                                  ? 'Không thể xóa tài khoản đang đăng nhập'
                                  : isProtectedAccount
                                  ? 'Không thể xóa tài khoản quản trị mặc định'
                                  : isOtherAdmin
                                  ? 'Không thể xóa tài khoản của quản trị viên khác'
                                  : 'Xóa tài khoản'
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[10px] font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 className="h-3 w-3" />
                              Xóa
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5 (GĐ7): LỊCH SỬ MỞ TỦ */}
      {activeAdminSubTab === 'logs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-blue-600" /> Lịch sử mở tủ
              </h3>
              <p className="text-xs text-slate-600">
                20 lệnh gần nhất từ <code className="font-mono">command_logs</code> — mỗi lần
                Solenoid được lệnh bung đều có một dòng ở đây.
              </p>
            </div>
            <button
              type="button"
              onClick={loadCommandLogs}
              disabled={loadingLogs}
              className="p-2.5 bg-white hover:bg-slate-50 rounded-xl text-slate-600 transition border border-slate-200 cursor-pointer shadow-2xs disabled:opacity-60"
              title="Tải lại lịch sử"
            >
              <RefreshCw className={`w-4 h-4 ${loadingLogs ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {logsError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
              {logsError}
            </div>
          )}

          {!logsError && commandLogs.length === 0 && !loadingLogs && (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-10 text-center shadow-sm">
              <Key className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa có lệnh mở tủ nào</h4>
              <p className="text-xs text-slate-600 mt-1">
                Bấm nút tải lại ở trên, hoặc lịch sử đang trống trong CSDL.
              </p>
            </div>
          )}

          {(commandLogs.length > 0 || loadingLogs) && (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-4 shadow-md overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-600 border-b border-slate-200">
                    <th className="py-2 pr-3 font-semibold">Thời gian</th>
                    <th className="py-2 pr-3 font-semibold">Người mở</th>
                    <th className="py-2 pr-3 font-semibold">Tủ</th>
                    <th className="py-2 pr-3 font-semibold">Ngăn</th>
                    <th className="py-2 pr-3 font-semibold">Loại lệnh</th>
                    <th className="py-2 font-semibold">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingLogs && commandLogs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-600 italic">
                        Đang tải lịch sử…
                      </td>
                    </tr>
                  )}
                  {commandLogs.map((log) => {
                    // GĐ9 — cột "Người mở": logic hiển thị nằm ở `utils/commandLogActor.js`
                    // (dùng chung với panel bản đồ) để hai màn không mô tả khác nhau.
                    const actor = describeActor(log);
                    return (
                    <tr key={log.commandId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-mono text-slate-700">
                        {log.sentAt ? new Date(log.sentAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${actorBadgeClass(actor.tone)}`}
                          title={actor.detail || undefined}
                        >
                          {actor.label}
                        </span>
                        {actor.detail && (
                          <div className="text-[10px] text-slate-600 mt-0.5 font-mono">{actor.detail}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-700">{log.lockerId || '—'}</td>
                      <td className="py-2 pr-3 text-slate-700">#{log.compartmentId ?? '—'}</td>
                      <td className="py-2 pr-3 text-slate-700">{log.commandType || '—'}</td>
                      <td className="py-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                            String(log.status).toUpperCase() === 'SUCCESS'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : String(log.status).toUpperCase() === 'TIMEOUT'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {log.status || '—'}
                        </span>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
