import React, { useState, useEffect, useRef, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CircularTimer from './CircularTimer';
import LockerCabinetVisualizer from './LockerCabinetVisualizer';
import { store } from '../services/store';
import { pickupApi, orderApi, lockerApi } from '../services/api';
// GĐ40 — suy trạng thái tủ từ `lastHeartbeat`, dùng chung helper GĐ12 (không tự viết ngưỡng mới).
import { getLockerHealth } from '../utils/lockerHealth';
import { nhanMocHan } from '../utils/dateTime';
import {
  Package, Clock, CheckCircle2, AlertTriangle, QrCode,
  Search, MapPin, X, XCircle, AlertCircle, Timer,
  RefreshCw, ShieldCheck, Key, ChevronRight, Check,
  Calendar, Layers, ArrowUpRight, Copy, Sparkles,
  Shield, Smartphone, ExternalLink
} from 'lucide-react';

/**
 * GĐ38 — SỐ ĐẾM KPI CHẠY SỐ (mô tả đúng thay đổi dữ liệu thật, không phải trang trí).
 *
 * <p>Vì sao cần: khi một đơn đổi trạng thái, 4 thẻ KPI nhảy số tức thì nên người xem không biết
 * thẻ nào vừa đổi. Chạy 500ms giúp mắt bám được sự thay đổi đó.
 *
 * <p><b>Ba ràng buộc:</b>
 * <ol>
 *   <li><b>Lần đầu hiện NGAY giá trị đúng</b>, không chạy từ 0 — nếu chạy từ 0 thì khách vừa mở
 *       trang thấy "0 đơn" rồi mới nhảy lên số thật, tưởng mất đơn.</li>
 *   <li>Chỉ animate khi giá trị **đổi sau render đầu**.</li>
 *   <li>`cancelAnimationFrame` khi unmount (và trước mỗi lần chạy mới) — nếu không sẽ có frame
 *       chạy trên component đã chết, React cảnh báo và rò rỉ.</li>
 * </ol>
 */
function CountUp({ value, duration = 500 }) {
  const dich = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [hienThi, setHienThi] = useState(dich);
  const tuRef = useRef(null);        // giá trị đang hiển thị (điểm bắt đầu lần chạy)
  const khungRef = useRef(null);     // id requestAnimationFrame đang chạy
  const lanDauRef = useRef(true);

  useEffect(() => {
    if (lanDauRef.current) {
      // Lần render đầu: hiện thẳng số thật, KHÔNG animate.
      lanDauRef.current = false;
      tuRef.current = dich;
      setHienThi(dich);
      return undefined;
    }

    const tu = tuRef.current == null ? dich : tuRef.current;
    if (tu === dich) return undefined;

    if (khungRef.current != null) cancelAnimationFrame(khungRef.current);
    const batDau = performance.now();
    const easeOut = (t) => 1 - (1 - t) ** 3;

    const buoc = (now) => {
      const tiLe = Math.min(1, (now - batDau) / duration);
      const giaTri = Math.round(tu + (dich - tu) * easeOut(tiLe));
      tuRef.current = giaTri;
      setHienThi(giaTri);
      if (tiLe < 1) {
        khungRef.current = requestAnimationFrame(buoc);
      } else {
        khungRef.current = null;
        setHienThi(dich);
      }
    };
    khungRef.current = requestAnimationFrame(buoc);

    return () => {
      if (khungRef.current != null) {
        cancelAnimationFrame(khungRef.current);
        khungRef.current = null;
      }
    };
  }, [dich, duration]);

  return hienThi;
}

export default function CustomerPickupTab({ currentUser, lockerFilterId = null }) {
  const [orders, setOrders] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  // Modal QR nhận hàng (mã tĩnh theo đơn, không xoay vòng)
  const [qrModalOrder, setQrModalOrder] = useState(null);
  const [qrToken, setQrToken] = useState('');

  // State OTP 5 phút
  const [otpModalOrder, setOtpModalOrder] = useState(null);
  const [generatingOtpId, setGeneratingOtpId] = useState(null);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [otpToast, setOtpToast] = useState(null);
  const [nowTime, setNowTime] = useState(Date.now());

  // GĐ37 — trạng thái tải THẬT của danh sách đơn, để hiện skeleton thay cho màn trắng.
  // `true` trong lúc gọi API, `false` khi xong (kể cả lỗi) — nếu để treo `true` thì skeleton
  // quay mãi (điều cấm của thẻ).
  const [loadingOrders, setLoadingOrders] = useState(true);

  // GĐ13 — true = danh sách đơn đang đọc từ localStorage (cache), KHÔNG phải máy chủ.
  // Phải có cờ này để hiện banner, nếu không khách tưởng đơn cache là đơn thật của mình.
  const [usingFallback, setUsingFallback] = useState(false);

  // GĐ5 — cảm biến THẬT của ngăn chứa đơn đang xem: cân nặng + trạng thái cửa.
  // Trước đây là số cứng `0.85` nên khách nào cũng thấy cùng một con số dù kiện nặng nhẹ khác nhau.
  // DB lưu GRAM (`MqttService:1069`), `LockerCabinetVisualizer` hiểu KG → chia 1000 tại chỗ truyền.
  const [compartmentSensor, setCompartmentSensor] = useState(null);

  // GĐ39 — TOÀN BỘ ngăn của tủ đang xem (shape của `LockerCabinetVisualizer`).
  // Dùng để vẽ đủ 2 ngăn khi đơn CHƯA nạp; khi đơn đã nạp thì chỉ lọc đúng ngăn của đơn.
  // `null` = chưa đọc được → component dùng `defaultSlots`, KHÔNG bịa status (điều cấm #2).
  const [compartmentsDayDu, setCompartmentsDayDu] = useState(null);

  // GĐ40 — telemetry thật của tủ đang xem: { lastHeartbeat, isVirtual, health } | null.
  // Lấy từ `/api/lockers` (KHÔNG gọi `/api/mqtt/status` — 403 với khách, điều cấm #2).
  const [lockerTelemetry, setLockerTelemetry] = useState(null);

  // GĐ20 — mốc `seq` sự kiện Kiosk đã xử lý. `null` = chưa hỏi lần nào, lần poll đầu chỉ lấy
  // `latestSeq` để KHÔNG phát lại modal của lần trước.
  const [kioskSeq, setKioskSeq] = useState(null);

  /**
   * GĐ32 — thông tin popup "Lấy hàng thành công". `null` = không hiện.
   *
   * <p>Dùng POPUP có nút đóng chứ không phải toast 4 giây (điều cấm #3 của thẻ): user nói rõ
   * "sau khi đơn hàng được lấy và đóng tủ hãy pop up thông báo lấy hàng thành công", và trước đây
   * phải F5 mới thấy dữ liệu mới.
   */
  const [pickupDoneInfo, setPickupDoneInfo] = useState(null);
  const [pickupLeftInfo, setPickupLeftInfo] = useState(null);

  /**
   * GĐ32 — các đơn CHÍNH PHIÊN NÀY đã từng ở trong tủ (`DEPOSITED`/`PICKUP_OPENED`).
   *
   * <p>Cần để poll tiếp được sau khi đơn chuyển `COMPLETED` (bắt sự kiện `PICKUP_SUCCESS`), mà
   * KHÔNG poll vô hạn trên những đơn đã hoàn tất từ trước — xem effect poll bên dưới.
   * `useRef` vì đây là bộ nhớ phụ, không cần render lại.
   */
  const daThayTrongTuRef = useRef(new Set());

  /**
   * GĐ26 — các `seq` sự kiện Kiosk đã tạo thông báo rồi.
   *
   * <p>Dùng `useRef` chứ không dùng state: đây là bộ nhớ chống trùng, không tham gia render. Nếu để
   * state thì mỗi lần thêm sẽ kéo theo một vòng render và có thể lại kích hoạt effect poll.
   *
   * <p>Vì sao cần: `since(lockerId, after)` trả MỌI sự kiện có `seq > after`; poll 1,5 giây nên cùng
   * một bản tin `receive/method` bị đọc lại vài lần trước khi `latestSeq` kịp vượt qua nó. Không
   * chặn thì một lần khách bấm ở tủ sinh ra nhiều thông báo giống nhau.
   */
  const processedKioskSeqRef = useRef(new Set());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Đồng bộ order trong modal khi store thay đổi
  useEffect(() => {
    if (otpModalOrder) {
      const fresh = orders.find((o) => o.orderId === otpModalOrder.orderId);
      // GĐ25 — CHỈ đồng bộ khi bản `fresh` THẬT SỰ có mã. `GET /api/orders/by-phone` không trả
      // `otpExpiresAt`, nên nếu ghi đè vô điều kiện thì mã vừa tạo bị thay bằng bản thiếu hạn và
      // modal quay lại "đã hết hạn". Giữ hạn đã gắn tại chỗ nếu bản mới không có.
      if (fresh) {
        setOtpModalOrder({
          ...fresh,
          otpCode: fresh.otpCode || otpModalOrder.otpCode,
          otpExpiresAt: fresh.otpExpiresAt || otpModalOrder.otpExpiresAt,
        });
      }
    }
    if (qrModalOrder) {
      const fresh = orders.find((o) => o.orderId === qrModalOrder.orderId);
      if (fresh) setQrModalOrder(fresh);
    }
  }, [orders]);

  useEffect(() => {
    loadOrders();
    const handleUpdate = () => loadOrders();
    window.addEventListener('smart_locker_store_updated', handleUpdate);
    return () => window.removeEventListener('smart_locker_store_updated', handleUpdate);
  }, [currentUser]);

  /**
   * GĐ5-C1 — danh sách đơn lấy từ API THẬT thay vì localStorage.
   *
   * <p>Dùng `orderApi.getByPhone(currentUser.phone)`: endpoint đã lọc theo SĐT của chính khách
   * (controller kiểm thêm principal, xem `OrderController.getOrdersByPhone` — không phải chủ
   * đơn thì 403), nên client không tự lọc lại được nữa.
   *
   * <p>⚠️ Endpoint trả **MỌI** đơn của SĐT đó, gồm cả `CANCELLED`/`COMPLETED`, trong khi code cũ
   * đọc localStorage chỉ có đơn đang hoạt động. Vì vậy KHÔNG bỏ bộ lọc `filterStatus` ở dưới —
   * nó vẫn là thứ quyết định tab nào hiện đơn nào.
   *
   * <p>`currentUser.phone` lấy từ `UserResponse.phone` của backend khi login, đã lưu trong
   * `sessionStorage.smart_locker_user`. Không có SĐT (dữ liệu đăng nhập hỏng) thì GIỮ NGUYÊN danh
   * sách hiện có thay vì xoá trắng màn hình.
   */
  /**
   * GĐ24 — sắp xếp MỚI NHẤT TRƯỚC theo ngày đặt.
   *
   * <p>Backend đã sắp bằng `ORDER BY o.createdAt DESC, o.orderId DESC`, nên với dữ liệu từ API thì
   * hàm này không đổi gì. Nó tồn tại cho <b>nhánh fallback</b> (`store.getOrders()` khi mất mạng):
   * cache trong localStorage không có thứ tự đảm bảo, và nếu để nguyên thì khách thấy danh sách
   * nhảy loạn mỗi lần mất mạng — đúng triệu chứng đang sửa.
   *
   * <p>So sánh theo `createdAt` (chuỗi ISO nên so chuỗi là đủ), thiếu thì lùi về `orderDate`, cuối
   * cùng dùng `orderId` làm tiêu chí phụ để kết quả ổn định giữa hai lần render.
   */
  const sortNewestFirst = (list) => {
    const key = (o) => o?.createdAt || o?.orderDate || o?.expectedDate || '';
    return [...list].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return kb.localeCompare(ka);
      return String(b?.orderId || '').localeCompare(String(a?.orderId || ''));
    });
  };

  const loadOrders = async () => {
    const phone = currentUser?.phone;
    if (!phone) {
      // GĐ13 — dữ liệu cache CHỈ dùng khi thiếu SĐT đăng nhập, và phải bật cờ để UI cảnh báo.
      // Không có cờ thì khách thấy danh sách cũ mà tưởng là đơn thật của mình.
      setOrders(sortNewestFirst(store.getOrders()));
      setUsingFallback(true);
      setLoadingOrders(false);
      return;
    }
    setLoadingOrders(true);
    try {
      const res = await orderApi.getByPhone(phone);
      const apiOrders = res?.data?.data || [];
      setOrders(sortNewestFirst(apiOrders));
      setUsingFallback(false);
      if (apiOrders.length > 0 && !selectedOrderId) {
        setSelectedOrderId(apiOrders[0].orderId);
      }
    } catch (err) {
      // GĐ13 — fallback có kiểm soát, theo mẫu `usingMockData` của ShipperTab.
      //
      // Vẫn giữ danh sách cache để trang không trắng, nhưng BẬT CỜ để hiện banner cảnh báo: khách
      // phải biết đây không phải dữ liệu máy chủ. Trước đây hàm này im lặng đổ cache vào và người
      // dùng không phân biệt được.
      console.warn('[CustomerPickupTab] Không tải được đơn từ API, dùng dữ liệu mô phỏng:', err?.message);
      setOrders(sortNewestFirst(store.getOrders()));
      setUsingFallback(true);
    } finally {
      // GĐ37 — luôn tắt skeleton, kể cả khi lỗi. Để `true` là skeleton quay mãi.
      setLoadingOrders(false);
    }
  };

  /**
   * W2: mã QR nhận hàng LẤY TỪ SERVER, không tự sinh ở client.
   * Trước đây hàm này tự ghép `PKUP-${orderId}-...` và chỉ mở được tủ nhờ nhánh
   * startsWith("PKUP-"+orderId+"-") trong PickupService — nhánh đó đã bị bỏ vì là lỗ hổng.
   * Mã thật do backend cấp (cột pickup_credentials.qr_token), chỉ trả về cho chủ đơn đúng SĐT.
   */
  const loadRealQrToken = async (order) => {
    if (!order) return;
    const phone = currentUser?.phone || order.customerPhone;
    if (!phone) {
      setQrToken('');
      return;
    }
    try {
      const res = await orderApi.getById(order.orderId, phone);
      const realToken = res?.data?.data?.qrToken || '';
      setQrToken(realToken);
    } catch {
      // Không lấy được mã (chưa đăng nhập / không phải chủ đơn / đơn chưa vào tủ):
      // để rỗng và hiện thông báo "Chờ nạp hàng", KHÔNG dựng mã giả.
      setQrToken('');
    }
  };

  // GĐ72 — lời báo khi đơn đã qua hạn lưu kho nhưng tác vụ nền (10 phút/lần) chưa chuyển OVERDUE.
  const MSG_QUA_HAN_LUU_KHO = 'Đơn hàng đã quá hạn lưu kho tại tủ. Vui lòng liên hệ quản trị viên để được hỗ trợ!';
  const baoQuaHanLuuKho = () => {
    setOtpToast(MSG_QUA_HAN_LUU_KHO);
    setTimeout(() => setOtpToast(null), 4000);
  };

  const handleOpenQrModal = (order) => {
    if (order?.status === 'DEPOSITED' && calculateRemainingTime(order.expiryDeadline).isOverdue) {
      baoQuaHanLuuKho();
      return;
    }
    setOtpModalOrder(null);
    setQrModalOrder(order);
    loadRealQrToken(order);
  };

  // W2: KHÔNG còn đồng hồ đếm 60 giây cho mã QR.
  // Mã QR lấy từ server là mã TĨNH của đơn (không xoay vòng), nên đếm ngược 60s sẽ
  // khiến khách tưởng mã sắp hết hạn và bỏ đi. Hạn thật của đơn (expiryDeadline) đã
  // được hiển thị riêng ở phần thông tin đơn. Ở đây chỉ cần nạp lại mã khi mở modal.
  useEffect(() => {
    if (!qrModalOrder) return;
    // Nạp lại mã mỗi lần mở modal để phản ánh trạng thái mới nhất từ server.
    loadRealQrToken(qrModalOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrModalOrder?.orderId]);

  // GĐ72 (#3) — nhãn mốc hạn tính theo NGÀY thật của hạn (trước: ghi cứng "Đến 24h00 mai", sai từ
  // sau 0h). Thanh tiến độ tính trên khung thật `depositedAt → expiryDeadline` (24–48 giờ tuỳ giờ
  // nạp); thiếu `depositedAt` mới lùi về khung 36 giờ cũ.
  const calculateRemainingTime = (expiryDeadline, depositedAt) => {
    if (!expiryDeadline) return { label: 'Chờ nạp tủ', color: 'slate', percent: 0, isOverdue: false };
    const deadline = new Date(expiryDeadline).getTime();
    const now = new Date().getTime();
    const diffMs = deadline - now;
    const napMs = depositedAt ? new Date(depositedAt).getTime() : NaN;
    const khungMs = Number.isFinite(napMs) && deadline > napMs ? deadline - napMs : 36 * 3600 * 1000;

    if (diffMs <= 0) {
      return { label: 'Đã quá hạn lưu kho', color: 'rose', percent: 100, isOverdue: true };
    }

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const percent = Math.min(100, Math.max(0, Math.round(((khungMs - diffMs) / khungMs) * 100)));

    let color = 'emerald';
    if (hours < 3) {
      color = 'rose';
    } else if (hours < 8) {
      color = 'amber';
    }

    return {
      label: `Còn ${hours}h ${minutes}m (Đến ${nhanMocHan(expiryDeadline, now)})`,
      color,
      percent,
      isOverdue: false,
    };
  };

  const getOtpStatus = (order) => {
    if (!order || !order.otpCode || !order.otpExpiresAt) {
      return { isGenerated: false, isExpired: false, remainingSeconds: 0 };
    }
    const expiryMs = new Date(order.otpExpiresAt).getTime();
    const diff = Math.floor((expiryMs - nowTime) / 1000);
    if (diff <= 0) {
      return { isGenerated: true, isExpired: true, remainingSeconds: 0 };
    }
    return { isGenerated: true, isExpired: false, remainingSeconds: diff };
  };

  const formatSeconds = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleGenerateOtp = async (order) => {
    if (!order) return;

    if (order.status === 'PENDING' || order.status === 'PENDING_OPENED') {
      setOtpToast('Kiện hàng chưa được nhân viên nạp vào tủ! Vui lòng chờ sau khi nạp hàng để nhận mã OTP.');
      setTimeout(() => setOtpToast(null), 4000);
      return;
    }
    if (order.status === 'COMPLETED') {
      setOtpToast('Đơn hàng này đã được nhận thành công trước đó!');
      setTimeout(() => setOtpToast(null), 4000);
      return;
    }
    // GĐ72 — xét cả hạn lưu kho, không chỉ trạng thái: trong ≤10 phút trước khi tác vụ nền chạy
    // đơn vẫn là DEPOSITED dù đã quá hạn.
    if (order.status === 'OVERDUE' || calculateRemainingTime(order.expiryDeadline).isOverdue) {
      baoQuaHanLuuKho();
      return;
    }

    setGeneratingOtpId(order.orderId);
    try {
      let apiOtp = null;
      try {
        const res = await pickupApi.requestOtp(order.orderId, order.customerPhone);
        if (res.data && res.data.data) {
          apiOtp = res.data.data;
        }
      } catch (e) {
        const errMsg = e.response?.data?.message || e.message || '';
        const isSecurityOrBusinessBlock =
          errMsg.includes('tạm khóa') ||
          errMsg.includes('quá 5 lần') ||
          errMsg.includes('quá hạn') ||
          errMsg.includes('Số điện thoại không khớp') ||
          errMsg.includes('chưa được nhân viên nạp') ||
          errMsg.includes('đã được nhận thành công');

        if (isSecurityOrBusinessBlock) {
          setOtpToast(errMsg);
          setTimeout(() => setOtpToast(null), 4000);
          return;
        }
        console.warn('Backend không tìm thấy đơn hoặc đang offline, tạo mã OTP trên local store:', errMsg);
      }

      // GĐ13 — ĐÃ XOÁ `store.requestOtpForOrder(order.orderId, apiOtp)`.
      //
      // Dòng đó ghi mã OTP vào localStorage SAU KHI `pickupApi.requestOtp` (dòng 210) đã tạo mã
      // THẬT ở backend. Hai hệ quả xấu:
      //   • Lưu mã OTP vào localStorage là giữ bí mật mở tủ ở nơi ai đọc được bằng JS/devtools —
      //     trong khi mã thật đã có trong response và cột `pickup_credentials.otp_code`.
      //   • Nếu `apiOtp` là null (nhánh fallback khi backend lỗi) thì store vẫn nhận mã tự sinh,
      //     hiện "Đã tạo mã OTP" trong khi backend không có mã đó — thao tác giả.
      //
      // Không còn nhánh nào cần ghi đè: mã OTP chỉ đọc từ server (`loadOrders` → `order.otpCode`).
      setCopiedOtp(false);

      if (apiOtp) {
        // GĐ25 — MỞ MODAL, không chỉ toast.
        //
        // Trước đây nhánh thành công chỉ gọi `setOtpToast(..., mã ...)` rồi tự tắt sau 4 giây: mã
        // nằm ở góc dưới phải, chữ `text-xs`, khách không kịp đọc — trong khi mã QR mở modal to.
        // Modal OTP đã có sẵn (mã 6 số cỡ lớn, đếm ngược 5 phút, nút Đổi mã/sao chép), chỉ thiếu
        // đường mở. Nên chỉ cần set `otpModalOrder`.
        //
        // Thứ tự quan trọng: `loadOrders()` phải chạy XONG trước khi mở modal, để effect đồng bộ
        // `[orders]` nạp đơn có `otpCode` MỚI. Nếu mở modal bằng object `order` cũ (chụp từ lần
        // render trước) thì modal có thể hiện mã CŨ.
        await loadOrders();

        // GĐ27b — SỬA NGUỒN DỮ LIỆU (minh bắt ở vòng 1, đây là lỗi thật).
        //
        // Bản trước lấy `fresh` từ `orderApi.getByPhone` — đó là endpoint **DANH SÁCH**, backend gọi
        // `mapToOrderResponse(o, null, null, false)` với `includeSecrets = false`, nên trả về
        // `otpCode = null` **VÀ** `otpExpiresAt = null` cho MỌI đơn (kể cả đơn DEPOSITED của chính
        // chủ). Dựng modal từ nguồn đó thì modal mất cả mã lẫn hạn → hiện "Mã OTP đã hết hạn" ngay
        // sau khi khách vừa tạo mã.
        //
        // Nay dùng `orderApi.getById(orderId, phone)` → `GET /api/orders/{id}?phone=...`, endpoint
        // **chi tiết** có `includeSecrets = true` khi đúng SĐT chủ đơn và đơn đang DEPOSITED, nên
        // trả `otpCode` + `otpExpiresAt` thật từ `pickup_credentials`.
        //
        // Nếu endpoint chi tiết lỗi (mất mạng, đơn vừa đổi trạng thái): vẫn phải mở modal với mã vừa
        // tạo `apiOtp`, KHÔNG để khách bấm tạo mã mà không thấy gì.
        const detail = await orderApi
          .getById(order.orderId, currentUser?.phone || order.customerPhone)
          .then((r) => r?.data?.data || null)
          .catch(() => null);

        const modalSource = {
          ...(detail || order),
          otpCode: (detail && detail.otpCode) || apiOtp,
          otpExpiresAt: detail?.otpExpiresAt || null,
        };
        setOtpModalOrder(modalSource);
        // Toast chỉ còn để nhắc khách; KHÔNG chứa mã và không phải đường hiển thị chính.
        setOtpToast('Mã OTP đã sẵn sàng — xem mã trong cửa sổ vừa mở.');
        setTimeout(() => setOtpToast(null), 4000);
      } else {
        // Nhánh LỖI/thất bại: giữ toast (không có mã để mở modal), đúng điều cấm #2.
        await loadOrders();
        setOtpToast('Máy chủ không cấp được mã OTP cho đơn này. Vui lòng thử lại.');
        setTimeout(() => setOtpToast(null), 4000);
      }
    } catch (err) {
      console.error('Lỗi tạo OTP:', err);
    } finally {
      setGeneratingOtpId(null);
    }
  };

  const handleCopyOtp = (code) => {
    if (!code) return;
    try {
      navigator.clipboard?.writeText(code);
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
    } catch (e) {}
  };

  /**
   * GĐ49b — LỌC MẶC ĐỊNH **ẨN ĐƠN ĐÃ HUỶ**.
   *
   * <p><b>Vì sao:</b> trước GĐ49b mặc định là `ALL` nên danh sách 13 đơn phần lớn là "Đơn đã huỷ" —
   * khách phải tự lọc mới thấy đơn thật sự cần nhận. Nay tab "Tất cả" ẩn `CANCELLED`;
   * bộ lọc "Đơn đã huỷ" vẫn xem được (điều cấm #4: KHÔNG bỏ bộ lọc, chỉ đổi mặc định + thêm tab).
   */
  const filteredOrders = orders.filter((o) => {
    if (lockerFilterId && o.lockerId !== lockerFilterId) return false;
    if (filterStatus === 'CANCELLED') return o.status === 'CANCELLED';
    if (o.status === 'CANCELLED') return false;      // mặc định (và mọi tab khác) ẩn đơn huỷ
    if (filterStatus !== 'ALL' && o.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchId = o.orderId?.toLowerCase().includes(q);
      const matchProduct = o.productName?.toLowerCase().includes(q);
      const matchLocker = o.lockerName?.toLowerCase().includes(q);
      return matchId || matchProduct || matchLocker;
    }
    return true;
  });

  /**
   * GĐ49b — "BƯU KIỆN ĐANG CHỜ BẠN": các đơn ĐANG NẰM TRONG TỦ, chờ khách tới lấy.
   *
   * <p>Chỉ 2 trạng thái: `DEPOSITED` (hàng đã vào ngăn) và `PICKUP_OPENED` (khách đã mở cửa nhưng
   * cảm biến CHƯA chốt là hàng đã ra — GĐ31a). Đây là định nghĩa "đang chờ", không phải `PENDING`
   * (đơn chưa được nạp thì khách chưa làm gì được).
   */
  const donDangCho = orders.filter(
    (o) => o.status === 'DEPOSITED' || o.status === 'PICKUP_OPENED',
  );
  const donDangChoTheoTu = lockerFilterId
    ? donDangCho.filter((o) => o.lockerId === lockerFilterId)
    : donDangCho;

  const selectedOrder = donDangChoTheoTu.find((o) => o.orderId === selectedOrderId)
    || donDangChoTheoTu[0]
    || filteredOrders.find((o) => o.orderId === selectedOrderId && (!lockerFilterId || o.lockerId === lockerFilterId))
    || filteredOrders.find((o) => !lockerFilterId || o.lockerId === lockerFilterId)
    || null;

  /**
   * GĐ49b — đơn dùng cho KHỐI TRUNG TÂM + SƠ ĐỒ TỦ: ưu tiên đơn đang chờ, nếu không có thì đơn
   * đang chọn trong lịch sử. Nhờ vậy sơ đồ tủ luôn có chủ thể ngay màn đầu, không phải cuộn.
   */
  const donTrungTam = donDangChoTheoTu[0] || selectedOrder || null;

  /**
   * GĐ65c — SƠ ĐỒ NGĂN CỦA KHÁCH: chỉ hiện khi khách ĐANG ĐI LẤY HÀNG, và chỉ ĐÚNG ngăn của mình.
   *
   * <p><b>Lỗi user báo 18/11:</b> trước đây đơn CHƯA nạp vẫn vẽ đủ 2 ngăn của tủ (kể cả ngăn đang
   * chứa hàng của người khác), đơn `COMPLETED` vẫn vẽ ngăn, và khi lọc theo ngăn không ra thì rơi
   * về "vẽ đủ" (`loc.length ? loc : compartmentsDayDu`). Khách nhìn thấy ngăn không liên quan gì
   * tới kiện hàng của mình.
   *
   * <p><b>Quy tắc nay (thay quy tắc cũ GĐ39):</b> chỉ vẽ khi đơn trung tâm đang ở
   * `DEPOSITED`/`PICKUP_OPENED` <b>và</b> có `compartmentIndex` <b>và</b> có `lockerId` — khi đó
   * vẽ ĐÚNG 1 ô là ngăn đó. Mọi trường hợp khác (chưa nạp, đã xong, đã huỷ, quá hạn, thiếu số
   * ngăn, không tải được danh sách ngăn) ⇒ ô trống "Chưa có kiện hàng chờ lấy".
   *
   * <p>Giá trị cứng cũ (`compartmentIndex || 2`, `'LOCKER_HN_01'`, `'Trạm Tủ KTX A1'`) đã bỏ: hiện
   * tủ/ngăn nào là phải lấy từ chính đơn, không đoán.
   */
  const soDoNgan = (() => {
    if (!donTrungTam) return null;
    if (!['DEPOSITED', 'PICKUP_OPENED'].includes(donTrungTam.status)) return null;
    const cuaDon = donTrungTam.compartmentIndex;
    if (cuaDon == null || !donTrungTam.lockerId) return null;
    if (!compartmentsDayDu) return null;
    const ngan = compartmentsDayDu.find((c) => Number(c.id) === Number(cuaDon));
    // Không tìm thấy ngăn của mình trong danh sách ⇒ KHÔNG vẽ ngăn nào khác thay vào.
    if (!ngan) return null;
    return {
      lockerId: donTrungTam.lockerId,
      lockerName: donTrungTam.lockerName,
      compartmentIndex: cuaDon,
      compartments: [ngan],
    };
  })();

  // GĐ5 — đọc cảm biến của ngăn chứa đơn đang xem, để hiển thị đúng cân nặng thật.
  // Chỉ đọc khi đơn đã có ngăn; đơn chưa nạp tủ thì không có gì để đọc.
  //
  // GĐ29 — TÁCH hàm đọc ra khỏi effect để gọi lại được theo nhịp, và **thêm `status`** vào state.
  // Lý do: effect cũ chỉ phụ thuộc `[lockerId, compartmentIndex]`; sau khi shipper nạp hàng hai giá
  // trị đó KHÔNG đổi nên effect không chạy lại, `compartmentSensor` giữ `status='EMPTY'`,
  // `weight=0` ⇒ sơ đồ đứng yên ở "Ngăn Trống". Ngoài ra `LockerCabinetVisualizer` chưa từng nhận
  // `status` của ngăn (xem chỗ truyền prop bên dưới) nên nhãn không có đường nào đúng.
  const docCamBien = useCallback(async (lockerId, compIndex) => {
    if (!lockerId || compIndex == null) {
      setCompartmentSensor(null);
      setCompartmentsDayDu(null);
      return;
    }
    try {
      const res = await lockerApi.getCompartments(lockerId);
      const list = res?.data?.data || [];
      // GĐ39 — GIỮ CẢ DANH SÁCH: đơn CHƯA nạp phải hiện đủ 2 ngăn (user chốt). Trước đây chỉ
      // `find` đúng ngăn của đơn nên sơ đồ chỉ vẽ 1 ngăn dù tủ có 2.
      setCompartmentsDayDu(list.length
        ? list.map((c) => ({
            id: c.compIndex,
            status: c.status || null,
            weight: c.currentWeight != null ? Number(c.currentWeight) / 1000 : 0,
            door: c.isDoorClosed === false ? 'OPEN' : 'CLOSED',
          }))
        : null);
      // `compartmentSensor` giữ nghĩa cũ: ngăn của ĐƠN (phục vụ doorState/sensorWeight — điều cấm #4).
      const comp = list.find((c) => c.compIndex === compIndex);
      setCompartmentSensor(comp || null);
    } catch {
      // mất mạng thì để trống, không bịa số (điều cấm #2)
      setCompartmentSensor(null);
      setCompartmentsDayDu(null);
    }
  }, []);

  useEffect(() => {
    // GĐ65c — nạp danh sách ngăn cho ĐÚNG đơn mà sơ đồ sẽ vẽ (donTrungTam có thể khác
    // selectedOrder: đơn đang chờ được ưu tiên). Không có đơn để vẽ ⇒ xoá danh sách.
    const id = donTrungTam?.lockerId;
    const idx = donTrungTam?.compartmentIndex;
    docCamBien(id, idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donTrungTam?.lockerId, donTrungTam?.compartmentIndex, donTrungTam?.orderId]);

  /**
   * GĐ40 — tải telemetry THẬT của tủ đang xem.
   *
   * <p>Trước GĐ40 header sơ đồ hard-code `ESP32 12ms` + `MQTT 1883` — không đọc từ đâu, và 1883
   * sai sự thật (hệ thống dùng TLS **8883**). Nay lấy `lastHeartbeat`/`isVirtual` từ chính
   * response `/api/lockers` rồi suy trạng thái bằng `getLockerHealth` (GĐ12).
   *
   * <p>Lỗi mạng ⇒ `null` ⇒ header ẩn. **Không** gọi `/api/mqtt/status` (403 với khách).
   */
  useEffect(() => {
    const lockerId = selectedOrder?.lockerId;
    if (!lockerId) {
      setLockerTelemetry(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await lockerApi.getAll();
        if (cancelled) return;
        const l = (res?.data?.data || []).find((x) => x.lockerId === lockerId);
        if (!l) {
          setLockerTelemetry(null);
          return;
        }
        setLockerTelemetry({
          isVirtual: l.isVirtual === true,
          lastHeartbeat: l.lastHeartbeat || null,
          health: getLockerHealth(l),
        });
      } catch {
        if (!cancelled) setLockerTelemetry(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.lockerId]);

  /**
   * GĐ29 — ĐỌC LẠI CẢM BIẾN ĐỊNH KỲ KHI ĐƠN ĐANG Ở TRONG TỦ.
   *
   * <p>Nhịp 1,5 giây, cùng nhịp với poll Kiosk bên dưới (không tạo nhịp rời rạc mới — điều cấm #5).
   *
   * <p>Chạy khi đơn đang {@code DEPOSITED} hoặc {@code PICKUP_OPENED} để trạng thái cửa/cân tiếp tục
   * cập nhật xuyên suốt phiên nhận hàng. Đơn {@code COMPLETED}/{@code CANCELLED} không còn hoạt động
   * nên KHÔNG poll — tránh rò interval/request.
   */
  useEffect(() => {
    const lockerId = selectedOrder?.lockerId;
    const compIndex = selectedOrder?.compartmentIndex;
    const orderStatus = selectedOrder?.status;
    if (!lockerId || compIndex == null) return undefined;
    if (orderStatus !== 'DEPOSITED' && orderStatus !== 'PICKUP_OPENED') return undefined;

    const timer = setInterval(() => {
      docCamBien(lockerId, compIndex);
    }, 1500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.lockerId, selectedOrder?.compartmentIndex, selectedOrder?.status]);

  /**
   * GĐ20 — tự mở modal QR/OTP khi khách chọn cách nhận trên MÀN HÌNH TỦ.
   *
   * <p>Luồng: khách đứng ở tủ bấm "nhận bằng QR/OTP" trên TFT → firmware phát
   * {@code ptit/{dev}/receive/method} → backend ghi sự kiện Kiosk → web khách poll 1,5 giây và
   * mở đúng modal. Nhờ vậy khách không phải bấm thêm lần nữa trên điện thoại.
   *
   * <p><b>Ba ràng buộc quan trọng:</b>
   * <ol>
   *   <li>Chỉ poll khi đơn đang xem có {@code lockerId} và đã {@code DEPOSITED} — chưa nạp kiện
   *       thì không có gì để nhận, mở modal chỉ gây hoang mang.</li>
   *   <li>Lần poll ĐẦU bỏ trống {@code after} → backend trả {@code events: []} + {@code latestSeq}.
   *       Nếu gửi {@code after} cũ thì mở tab là modal bật lên vì sự kiện của lần test trước.</li>
   *   <li>Chỉ phản ứng với sự kiện {@code CUSTOMER_METHOD_CHOSEN} của ĐÚNG tủ đang xem (backend đã
   *       lọc theo {@code lockerId}, đây là lớp kiểm thứ hai).</li>
   * </ol>
   */
  useEffect(() => {
    const lockerId = selectedOrder?.lockerId;
    const orderStatus = selectedOrder?.status;
    const orderId = selectedOrder?.orderId;

    // GĐ32 — GHI NHỚ đơn nào đã từng "ở trong tủ" trong phiên này.
    //
    // Lý do: khi khách lấy hàng xong, đơn đổi sang `COMPLETED`. Nếu điều kiện poll chỉ nhận
    // `DEPOSITED`/`PICKUP_OPENED` thì poll TẮT ngay đúng lúc sự kiện `PICKUP_SUCCESS` vừa được bắn
    // → popup "Lấy hàng thành công" không bao giờ hiện, và khách lại phải F5 (đúng lỗi user báo).
    //
    // Nhưng KHÔNG thể poll mọi trạng thái: mở tab trên một đơn đã `COMPLETED` từ trước sẽ gọi API
    // mãi (vi phạm phép thử 6 của GĐ29: đơn không còn hoạt động phải có 0 request).
    // Vì vậy chỉ giữ poll thêm cho những đơn CHÍNH PHIÊN NÀY đã thấy ở trạng thái có hàng.
    if (orderId && (orderStatus === 'DEPOSITED' || orderStatus === 'PICKUP_OPENED')) {
      daThayTrongTuRef.current.add(orderId);
    }
    const conChoChot = orderId && daThayTrongTuRef.current.has(orderId);

    if (!lockerId) return undefined;
    /**
     * GĐ49b — POLL CẢ KHI ĐƠN CÒN `PENDING`.
     *
     * <p><b>Vì sao mở rộng:</b> trước GĐ49b poll chỉ chạy khi đơn đã `DEPOSITED`/`PICKUP_OPENED`.
     * Nhưng khối "Bưu kiện đang chờ bạn" lại CẦN biết đúng lúc đơn vừa được nạp — mà lúc đó đơn
     * còn `PENDING` trên UI nên poll đang TẮT, và khách phải F5 mới thấy kiện của mình (chính là
     * lỗi GĐ42 quay lại ở giao diện mới). Nay poll cả `PENDING`; nhịp vẫn **1,5 giây** và dùng
     * CHUNG `kioskSeq` (điều cấm #1: không tạo nhịp mới, không đổi API).
     */
    const TRANG_THAI_POLL = ['PENDING', 'PENDING_OPENED', 'DEPOSITED', 'PICKUP_OPENED'];
    if (!TRANG_THAI_POLL.includes(orderStatus) && !conChoChot) return undefined;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await pickupApi.getKioskEvents(lockerId, kioskSeq);
        if (cancelled) return;
        const payload = res?.data?.data;
        if (!payload) return;

        const events = payload.events || [];
        // Tìm sự kiện MỚI NHẤT thuộc loại "khách chọn cách nhận" của đúng tủ này.
        const chosen = [...events]
          .reverse()
          .find((e) => e.type === 'CUSTOMER_METHOD_CHOSEN'
            && (!e.lockerId || e.lockerId === lockerId));

        if (chosen) {
          const method = String(chosen.message || '').toLowerCase();
          // GĐ26 — KHÔNG còn tự mở modal. User đổi ý so với GĐ20: tự bật popup làm khách giật
          // mình khi đang làm việc khác. Nay chỉ GỬI THÔNG BÁO vào chuông; khách bấm vào thông báo
          // mới mở modal (Navbar phát `smart_locker_open_pickup`, effect dưới lắng nghe).
          //
          // CHỐNG SPAM: chỉ tạo thông báo khi `chosen.seq` chưa xử lý. Poll 1,5 giây sẽ gặp lại
          // đúng sự kiện đó nhiều lần (vì `since()` trả mọi sự kiện > after của lần trước), nên nếu
          // không chặn thì 10 giây sau có ~6 thông báo giống nhau.
          if ((method === 'qr' || method === 'otp') && !processedKioskSeqRef.current.has(chosen.seq)) {
            processedKioskSeqRef.current.add(chosen.seq);
            // GĐ64b — thông báo do BACKEND ghi (`KIOSK_METHOD_CHOSEN`, bảng notifications). Ở đây
            // chỉ nhắc chuông tải lại ngay, không tự tạo bản sao trong localStorage.
            store.refreshNotifications();
          }
        }

        // GĐ32 — KHÁCH ĐÃ LẤY HÀNG XONG.
        //
        // Backend bắn `PICKUP_SUCCESS` ở chỗ CHỐT (khi cảm biến xác nhận hàng đã ra), không phải
        // lúc mở cửa — nên sự kiện này là bằng chứng đáng tin để hiện popup "Lấy hàng thành công".
        //
        // Ba việc phải làm, đúng thứ tự:
        //  1. `loadOrders()` — đọc lại danh sách THẬT từ API (điều cấm #1: không tự sửa state).
        //  2. Hiện POPUP có nút đóng (điều cấm #3: không phải toast 4 giây).
        //  3. Reset lựa chọn: đóng modal QR/OTP, bỏ chọn đơn vừa nhận, xoá cảm biến.
        // Chống trùng bằng `processedKioskSeqRef` (điều cấm #4) — poll 1,5 giây sẽ gặp lại sự kiện.
        const pickDone = [...events]
          .reverse()
          .find((e) => e.type === 'PICKUP_SUCCESS'
            && (!e.lockerId || e.lockerId === lockerId)
            && !processedKioskSeqRef.current.has(e.seq));

        if (pickDone) {
          processedKioskSeqRef.current.add(pickDone.seq);
          const doneOrderId = pickDone.orderId || selectedOrder?.orderId || null;
          const doneOrder = orders.find((o) => o.orderId === doneOrderId) || selectedOrder;

          await loadOrders();
          setPickupDoneInfo({
            orderId: doneOrderId,
            compartmentIndex: pickDone.compartment ?? doneOrder?.compartmentIndex ?? null,
            at: new Date(),
          });
          setQrModalOrder(null);
          setOtpModalOrder(null);
          setCompartmentSensor(null);
          setSelectedOrderId(null);

          // GĐ64b — thông báo `PICKUP_SUCCESS` do backend ghi; popup ở trên GIỮ nguyên.
          store.refreshNotifications();
        }

        // GĐ42 — KHÁCH QUÊN LẤY HÀNG.
        //
        // Backend (GĐ31a) **đã** bắn `PICKUP_LEFT_BEHIND` kèm câu tiếng Việt, nhưng trước GĐ42
        // `grep frontend/src` = **0 hit** ⇒ sự kiện được ghi rồi bị bỏ. Nay frontend đọc:
        // `loadOrders()` để đơn quay về `DEPOSITED`, hiện rõ thông báo thất bại, tải lại cảm biến
        // ngăn và cập nhật chuông thông báo.
        //
        // ⚠ KHÔNG hiện popup "Lấy hàng thành công" — đây là THẤT BẠI, hai sự kiện loại trừ nhau
        // (điều cấm #2 của thẻ GĐ42).
        const leftBehind = [...events]
          .reverse()
          .find((e) => e.type === 'PICKUP_LEFT_BEHIND'
            && (!e.lockerId || e.lockerId === lockerId)
            && e.orderId === orderId
            && !processedKioskSeqRef.current.has(e.seq));

        if (leftBehind) {
          processedKioskSeqRef.current.add(leftBehind.seq);

          await loadOrders();
          setPickupLeftInfo({
            orderId: leftBehind.orderId || selectedOrder?.orderId || null,
            compartmentIndex: leftBehind.compartment ?? null,
          });
          // GĐ67 — mã cũ đã hết hiệu lực; nút "Lấy mã mới" trong popup tải mã MỚI từ máy chủ.
          setCompartmentSensor(null);
          setPickupDoneInfo(null);
          setQrModalOrder(null);
          setQrToken('');
          setOtpModalOrder(null);
          setCopiedOtp(false);

          // GĐ64b — thông báo `PICKUP_LEFT_BEHIND` do backend ghi.
          store.refreshNotifications();
        }

        // GĐ49b — KIỆN VỪA ĐƯỢC NẠP VÀO TỦ (`DEPOSIT_SUCCESS`).
        //
        // Trước GĐ49b chỉ TAB SHIPPER đọc sự kiện này; tab khách không đọc nên khối "Bưu kiện đang
        // chờ bạn" chỉ cập nhật ở nhịp tải trang kế tiếp ⇒ khách phải F5 (đúng lỗi GĐ42 ở giao diện
        // mới). Nay khách đọc: `loadOrders()` để đơn chuyển `PENDING` → `DEPOSITED`, thẻ xuất hiện
        // trong khối trung tâm, + thông báo qua chuông (không popup — GĐ26: không tự bật popup).
        const vuaNap = [...events]
          .reverse()
          .find((e) => e.type === 'DEPOSIT_SUCCESS'
            && (!e.lockerId || e.lockerId === lockerId)
            && !processedKioskSeqRef.current.has(e.seq));

        if (vuaNap) {
          processedKioskSeqRef.current.add(vuaNap.seq);
          await loadOrders();
          // GĐ64b — thông báo `DEPOSIT_SUCCESS` do backend ghi (kể cả khi tab này đóng lúc nạp).
          store.refreshNotifications();
        }

        // Luôn cập nhật mốc, kể cả khi không có sự kiện — nếu chỉ cập nhật khi có sự kiện thì
        // lần poll sau vẫn hỏi từ mốc cũ và xử lý lại đúng sự kiện vừa rồi.
        if (payload.latestSeq != null) {
          setKioskSeq(payload.latestSeq);
        }
      } catch {
        // Không có quyền / mất mạng: im lặng bỏ qua nhịp này. Đây là tiện ích phụ, không được
        // làm phiền khách bằng banner lỗi khi họ vẫn mở được mã bằng nút bấm tay.
      }
    };

    poll(); // đọc ngay, không để trống 1,5 giây đầu
    const timer = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.lockerId, selectedOrder?.status, selectedOrder?.orderId, kioskSeq]);

  // Đổi đơn đang xem thì phải quên mốc cũ, nếu không sẽ so sánh nhầm với seq của tủ khác.
  useEffect(() => {
    setKioskSeq(null);
  }, [selectedOrder?.orderId]);

  /**
   * GĐ26 — mở modal khi khách BẤM vào thông báo ở chuông.
   *
   * <p>Navbar phát `smart_locker_open_pickup` với `{ orderId, method }`. Tab này lắng nghe rồi mở
   * ĐÚNG modal tương ứng — dùng lại 2 modal đang có, không dựng modal mới (điều cấm #5).
   *
   * <p><b>Vì sao chọn CustomEvent thay vì chuyển tab:</b> tab "Bưu kiện của tôi" đã mount sẵn khi
   * khách đang xem; nếu khách đang ở tab khác thì `Navbar` cũng đã chuyển tab trước khi phát event
   * (xem `Navbar.handleNotificationClick`). Cách này không cần đụng `App.jsx`/props xuyên tầng.
   *
   * <p>Đơn trong event có thể KHÁC đơn đang chọn → phải `setSelectedOrderId` trước để modal hiện
   * đúng đơn, và tra trong `orders` bản mới nhất.
   */
  useEffect(() => {
    const onOpenPickup = (ev) => {
      const detail = ev?.detail || {};
      const { orderId, method } = detail;
      if (!orderId) return;
      setSelectedOrderId(orderId);
      const target = orders.find((o) => o.orderId === orderId);
      if (!target) return; // danh sách chưa tải xong — khách bấm lại được từ chuông
      if (method === 'otp') {
        // Mở modal OTP rồi tạo mã nếu chưa có (giống hệt đường mở bằng tay ở GĐ25).
        setOtpModalOrder(target);
        if (!getOtpStatus(target).isGenerated) {
          handleGenerateOtp(target);
        }
      } else {
        handleOpenQrModal(target);
      }
    };
    window.addEventListener('smart_locker_open_pickup', onOpenPickup);
    return () => window.removeEventListener('smart_locker_open_pickup', onOpenPickup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'DEPOSITED':
        return (
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            Đã về tủ (Sẵn sàng lấy)
          </span>
        );
      case 'PENDING':
        return (
          <span className="bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Chờ shipper nạp
          </span>
        );
      case 'PENDING_OPENED':
        return (
          <span className="bg-violet-50 text-violet-800 border border-violet-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block animate-pulse" />
            Đang nạp hàng vào tủ
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" /> Đã nhận thành công
          </span>
        );
      // GĐ31a — trạng thái TRUNG GIAN: khách đã xác thực mã và cửa đang/đã mở nhưng hệ thống
      // CHƯA chốt là hàng đã ra (chờ cảm biến). Phải có nhãn riêng, nếu không badge sẽ trắng và
      // khách không hiểu vì sao đơn không còn ở "Đã về tủ" mà cũng chưa "Đã nhận".
      case 'PICKUP_OPENED':
        return (
          <span className="bg-sky-50 text-sky-800 border border-sky-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-sky-500 inline-block animate-pulse" />
            Đang mở tủ để lấy hàng
          </span>
        );
      case 'OVERDUE':
        return (
          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Quá hạn lưu kho
          </span>
        );
      // BUG ĐÃ SỬA: trước đây thiếu nhánh CANCELLED nên rơi vào `default: return null`.
      // Hậu quả: đơn đã huỷ hiện trong danh sách của khách với KHÔNG nhãn trạng thái và
      // KHÔNG có cách nhận — khách tưởng hệ thống lỗi, không hiểu vì sao không nhận được.
      // API trả cả đơn CANCELLED (chủ ý, để khách tra được lịch sử), nên phải có nhãn.
      case 'CANCELLED':
        return (
          <span className="bg-slate-100 text-slate-600 border border-slate-300 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5 text-slate-500" /> Đơn đã huỷ
          </span>
        );
      default:
        return (
          <span className="bg-slate-100 text-slate-500 border border-slate-200 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
            {status || 'Không rõ'}
          </span>
        );
    }
  };

  // GĐ35 — ĐÃ XOÁ `lockersForMap` cùng bản đồ GIS ở tab này (user yêu cầu bỏ bản đồ).
  //
  // Đáng chú ý: mảng đó chứa toạ độ **BỊA** — `latitude/longitude` được gán cứng theo điều kiện
  // `lockerId === 'LOCKER_HN_02'`, chỉ đúng cho 2 tủ và sai cho 8 tủ còn lại. Nó tồn tại chỉ để vẽ
  // marker trên bản đồ nhỏ; bỏ bản đồ là bỏ luôn nguồn dữ liệu sai này, không phải mất thông tin
  // thật (vị trí thật vẫn xem ở tab "Bản đồ mạng lưới tủ", lấy từ API).

  return (
    <div className="space-y-5 notranslate select-none">
      {/* GĐ13 — banner fallback: khách phải biết danh sách này KHÔNG phải dữ liệu máy chủ. */}
      {usingFallback && (
        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-[11px] flex items-start gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <span>
            Không tải được đơn từ máy chủ — danh sách dưới đây là dữ liệu tạm lưu trên trình duyệt
            này và có thể đã cũ. Kiểm tra kết nối hoặc đăng nhập lại.
          </span>
        </div>
      )}


      {/* GĐ49b — 4 KPI THU GỌN thành 1 hàng nhỏ (trước: 4 thẻ lớn chiếm gần 1/3 màn đầu).
          Nội dung + số liệu GIỮ NGUYÊN (không đổi logic đếm). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {[
          { label: 'Tổng bưu kiện', value: orders.length, icon: Package, tone: 'text-blue-700 bg-blue-50 border-blue-200' },
          { label: 'Sẵn sàng mở tủ', value: orders.filter((o) => o.status === 'DEPOSITED').length, icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
          { label: 'Chờ shipper nạp', value: orders.filter((o) => o.status === 'PENDING' || o.status === 'PENDING_OPENED').length, icon: Clock, tone: 'text-amber-800 bg-amber-50 border-amber-200' },
          { label: 'Đã hoàn thành', value: orders.filter((o) => o.status === 'COMPLETED').length, icon: ShieldCheck, tone: 'text-slate-700 bg-slate-100 border-slate-200' },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider block truncate">
                  {k.label}
                </span>
                <span className="text-xl font-bold text-slate-900 font-mono leading-tight">
                  <CountUp value={k.value} />
                </span>
              </div>
              <span className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${k.tone}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          GĐ49b — TRUNG TÂM: "BƯU KIỆN ĐANG CHỜ BẠN" + SƠ ĐỒ TỦ NGAY CẠNH
          Trước: danh sách 13 đơn (phần lớn "Đơn đã huỷ") chiếm cột trái, sơ đồ tủ nằm CUỐI cột
          phải nên phải cuộn mới thấy. Nay khối này ở đầu trang, sơ đồ cùng hàng (desktop) hoặc
          ngay dưới (mobile) — đúng yêu cầu user.
          ═══════════════════════════════════════════════════════════════════════ */}
      <section aria-label="Bưu kiện đang chờ bạn" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* (A) Danh sách đơn ĐANG CHỜ — thẻ lớn, dùng LẠI handler QR/OTP hiện có. */}
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" />
              Bưu kiện đang chờ bạn
              {donDangChoTheoTu.length > 0 && (
                <span className="text-[11px] font-bold text-white bg-blue-600 px-2 py-0.5 rounded-full">
                  {donDangChoTheoTu.length}
                </span>
              )}
            </h2>
          </div>

          {loadingOrders ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse" data-testid="waiting-skeleton">
              <div className="h-4 w-40 rounded bg-slate-200 mb-3" />
              <div className="h-3 w-2/3 rounded bg-slate-200" />
            </div>
          ) : donDangChoTheoTu.length === 0 ? (
            /* Trạng thái TRỐNG rõ ràng (phép thử #4) */
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center" data-testid="waiting-empty">
              <Package className="w-9 h-9 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-800">
                {lockerFilterId
                  ? 'Bạn không có bưu kiện nào ở tủ này'
                  : 'Chưa có bưu kiện nào về tủ'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {donDangChoTheoTu.map((ord) => {
                const conHan = calculateRemainingTime(ord.expiryDeadline, ord.depositedAt);
                return (
                  <div
                    key={ord.orderId}
                    data-testid={`waiting-order-${ord.orderId}`}
                    className="bg-white border-2 border-blue-200 rounded-xl p-4 shadow-sm space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="font-mono text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                          {ord.orderId}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900 mt-1.5 truncate">
                          {ord.productName || 'Bưu kiện Smart Locker'}
                        </h3>
                        <p className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                          {ord.lockerName || 'Tủ KTX A1'} · Ngăn #{ord.compartmentIndex}
                        </p>
                      </div>
                      {getStatusBadge(ord.status)}
                    </div>

                    {/* Hạn lưu kho đếm ngược — dùng LẠI `calculateRemainingTime` (không logic mới). */}
                    <div className={`px-3 py-2 rounded-lg border text-[11px] font-semibold flex items-center justify-between ${
                      conHan.isOverdue
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : conHan.color === 'rose'
                        ? 'bg-rose-50 border-rose-200 text-rose-800'
                        : conHan.color === 'amber'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    }`}>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Hạn lưu kho
                      </span>
                      <span className="font-mono">{conHan.label}</span>
                    </div>

                    {/* Nếu OTP đã có: hiện luôn mã + nút phóng to / đổi mã (tái dùng handler). */}
                    {(() => {
                      const st = getOtpStatus(ord);
                      if (!st.isGenerated || st.isExpired) return null;
                      return (
                        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          <span className="font-mono text-lg font-bold text-blue-700 tracking-widest">
                            {ord.otpCode}
                          </span>
                          <span className="text-[11px] font-mono font-semibold text-slate-700">
                            còn {formatSeconds(st.remainingSeconds)}
                          </span>
                          <button
                            onClick={() => setOtpModalOrder(ord)}
                            className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer"
                          >
                            Phóng to
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* (B) SƠ ĐỒ TỦ — NGAY CẠNH khối trên (desktop) / ngay dưới (mobile).
            GĐ65c — CHỈ vẽ khi khách đang đi lấy hàng, và chỉ ĐÚNG ngăn của đơn mình. */}
        <div className="lg:col-span-6 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Sơ đồ ngăn tủ</h2>
            {soDoNgan && (
              <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                Ngăn #{soDoNgan.compartmentIndex}
              </span>
            )}
          </div>

          {soDoNgan ? (
            <LockerCabinetVisualizer
              lockerName={soDoNgan.lockerName}
              lockerId={soDoNgan.lockerId}
              activeSlotId={soDoNgan.compartmentIndex}
              // GĐ65c — MỘT ô duy nhất: ngăn chứa kiện hàng của chính khách.
              compartments={soDoNgan.compartments}
              telemetry={lockerTelemetry}
              doorState={compartmentSensor?.isDoorClosed != null
                ? (compartmentSensor.isDoorClosed ? 'CLOSED' : 'OPEN')
                : 'CLOSED'}
              sensorWeight={compartmentSensor?.currentWeight != null
                ? Number(compartmentSensor.currentWeight) / 1000
                : 0}
              compact={true}
            />
          ) : (
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">
              <Layers className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-600">Chưa có kiện hàng chờ lấy</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Sơ đồ ngăn chỉ hiện khi kiện hàng của bạn đã được nạp vào tủ.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          GĐ49b — "LỊCH SỬ ĐƠN" (danh sách đầy đủ, đã đưa XUỐNG DƯỚI khối trung tâm)
          Bộ lọc GIỮ NGUYÊN (điều cấm #4), chỉ thêm tab "Đơn đã huỷ" + đổi mặc định ẩn huỷ.
          ═══════════════════════════════════════════════════════════════════════ */}
      <section aria-label="Lịch sử đơn" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-600" />
            Lịch sử đơn
          </h2>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative flex-1 w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm theo mã đơn (ORD-...), tên sản phẩm, trạm tủ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 text-slate-900 placeholder:text-slate-500 text-xs rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition font-medium"
            />
          </div>

          <div className="ios-segmented-tray flex flex-wrap gap-1 w-full sm:w-auto">
            {[
              { id: 'ALL', label: 'Tất cả' },
              { id: 'DEPOSITED', label: 'Hàng đã về tủ' },
              { id: 'PENDING', label: 'Chờ giao' },
              { id: 'COMPLETED', label: 'Đã nhận' },
              // GĐ49b — tab MỚI: đơn huỷ bị ẩn mặc định nên phải có đường xem lại (điều cấm #4).
              { id: 'CANCELLED', label: 'Đơn đã huỷ' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterStatus === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Detail cũ (chi tiết + nút QR/OTP + sơ đồ) — GIỮ NGUYÊN để không mất chức năng nào;
            sơ đồ tủ ở đây đã chuyển lên khối trung tâm nên chỉ còn phần chi tiết + nút. */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* PANE 1: danh sách lịch sử */}
          <div className="lg:col-span-5 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Danh sách đơn ({filteredOrders.length})
              </span>
              {/* GĐ49b — `text-slate-600` thay `slate-400` (2.4:1 → ≥4.5:1). */}
              <span className="text-[11px] text-slate-600">Chọn đơn để tra cứu</span>
            </div>

          <div className="space-y-3 max-h-[780px] overflow-y-auto pr-1">
            {/* GĐ37 — SKELETON khi ĐANG TẢI THẬT. Trước đây API chậm thì hiện thẳng
                "Không có đơn hàng nào khớp bộ lọc" — khách tưởng mất đơn. Dùng `animate-pulse`
                có sẵn (không thêm keyframe). Chỉ hiện khi `loadingOrders === true`. */}
            {loadingOrders ? (
              <div className="space-y-3" data-testid="orders-skeleton">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-2xl border border-white/80 bg-white/60 animate-pulse">
                    <div className="flex items-center justify-between mb-2">
                      <div className="h-4 w-28 rounded bg-slate-200/70" />
                      <div className="h-4 w-20 rounded-full bg-slate-200/70" />
                    </div>
                    <div className="h-3 w-3/4 rounded bg-slate-200/70 mb-2" />
                    <div className="h-3 w-1/2 rounded bg-slate-200/70" />
                  </div>
                ))}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="liquid-glass-card p-10 rounded-3xl border border-white/80 text-center shadow-sm">
                <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-medium">Không có đơn hàng nào khớp bộ lọc</p>
              </div>
            ) : (
              filteredOrders.map((ord) => {
                const isSelected = selectedOrder?.orderId === ord.orderId;

                return (
                  <div
                    key={ord.orderId}
                    onClick={() => setSelectedOrderId(ord.orderId)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'liquid-glass-card border-blue-500/90 ring-2 ring-blue-500/30 shadow-xl shadow-blue-500/15 -translate-y-0.5'
                        : 'liquid-glass-subtle border-white/70 hover:border-white/95 hover:bg-white/60 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200/80 px-2.5 py-0.5 rounded-md">
                        {ord.orderId}
                      </span>
                      {getStatusBadge(ord.status)}
                    </div>

                    <h4 className="font-bold text-slate-900 text-xs truncate">
                      {ord.productName || 'Bưu kiện Smart Locker'}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2.5 pt-2.5 border-t border-slate-100">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-500" /> {ord.lockerName || 'Tủ KTX A1'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANE 2: DETAIL INSPECTOR & CONTROL STATION (7 Columns) */}
        <div className="lg:col-span-7 space-y-4">
          {selectedOrder ? (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-5 sm:p-7 shadow-md space-y-5">
              {/* Header of Active Order */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                      {selectedOrder.orderId}
                    </span>
                    {/* GĐ49b — `text-slate-400` chỉ 2.63:1 trên thẻ trắng; đổi `slate-600`. */}
                    <span className="text-xs text-slate-600">
                      Ngày tạo: <span className="font-mono text-slate-700 font-semibold">{selectedOrder.orderDate || selectedOrder.expectedDate}</span>
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-1.5">
                    {selectedOrder.productName || 'Kiện hàng Smart Locker'}
                  </h3>
                </div>

                <div>
                  {getStatusBadge(selectedOrder.status)}
                </div>
              </div>

              {/* Countdown Banner if DEPOSITED */}
              {selectedOrder.status === 'DEPOSITED' && (
                <div className="p-4 rounded-2xl bg-blue-50/80 border border-blue-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-blue-600" />
                      Thời hạn lưu kho miễn phí:
                    </span>
                    <span className="font-bold text-blue-700 font-mono">
                      {calculateRemainingTime(selectedOrder.expiryDeadline, selectedOrder.depositedAt).label}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all"
                      style={{ width: `${calculateRemainingTime(selectedOrder.expiryDeadline, selectedOrder.depositedAt).percent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Hạn lưu kho: Hết 24h00 hôm sau.
                  </p>
                </div>
              )}

              {/* Action Buttons if Ready to Pickup */}
              {/* GĐ31a — `PICKUP_OPENED` = khách đã mở cửa nhưng hệ thống chưa chốt là hàng đã ra.
                  Vẫn phải hiện nút mở lại bằng CHÍNH mã cũ: đây đúng là ca khách quên lấy hàng. */}
              {(selectedOrder.status === 'DEPOSITED' || selectedOrder.status === 'PICKUP_OPENED') && (
                <div className="p-5 rounded-3xl liquid-glass-subtle border border-white/80 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-slate-800 uppercase tracking-wider block">
                      Mở Tủ Tại Kiosk
                    </span>
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50/80 px-2.5 py-0.5 rounded-full border border-emerald-200">
                      Solenoid Sẵn Sàng
                    </span>
                  </div>

                  {/* GĐ20 — nói rõ cho khách biết phải thao tác trên màn hình tủ; bấm chọn ở tủ
                      thì modal dưới đây sẽ TỰ mở. Nếu không có dòng này khách không hiểu vì sao
                      hệ thống "tự mở" modal. */}
                  <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 leading-snug">
                    Tủ đang chờ bạn chọn cách nhận: hãy bấm <strong>QR</strong> hoặc <strong>OTP</strong> trên
                    màn hình tủ — mã sẽ được gửi về <strong>thông báo</strong> (biểu tượng chuông), bấm vào để mở mã.
                  </p>

                  {/* Bỏ nút "Mã QR Nhận Hàng" / "Tạo Mã OTP": mã chỉ lấy qua THÔNG BÁO sau khi khách chọn
                      QR/OTP trên màn hình tủ (bấm thông báo ⇒ tự mở modal QR hoặc tự tạo OTP). Nếu OTP đang còn
                      hiệu lực thì chỉ HIỂN THỊ lại mã (không tạo/đổi mã ở đây). */}
                  {(() => {
                    const otpStatus = getOtpStatus(selectedOrder);
                    if (!otpStatus.isGenerated || otpStatus.isExpired) return null;
                    return (
                      <div className="flex items-center justify-between bg-white/70 border border-white/90 rounded-2xl p-2.5 px-3.5 shadow-inner">
                        <div>
                          <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Mã OTP đang hiệu lực · còn {formatSeconds(otpStatus.remainingSeconds)}
                          </span>
                          <div className="font-mono text-lg font-black text-blue-700 tracking-widest">{selectedOrder.otpCode}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopyOtp(selectedOrder.otpCode)}
                            title="Sao chép OTP"
                            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-white/80 rounded-lg transition cursor-pointer"
                          >
                            {copiedOtp ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setOtpModalOrder(selectedOrder)}
                            className="text-[11px] text-blue-600 hover:underline font-bold cursor-pointer"
                          >
                            Phóng to
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Vì sao đơn này KHÔNG có nút nhận hàng — trước đây khách chỉ thấy trống trơn
                  và tưởng hệ thống lỗi. Nêu đúng lý do theo từng trạng thái. */}
              {selectedOrder.status !== 'DEPOSITED' && (
                <div className="p-4 rounded-2xl bg-slate-50/90 border border-slate-200 flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-600 space-y-1">
                    <p className="font-bold text-slate-800">
                      {selectedOrder.status === 'PENDING' && 'Chưa thể nhận hàng: shipper chưa nạp kiện vào tủ.'}
                      {selectedOrder.status === 'PENDING_OPENED' && 'Phiên nạp đang mở: shipper đang bỏ kiện vào ngăn.'}
                      {selectedOrder.status === 'CANCELLED' && 'Đơn đã bị huỷ nên không nhận được tại tủ.'}
                      {selectedOrder.status === 'COMPLETED' && 'Đơn đã được nhận xong trước đó.'}
                      {/* GĐ53 — câu cũ ghi "đã được thu hồi khỏi tủ" là SAI: đơn OVERDUE nghĩa là
                          bưu kiện VẪN NẰM TRONG NGĂN, chờ shipper tới thu hồi về bưu cục. Khách đọc
                          câu cũ sẽ tưởng hàng đã rời tủ và không biết phải làm gì tiếp. */}
                      {selectedOrder.status === 'OVERDUE'
                        && 'Đơn quá hạn lưu kho — bưu kiện đang chờ shipper thu hồi về bưu cục.'}
                      {!['PENDING', 'PENDING_OPENED', 'CANCELLED', 'COMPLETED', 'OVERDUE'].includes(selectedOrder.status)
                        && `Trạng thái hiện tại: ${selectedOrder.status || 'không rõ'}.`}
                    </p>
                    <p>
                      {selectedOrder.status === 'PENDING'
                        && 'Mã QR và OTP chỉ mở được sau khi kiện đã nằm trong ngăn tủ.'}
                      {selectedOrder.status === 'PENDING_OPENED'
                        && 'Phiên nạp sẽ kết thúc khi shipper đóng cửa và cảm biến xác nhận kiện hàng.'}
                      {selectedOrder.status === 'CANCELLED'
                        && 'Nếu bạn vẫn cần kiện hàng này, liên hệ bưu cục để tạo đơn mới.'}
                      {selectedOrder.status === 'COMPLETED'
                        && 'Xem lại lịch sử ở bộ lọc "Đã nhận".'}
                      {selectedOrder.status === 'OVERDUE'
                        && 'Liên hệ bưu cục để được hỗ trợ nhận lại kiện.'}
                    </p>
                  </div>
                </div>
              )}

              {/* GĐ49b — SƠ ĐỒ TỦ ĐÃ CHUYỂN LÊN KHỐI TRUNG TÂM ("Bưu kiện đang chờ bạn").
                  Ở đây chỉ còn phần chi tiết + nút, KHÔNG vẽ sơ đồ lần hai: hai bản sao cùng một
                  component làm trang dài gấp đôi và khách phải cuộn — đúng triệu chứng thẻ muốn sửa.
                  Props của visualizer không đổi (GĐ39/GĐ40/GĐ5 giữ nguyên), chỉ đổi CHỖ ĐẶT. */}

              {/* GĐ35 — ĐÃ BỎ BẢN ĐỒ GIS ở tab nhận hàng của khách (user yêu cầu 16/11).
                  Lý do user: bản đồ nhỏ trong tab này chiếm chỗ, chữ trên tile bị cắt, và khách
                  đã có tab "Bản đồ mạng lưới tủ" riêng để xem vị trí + chỉ đường.
                  GIỮ LẠI khối thông tin trạm (tên + địa chỉ + số ngăn) vì khách vẫn cần biết
                  mình phải tới đâu — chỉ bỏ phần bản đồ. */}
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Vị Trí Trạm Tủ
                </span>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                  <div>
                    <h5 className="font-bold text-slate-900 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      {selectedOrder.lockerName || 'Trạm Tủ KTX A1'}
                    </h5>
                    {/* GĐ36 — trước đây dòng này LUÔN trống vì `OrderDTO` không có `lockerAddress`
                        (minh phát hiện khi nghiệm thu GĐ35). Nay backend trả địa chỉ thật. Vẫn phải
                        có nhánh dự phòng: đơn chưa gán tủ thì `lockerAddress` = null, in
                        "undefined" ra màn hình khách là lỗi tệ hơn để trống. */}
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      {selectedOrder.lockerAddress || 'Chưa có địa chỉ trạm'}
                    </p>
                  </div>

                  <span className="bg-blue-50 text-blue-700 font-bold px-3 py-1 rounded-lg border border-blue-200 text-xs">
                    {/* GĐ18 — bỏ "(Size …)": mọi ngăn dùng được như nhau. */}
                    Ngăn #{selectedOrder.compartmentIndex || 2}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-12 text-center">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm">Chưa chọn đơn hàng nào</h4>
              <p className="text-xs text-slate-500 mt-1">Hãy nhấp vào một đơn hàng bên danh sách để xem chi tiết.</p>
            </div>
          )}
        </div>
      </div>
      </section>

      {/* QR Modal — mã tĩnh theo đơn, không đếm ngược */}
      {qrModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setQrModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-blue-200 shadow-2xs">
              <QrCode className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã QR Nhận Hàng Kiosk</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Mã vận đơn: <strong className="text-slate-900">{qrModalOrder.orderId}</strong>
            </p>

            {qrToken ? (
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 inline-block my-3 shadow-md">
                <QRCodeSVG value={qrToken} size={180} />
              </div>
            ) : (
              // W2: chưa có mã thật (đơn chưa được nạp vào tủ, hoặc chưa phải chủ đơn).
              // Hiện thông báo rõ ràng — KHÔNG dựng mã giả, KHÔNG để màn trắng.
              <div className="my-6 mx-auto max-w-xs p-4 rounded-2xl bg-amber-50 border border-amber-200 text-center">
                <AlertTriangle className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-bold text-amber-800">Chờ nạp hàng vào tủ</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  Mã QR nhận hàng chỉ hiện sau khi shipper đã bỏ kiện hàng vào tủ.
                </p>
              </div>
            )}

            <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 text-xs text-slate-700 text-left space-y-1 mb-4">
              <p><strong>Trạm tủ:</strong> {qrModalOrder.lockerName}</p>
              <p><strong>Vị trí:</strong> Ngăn #{qrModalOrder.compartmentIndex}</p>            </div>

            <div className="flex gap-2">
              <button
                onClick={() => loadRealQrToken(qrModalOrder)}
                className="ios-btn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Tải lại mã</span>
              </button>
              <button
                onClick={() => setQrModalOrder(null)}
                className="ios-btn flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer shadow-sm shadow-blue-500/20"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OTP Modal (Hiệu lực 5 phút) với CircularTimer */}
      {/* GĐ32 — POPUP "LẤY HÀNG THÀNH CÔNG" (có nút đóng, KHÔNG tự tắt — điều cấm #3).
          Hiện khi backend bắn `PICKUP_SUCCESS` ở chỗ chốt (cảm biến xác nhận hàng đã ra). */}
      {pickupLeftInfo && (
        <div
          data-testid="pickup-left-behind-popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200"
        >
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-amber-200 bg-white">
            <button
              onClick={() => setPickupLeftInfo(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="w-14 h-14 bg-amber-100 text-amber-700 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-amber-200">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="text-base font-extrabold text-amber-800">Bạn quên lấy hàng</h3>
            <p className="text-xs text-slate-600 mt-2">
              Hàng vẫn còn trong tủ. Mã cũ đã hết hiệu lực — hãy dùng mã mới (QR mới hoặc xin OTP mới) để lấy lại.
            </p>
            <button
              onClick={async () => {
                const id = pickupLeftInfo.orderId;
                setPickupLeftInfo(null);
                if (!id) return;
                // GĐ67 — mã đã đổi ở máy chủ: tải lại đơn rồi mới mở QR, không dùng đơn cũ trong state.
                setQrToken('');
                await loadOrders();
                const phone = currentUser?.phone || orders.find((o) => o.orderId === id)?.customerPhone;
                let fresh = null;
                try {
                  fresh = phone ? (await orderApi.getById(id, phone))?.data?.data : null;
                } catch {
                  fresh = null;
                }
                const target = fresh || orders.find((o) => o.orderId === id);
                if (target) handleOpenQrModal(target);
              }}
              className="mt-5 w-full py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold"
            >
              Lấy mã mới
            </button>
          </div>
        </div>
      )}

      {pickupDoneInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setPickupDoneInfo(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>

            {/* GĐ37 ý 5 — dấu ✓ VẼ RA (một lần).
                Dùng SVG path + `stroke-dasharray/offset` (class `.draw-check` trong `index.css`)
                thay vì icon tĩnh: nét được vẽ dần từ trái sang phải. `pop-success` phóng nhẹ
                vòng tròn. Cả hai chạy `1` lần, không lặp (điều cấm #4). */}
            <div className="pop-success w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-200 shadow-2xs">
              <svg
                className="draw-check w-7 h-7"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <h3 className="text-base font-extrabold text-slate-900">Lấy hàng thành công</h3>
            <p className="text-xs text-slate-500 mt-1">
              Kiện hàng đã được lấy khỏi tủ và đơn đã hoàn tất.
            </p>

            <div className="mt-4 p-3 rounded-2xl bg-slate-50/80 border border-slate-200 text-left space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium">Mã đơn</span>
                <span className="font-mono font-bold text-slate-900">
                  {pickupDoneInfo.orderId || '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium">Ngăn</span>
                <span className="font-bold text-slate-900">
                  {pickupDoneInfo.compartmentIndex != null
                    ? `#${pickupDoneInfo.compartmentIndex}`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium">Thời điểm</span>
                <span className="font-bold text-slate-900">
                  {pickupDoneInfo.at ? pickupDoneInfo.at.toLocaleTimeString('vi-VN') : '—'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setPickupDoneInfo(null)}
              className="mt-5 w-full py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold cursor-pointer transition shadow-md shadow-emerald-600/20 active:scale-95"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {otpModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="liquid-glass-card rounded-[28px] max-w-sm w-full p-6 text-center shadow-2xl relative border border-white/90 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setOtpModalOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-2 border border-emerald-200 shadow-2xs">
              <ShieldCheck className="w-6 h-6" />
            </div>

            <h3 className="text-base font-bold text-slate-900">Mã OTP Mở Khóa Tủ</h3>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Đơn: <strong className="text-slate-900">{otpModalOrder.orderId}</strong>
            </p>

            {(() => {
              const modalStatus = getOtpStatus(otpModalOrder);
              return (
                <div className="my-4 space-y-3.5">
                  {modalStatus.isGenerated && !modalStatus.isExpired ? (
                    <>
                      <div className="bg-slate-50/80 border-2 border-dashed border-blue-300 rounded-2xl p-4 shadow-inner">
                        <div className="font-mono text-3xl font-black text-blue-700 tracking-[0.25em] pl-2">
                          {otpModalOrder.otpCode}
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 font-medium">Nhập 6 số này vào màn hình cảm ứng Kiosk</p>
                      </div>

                      {/* Circular Timer for OTP 5m */}
                      <div className="flex justify-center my-1">
                        <CircularTimer
                          secondsLeft={modalStatus.remainingSeconds}
                          totalSeconds={300}
                          size={70}
                          strokeWidth={5}
                          format="mm:ss"
                          label="Hiệu Lực"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-700 font-bold">
                      Mã OTP đã hết hạn. Vui lòng bấm &quot;Đổi mã mới&quot;.
                    </div>
                  )}

                  <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-3 text-xs text-slate-700 text-left space-y-1">
                    <p><strong>Trạm tủ:</strong> {otpModalOrder.lockerName}</p>
                    {/* GĐ19 — bỏ `({compartmentSize})`: mọi ngăn dùng được như nhau (GĐ18). */}
                    <p><strong>Vị trí:</strong> Ngăn #{otpModalOrder.compartmentIndex}</p>
                    <p className="text-[10px] text-slate-500">Bảo vệ chống dò mã: Khóa 2 phút nếu sai quá 5 lần.</p>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleGenerateOtp(otpModalOrder)}
                      disabled={generatingOtpId === otpModalOrder.orderId}
                      className="ios-btn flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${generatingOtpId === otpModalOrder.orderId ? 'animate-spin text-blue-600' : ''}`} />
                      <span>Đổi mã mới</span>
                    </button>
                    <button
                      onClick={() => handleCopyOtp(otpModalOrder.otpCode)}
                      className="ios-btn flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1 cursor-pointer shadow-sm shadow-emerald-500/20"
                    >
                      {copiedOtp ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedOtp ? 'Đã sao chép' : 'Sao chép'}</span>
                    </button>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => setOtpModalOrder(null)}
              className="ios-btn w-full mt-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {otpToast && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900/95 text-white text-xs px-4 py-3.5 rounded-2xl shadow-2xl border border-slate-700 flex items-center gap-2.5 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{otpToast}</span>
        </div>
      )}
    </div>
  );
}
