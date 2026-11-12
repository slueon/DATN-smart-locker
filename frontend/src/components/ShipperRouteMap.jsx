import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { lockerApi, shipperApi } from '../services/api';
// GĐ14 — lộ trình lái xe THẬT từ OSRM; lỗi thì fallback Haversine kèm nhãn cảnh báo.
import { fetchDrivingRoute } from '../services/routingApi';
import {
  MapPin, Navigation, RefreshCw, AlertTriangle, Package,
  Crosshair, Route, CheckCircle2, XCircle, Clock, ExternalLink
} from 'lucide-react';

/**
 * GĐ6 — BẢN ĐỒ LỘ TRÌNH CHO SHIPPER.
 *
 * <p><b>Vì sao tạo component riêng thay vì dùng `LockerNetworkMapTab`:</b> tab đó được thiết kế
 * cho ADMIN — hiển thị mật độ ngăn, KPI, ma trận tủ. Shipper cần thứ khác hẳn: "hôm nay tôi phải
 * giao những tủ nào, đi theo thứ tự nào, tủ nào đang hỏng để đừng đến". Dùng chung sẽ phải nhồi
 * thêm cờ `role` vào một file đang phục vụ 2 màn hình, dễ làm hỏng màn của admin.
 *
 * <p><b>KHÔNG sửa `LockerMap.jsx`</b>: file đó dùng chung với luồng checkout của khách — sửa vào
 * là ảnh hưởng việc đặt hàng. Component này tự dựng Leaflet bằng `useRef` như `LockerMap` làm,
 * nhưng không chia sẻ state/logic với nó.
 */

const DEFAULT_START = {
  // Toạ độ LOCKER_HN_01 (KTX A1 / trụ sở PTIT) — dùng làm điểm xuất phát dự phòng.
  lat: 20.9808,
  lng: 105.7876,
  label: 'KTX A1 (Trụ sở PTIT)',
};

/** Ngưỡng tuổi nhịp tim — giống `AdminTab.getLockerHealth` để hai màn hình nói cùng một ngôn ngữ. */
const HEARTBEAT_FRESH_MS = 5 * 60 * 1000;
const HEARTBEAT_STALE_MS = 60 * 60 * 1000;

/** Bán kính Trái Đất (km) cho công thức Haversine. */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Khoảng cách mặt cầu giữa hai toạ độ, đơn vị **km**.
 *
 * <p>Dùng Haversine (mặt cầu) chứ không phải khoảng cách Euclid trên độ: 1 độ vĩ độ ≈ 111 km
 * nhưng 1 độ kinh độ ở Hà Nội chỉ ≈ 104 km. Euclid sẽ làm sai thứ tự khi các tủ lệch chủ yếu
 * theo chiều đông–tây.
 */
const haversineKm = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

/**
 * Lộ trình tham lam "nearest-neighbour": luôn đi tới tủ gần nhất chưa thăm.
 *
 * <p><b>Vì sao không dùng TSP:</b> TSP tối ưu cho bài toán đóng (quay về điểm đầu) và cần thuật
 * toán nặng hơn (2^n hoặc heuristic). Shipper chỉ cần một thứ tự hợp lý và giải thích được —
 * greedy cho kết quả tối đa 25% dài hơn tối ưu với dữ liệu dạng điểm trên mặt phẳng, đủ tốt cho
 * 2–10 tủ, và quan trọng hơn: shipper nhìn 2 tủ gần nhau là hiểu ngay vì sao đi tủ đó trước.
 *
 * @returns mảng điểm đến đã sắp, mỗi phần tử có thêm `legKm` (chặng) và `cumKm` (tích luỹ)
 */
const buildGreedyRoute = (start, stops) => {
  const unvisited = [...stops];
  const route = [];
  let cursor = start;
  let cumulative = 0;

  while (unvisited.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    unvisited.forEach((stop, idx) => {
      const d = haversineKm(cursor, stop);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    const next = unvisited.splice(bestIdx, 1)[0];
    cumulative += bestDist;
    route.push({
      ...next,
      legKm: Number(bestDist.toFixed(1)),
      cumKm: Number(cumulative.toFixed(1)),
    });
    // Đi tiếp từ tủ vừa tới: greedy đo từ điểm hiện tại, không đo lại từ điểm xuất phát.
    cursor = next;
  }
  return route;
};

/**
 * Trạng thái kết nối — **không** dùng `connectionStatus`.
 *
 * <p>Lý do: backend cập nhật cột `connection_status` khi có bản tin MQTT nhưng KHÔNG có scheduler
 * chuyển sang OFFLINE khi tủ im lặng. Đo thật ngày 10/11: cả 10 tủ ghi `ONLINE`, trong khi
 * HN_02 im 17 giờ, HN_04–10 im 3 ngày. Tin cột đó là shipper đi giao vào tủ đã tắt nguồn.
 *
 * <p>GĐ12 — có thêm loại TỦ ẢO: khai báo CSDL, không có thiết bị gửi nhịp tim nên không bao giờ
 * có `lastHeartbeat`. Nhánh này đặt TRƯỚC mọi nhánh dựa trên `ageMs`, hành vi giống hệt
 * `utils/lockerHealth.js` (file tự khai báo để không phụ thuộc, nhưng phải nói cùng một ngôn ngữ).
 * Tủ thật vẫn theo dõi thật: im quá ngưỡng là đỏ.
 */
const getLockerHealth = (locker) => {
  const hb = locker?.lastHeartbeat ? new Date(locker.lastHeartbeat).getTime() : null;
  const ageMs = hb != null && !Number.isNaN(hb) ? Date.now() - hb : null;

  if (locker?.isVirtual === true) {
    return { key: 'VIRTUAL', label: 'Online (tủ ảo)', tone: 'emerald', ageMs };
  }
  if (ageMs == null) return { key: 'NEVER', label: 'Chưa có tín hiệu', tone: 'rose', ageMs };
  if (ageMs > HEARTBEAT_STALE_MS) return { key: 'STALE', label: 'Mất kết nối', tone: 'rose', ageMs };
  if (ageMs > HEARTBEAT_FRESH_MS) return { key: 'UNKNOWN', label: 'Không rõ', tone: 'amber', ageMs };
  return { key: 'ONLINE', label: 'Online', tone: 'emerald', ageMs };
};

const formatAge = (ageMs) => {
  if (ageMs == null) return 'chưa từng gửi';
  const min = Math.round(ageMs / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  return `${Math.round(hr / 24)} ngày trước`;
};

const TONE_COLOR = {
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#ef4444',
};

const TONE_BADGE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-300',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function ShipperRouteMap({ currentUser }) {
  const [route, setRoute] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // GĐ14 — dữ liệu lộ trình THẬT từ OSRM (nếu lấy được).
  //
  // `routeGeometry`: mảng [lat,lng] men theo đường (nhiều điểm gấp khúc). `null` = đang dùng
  // Haversine → vẽ nối thẳng và hiện nhãn vàng cảnh báo.
  // `routeMeta`: `{ source, totalKm, durationMin }` — nguồn của con số đang hiển thị.
  const [routeGeometry, setRouteGeometry] = useState(null);
  const [routeMeta, setRouteMeta] = useState({ source: 'haversine', totalKm: 0, durationMin: null });
  const [routingError, setRoutingError] = useState(null);
  /** GĐ14 — số hiệu lượt tải; lượt cũ về muộn không được ghi đè lượt mới. */
  const loadRunIdRef = useRef(0);
  const [start, setStart] = useState(DEFAULT_START);
  const [usingMyLocation, setUsingMyLocation] = useState(false);
  const [geoStatus, setGeoStatus] = useState('idle'); // 'idle' | 'asking' | 'ok' | 'error'
  const [selectedLockerId, setSelectedLockerId] = useState(null);
  const [selectedCompartments, setSelectedCompartments] = useState([]);
  const [loadingCompartments, setLoadingCompartments] = useState(false);

  // GĐ6 — lưới an toàn cho nút "Tải lại": `loading` khởi tạo `true` (đang tải lúc mount) và nút
  // bị `disabled={loading}`. Nếu `loadRoute` không chạy tới `finally` (unmount giữa lúc await,
  // hoặc effect mount hỏng), nút sẽ kẹt khoá vĩnh viễn và người dùng không còn cách nào tải dữ
  // liệu. Hẹn giờ mở khoá sau 10 giây để luôn có đường thoát.
  useEffect(() => {
    const guard = setTimeout(() => setLoading(false), 10000);
    return () => clearTimeout(guard);
  }, []);

  const mapRef = useRef(null);
  const mapObjRef = useRef(null);
  const layersRef = useRef([]);

  /* ─────────────────────── 1. Tải dữ liệu ─────────────────────── */

  const loadRoute = async () => {
    setLoading(true);
    setErrorMsg(null);
    // GĐ14 — xoá lỗi OSRM của lần trước, nếu không nhãn vàng sẽ giữ lý do cũ dù lần này thành công.
    setRoutingError(null);

    // GĐ14 — CHỐNG RACE. `loadRoute` được gọi từ effect mount và từ nút "Tải lại"; hai lần chạy
    // song song thì lần về SAU ghi đè lần về trước, có thể trộn `route` của lần này với `routeMeta`
    // của lần kia. Đã bắt được lỗi thật do việc này: nhãn "chim bay" nhưng số là của OSRM.
    // Mỗi lượt lấy một số hiệu; chỉ lượt MỚI NHẤT được ghi state.
    const runId = ++loadRunIdRef.current;
    try {
      // Gọi SONG SONG: danh sách đơn chờ nạp + danh sách tủ (để lấy toạ độ/tên/nhịp tim).
      // Không tuần tự vì hai nguồn độc lập nhau, tuần tự chỉ làm chậm thêm.
      const [ordersRes, lockersRes] = await Promise.all([
        shipperApi.getPendingOrders(null),
        lockerApi.getAll(),
      ]);

      const orders = ordersRes?.data?.data || [];
      const lockers = lockersRes?.data?.data || [];
      const lockerMap = new Map(lockers.map((l) => [l.lockerId, l]));

      // Gom theo tủ: một tủ có thể có nhiều đơn chờ nạp nhưng chỉ ghé MỘT lần.
      // Đếm số đơn để shipper biết mỗi trạm phải nạp bao nhiêu kiện.
      const byLocker = new Map();
      orders.forEach((o) => {
        if (!o.lockerId) return;
        if (!byLocker.has(o.lockerId)) byLocker.set(o.lockerId, { count: 0, orderIds: [] });
        const agg = byLocker.get(o.lockerId);
        agg.count += 1;
        agg.orderIds.push(o.orderId);
      });

      const stops = [];
      byLocker.forEach((agg, lockerId) => {
        const locker = lockerMap.get(lockerId);
        if (!locker || locker.latitude == null || locker.longitude == null) return; // thiếu toạ độ thì không vẽ
        stops.push({
          lockerId,
          name: locker.name,
          address: locker.address,
          lat: Number(locker.latitude),
          lng: Number(locker.longitude),
          lastHeartbeat: locker.lastHeartbeat,
          // GĐ12 — PHẢI chép cờ này xuống.
          //
          // `stops` là bản sao rút gọn của locker (không giữ nguyên object), nên mọi field không
          // chép sẽ thành `undefined` khi `getLockerHealth(stop)` đọc. Thiếu dòng này thì tủ ảo
          // rơi về nhánh suy theo nhịp tim → popup ghi "Mất kết nối" và dòng đếm trên đầu trang
          // báo "N tủ mất kết nối" trong khi thực tế chỉ có tủ thật cần theo dõi.
          isVirtual: locker.isVirtual === true,
          orderCount: agg.count,
          orderIds: agg.orderIds,
        });
      });

      // ─── GĐ14: LẤY LỘ TRÌNH THẬT TỪ OSRM ───
      //
      // Thứ tự ghé tủ vẫn do `buildGreedyRoute` (Haversine) quyết định — CHỈ số km và hình
      // polyline đổi sang dữ liệu OSRM. Lý do chọn cách này (không gọi OSRM 2 lần):
      //   • Gọi 1 lần với thứ tự Haversine đã "đủ tốt" (greedy tối đa 25% dài hơn tối ưu).
      //   • Gọi 2 lần (một để đo, một cho thứ tự cuối) làm tăng gấp đôi độ trễ và gấp đôi điểm lỗi
      //     trên một dịch vụ công cộng, trong khi lợi ích với 2–10 tủ là không đáng.
      //   Muốn thứ tự cũng tối ưu theo OSRM thì đó là việc riêng (bài toán TSP trên ma trận thật).
      const greedyRoute = buildGreedyRoute(
        { lat: start.lat, lng: start.lng },
        stops
      );

      let osrm = null;
      // Không gọi OSRM khi không có tủ nào (request vô ích) — nhưng VẪN gọi khi chỉ có 1 tủ,
      // vì shipper cần số km thật của chặng từ điểm xuất phát tới tủ đó.
      if (greedyRoute.length > 0) {
        try {
          osrm = await fetchDrivingRoute([
            { lat: start.lat, lng: start.lng },
            ...greedyRoute.map((s) => ({ lat: s.lat, lng: s.lng })),
          ]);
        } catch (osrmErr) {
          // KHÔNG ném tiếp: rơi xuống Haversine + nhãn vàng. Bản đồ phải luôn có dữ liệu.
          console.warn('[ShipperRouteMap] OSRM không khả dụng, dùng Haversine:', osrmErr?.message);
          setRoutingError(osrmErr?.message || 'Không lấy được lộ trình thật.');
        }
      }

      // GĐ14 — lượt cũ về muộn thì BỎ, không ghi state (xem `loadRunIdRef`).
      // Kiểm ngay trước khi ghi, sau mọi `await` — đó là chỗ race thật sự xảy ra.
      if (runId !== loadRunIdRef.current) return;

      if (osrm) {
        // Số km từng chặng lấy từ `legs` thật; cộng dồn để có `cumKm`.
        let cumulative = 0;
        const withRealKm = greedyRoute.map((stop, i) => {
          const legKm = osrm.legs?.[i]?.distanceKm ?? stop.legKm;
          cumulative += legKm;
          return {
            ...stop,
            // `legKm`/`cumKm` là số ĐƯỜNG ĐI THẬT, không còn là chim bay.
            legKm: Math.round(legKm * 10) / 10,
            cumKm: Math.round(cumulative * 10) / 10,
          };
        });
        setRoute(withRealKm);
        setRouteGeometry(osrm.geometry);
        setRouteMeta({
          source: 'osrm',
          totalKm: osrm.distanceKm,
          durationMin: osrm.durationMin,
        });
      } else {
        // FALLBACK: dùng đúng tổng Haversine của greedy route, và `source: 'haversine'` để UI hiện
        // nhãn VÀNG "đường chim bay". Tổng tính bằng cách cộng `legKm` của chính mảng sắp xếp —
        // KHÔNG đọc `greedyRoute[last].cumKm` rồi trộn với meta của lượt khác.
        const havTotal = greedyRoute.reduce((sum, s) => sum + (Number(s.legKm) || 0), 0);
        setRoute(greedyRoute);
        setRouteGeometry(null);
        setRouteMeta({
          source: 'haversine',
          totalKm: Math.round(havTotal * 10) / 10,
          durationMin: null,
        });
      }
    } catch (err) {
      if (runId !== loadRunIdRef.current) return;
      setErrorMsg(
        err?.response?.data?.message
          || 'Không tải được lộ trình. Kiểm tra đã đăng nhập SHIPPER và backend đang chạy.'
      );
      setRoute([]);
      setRouteGeometry(null);
      setRouteMeta({ source: 'haversine', totalKm: 0, durationMin: null });
    } finally {
      if (runId === loadRunIdRef.current) setLoading(false);
    }
  };

  /**
   * GĐ6 — tải lộ trình NGAY khi mở tab.
   *
   * <p>Thiếu effect này là lỗi chặn: `loadRoute` chỉ được gắn vào `onClick` của nút "Tải lại",
   * nên mở tab ra sẽ thấy "0 trạm · Tổng 0.0 km · Đang tải lộ trình…" vĩnh viễn — màn hình như
   * đang tải mãi mà thực ra chưa hề gọi API nào.
   *
   * <p>Phụ thuộc `[start]`: đổi điểm xuất phát (bấm "Dùng vị trí của tôi") thì thứ tự gần-nhất
   * phải tính lại từ điểm mới. `loadRoute` không đưa vào dependency vì nó được khai báo lại mỗi
   * lần render (không bọc `useCallback`) → thêm vào sẽ thành vòng lặp gọi API vô hạn.
   */
  useEffect(() => {
    loadRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  /* ─────────────────── 2. Vẽ bản đồ + marker ─────────────────── */

  useEffect(() => {
    // Chỉ khởi tạo Leaflet một lần; dữ liệu thay đổi thì vẽ lại lớp marker bên dưới.
    if (!mapRef.current || mapObjRef.current) return undefined;

    const map = L.map(mapRef.current, {
      center: [DEFAULT_START.lat, DEFAULT_START.lng],
      zoom: 13,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    mapObjRef.current = map;

    // Bắt buộc: Leaflet đo kích thước container lúc khởi tạo. Trong SPA, container có thể
    // chưa có kích thước thật → bản đồ hiện xám. Gọi invalidateSize sau khi layout xong.
    //
    // LỖI THẬT ĐÃ SỬA (11/11 14:20): chỉ dùng `setTimeout(invalidateSize, 200)` MỘT LẦN là
    // không đủ. Ảnh chụp thực tế cho thấy bản đồ chỉ tải được vài tile ở góc trên-trái, phần
    // còn lại trắng, còn polyline vẫn vẽ ra ngoài vùng tile đã tải.
    //
    // Nguyên nhân: `L.map()` chạy khi Tailwind `grid-cols-12` + `liquid-glass-card` CHƯA
    // layout xong → Leaflet đo được khung nhỏ, tính số tile theo khung đó. 200ms sau container
    // đã phình ra thật nhưng KHÔNG ai gọi `invalidateSize` nữa nên Leaflet không biết cần tải
    // thêm tile. `fitBounds()` thì tính đúng toạ độ (nên polyline đúng), chỉ tile là thiếu.
    //
    // `LockerMap.jsx` không bị lỗi này vì nó dùng `ResizeObserver` (dòng 331-343). Bản này
    // viết sau nên thiếu. Nay dùng CẢ HAI: ResizeObserver cho mọi thay đổi layout về sau, và
    // setTimeout làm lưới an toàn cho trình duyệt cũ không có ResizeObserver.
    setTimeout(() => map.invalidateSize(), 200);

    let resizeObserver = null;
    if (window.ResizeObserver && mapRef.current) {
      resizeObserver = new ResizeObserver(() => map.invalidateSize());
      resizeObserver.observe(mapRef.current);
    }

    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (resizeObserver) resizeObserver.disconnect();
      layersRef.current.forEach((l) => map.removeLayer(l));
      layersRef.current = [];
      map.remove();
      mapObjRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapObjRef.current;
    if (!map) return;

    // Xoá lớp cũ trước khi vẽ lại, nếu không mỗi lần load sẽ chồng marker lên nhau.
    layersRef.current.forEach((l) => map.removeLayer(l));
    layersRef.current = [];

    // Điểm xuất phát — vòng tròn xanh để phân biệt với các tủ (marker số).
    const startMarker = L.circleMarker([start.lat, start.lng], {
      radius: 8,
      color: '#1d4ed8',
      fillColor: '#3b82f6',
      fillOpacity: 0.9,
      weight: 2,
    })
      .addTo(map)
      .bindPopup(`<b>Điểm xuất phát</b><br/>${start.label}`);
    layersRef.current.push(startMarker);

    if (route.length === 0) {
      map.setView([start.lat, start.lng], 13);
      return;
    }

    // GĐ14 — Đường nối.
    //
    // Có `routeGeometry` từ OSRM → vẽ đúng đường lái xe (hàng chục điểm gấp khúc, men theo phố).
    // Không có (fallback) → nối thẳng toạ độ như cũ và để UI hiện nhãn vàng "đường chim bay":
    // một đường thẳng tắp cộng với nhãn cảnh báo là trung thực; đường thẳng mà không nói gì mới
    // là thứ user vừa báo lỗi.
    const usingRealGeometry = Array.isArray(routeGeometry) && routeGeometry.length > 2;
    const pts = usingRealGeometry
      ? routeGeometry
      : [[start.lat, start.lng], ...route.map((r) => [r.lat, r.lng])];
    const polyline = L.polyline(pts, {
      color: usingRealGeometry ? '#2563eb' : '#d97706',
      weight: 4,
      opacity: 0.85,
      // Nét đứt chỉ dùng cho đường ước lượng — để nhìn là biết không phải đường thật.
      dashArray: usingRealGeometry ? null : '6 8',
    }).addTo(map);
    layersRef.current.push(polyline);

    // Marker đánh số thứ tự 1,2,3… Màu theo trạng thái kết nối thật của tủ.
    route.forEach((stop, idx) => {
      const health = getLockerHealth(stop);
      const color = TONE_COLOR[health.tone] || '#64748b';
      const warn = health.tone === 'rose' ? '⚠ ' : '';
      const icon = L.divIcon({
        className: 'shipper-route-marker',
        html: `<div style="
            background:${color};color:#fff;width:28px;height:28px;border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;
            border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);">
            <span style="transform:rotate(45deg);font-weight:800;font-size:13px;">${idx + 1}</span>
          </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const marker = L.marker([stop.lat, stop.lng], { icon })
        .addTo(map)
        .bindPopup(
          `<div style="min-width:170px">
             <b>${idx + 1}. ${stop.name}</b><br/>
             <span style="color:#475569;font-size:11px">${stop.lockerId}</span><br/>
             <span style="color:${color};font-weight:700;font-size:11px">${warn}${health.label} · ${formatAge(health.ageMs)}</span><br/>
             <span style="font-size:11px">${stop.orderCount} kiện cần nạp · chặng ${stop.legKm} km</span>
           </div>`
        );
      marker.on('click', () => setSelectedLockerId(stop.lockerId));
      layersRef.current.push(marker);
    });

    // Thu khung nhìn vừa đủ lộ trình thay vì cố định zoom, để tủ xa nhất vẫn thấy được.
    map.fitBounds(L.latLngBounds(pts).pad(0.2));
    // `fitBounds` đổi khung nhìn nhưng KHÔNG tự đo lại container. Nếu container vừa đổi kích
    // thước trong cùng nhịp layout, Leaflet vẫn dùng khung cũ để chọn tile → thiếu tile.
    // Gọi `invalidateSize` ngay sau đó để nó tính lại theo kích thước thật rồi mới nạp tile.
    map.invalidateSize();
    // `start` đổi thì phải vẽ lại (điểm xuất phát khác → thứ tự đi khác).
  }, [route, start, routeGeometry]);

  /* ─────────────── 3. Sức chứa của tủ đang chọn ─────────────── */

  useEffect(() => {
    if (!selectedLockerId) {
      setSelectedCompartments([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingCompartments(true);
    (async () => {
      try {
        const res = await lockerApi.getCompartments(selectedLockerId);
        if (!cancelled) setSelectedCompartments(res?.data?.data || []);
      } catch {
        if (!cancelled) setSelectedCompartments([]);
      } finally {
        if (!cancelled) setLoadingCompartments(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLockerId]);

  /* ─────────────── 4. Vị trí xuất phát ─────────────── */

  /**
   * KHÔNG gọi geolocation tự động khi mở tab: trình duyệt sẽ hiện hộp thoại xin quyền và treo
   * chờ người dùng bấm. Nếu họ không bấm (hoặc đang demo qua IP LAN nơi geolocation bị chặn),
   * tab trông như "đang tải mãi". Vì vậy chỉ chạy khi bấm nút, và luôn có fallback.
   */
  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('error');
      setErrorMsg('Trình duyệt không hỗ trợ định vị. Đang tính từ KTX A1.');
      setStart(DEFAULT_START);
      setUsingMyLocation(false);
      return;
    }
    setGeoStatus('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStart({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Vị trí hiện tại của bạn',
        });
        setUsingMyLocation(true);
        setGeoStatus('ok');
        setErrorMsg(null);
      },
      () => {
        // Bị từ chối / không lấy được: quay về KTX A1 và nói rõ cho shipper biết.
        // `timeout: 3000` bên dưới giới hạn thời gian chờ đúng như yêu cầu.
        setStart(DEFAULT_START);
        setUsingMyLocation(false);
        setGeoStatus('error');
        setErrorMsg('Không lấy được vị trí của bạn. Đang tính từ KTX A1.');
      },
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
    );
  };

  // GĐ14 — tổng km và đơn vị đo phải đi CÙNG NHAU, không được tách rời.
  //
  // `routeMeta.source`: 'osrm' = số liệu đường đi thật; 'haversine' = ước lượng chim bay.
  // Tuyệt đối không hiện số Haversine mà thiếu nhãn cảnh báo — đó chính là lỗi user vừa báo
  // ("lộ trình đang vẽ đường chim bay" mà không ai nói cho họ biết).
  // GĐ14 — tổng km LUÔN lấy từ `routeMeta.totalKm`, không đọc lại `route[last].cumKm`.
  //
  // Vì sao: `route` và `routeMeta` là hai state riêng, nên có thể lệch nhau một nhịp render (hoặc
  // lệch hẳn nếu hai lần `loadRoute` chạy song song ghi đè nhau). Đã bắt được lỗi thật: nhãn ghi
  // "đường chim bay" nhưng số lại là 7,6 km của OSRM trong khi Haversine đúng phải là 3,3 km —
  // tức con số và nhãn nguồn nói hai chuyện khác nhau, đúng loại lỗi user vừa báo.
  // Một nguồn duy nhất (`routeMeta.totalKm`) được set cùng lúc với nhãn ⇒ không thể lệch.
  const isRealRoute = routeMeta.source === 'osrm';
  const totalKm = routeMeta.totalKm;
  const totalLabel = isRealRoute
    ? `Tổng ${totalKm.toFixed(1).replace('.', ',')} km đường đi thực tế`
    : `Tổng ${totalKm.toFixed(1).replace('.', ',')} km đường chim bay (không lấy được lộ trình thật)`;

  /** Tủ mất kết nối phải nổi bật trong panel để shipper biết đừng đến. */
  const disconnectedCount = useMemo(
    () => route.filter((r) => getLockerHealth(r).tone === 'rose').length,
    [route]
  );

  const selectedStop = route.find((r) => r.lockerId === selectedLockerId) || null;

  return (
    <div className="space-y-4">
      {/* Thanh điều khiển */}
      <div className="liquid-glass-card rounded-3xl border border-white/90 p-4 sm:p-5 shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Route className="w-4 h-4 text-blue-600" />
              Lộ trình giao hàng hôm nay ({route.length} trạm)
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Thứ tự đi theo tủ gần nhất (nearest-neighbour) ·{' '}
              <strong className={isRealRoute ? 'text-slate-800' : 'text-amber-600'}>
                {totalLabel}
              </strong>
              {/* GĐ14 — thời gian lái xe ước tính chỉ có khi OSRM trả về; fallback thì KHÔNG bịa. */}
              {isRealRoute && routeMeta.durationMin != null && (
                <span className="ml-1 text-slate-500 font-medium">· ~{routeMeta.durationMin} phút</span>
              )}
            </p>
            {!isRealRoute && route.length > 0 && (
              <p className="text-[10px] text-amber-700 mt-0.5">
                {routingError ? `Lỗi lộ trình: ${routingError}` : 'Chưa lấy được lộ trình thật.'}
                {' '}Số km và đường vẽ là ước lượng thẳng — đừng dùng để tính giờ hẹn.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={useMyLocation}
              disabled={geoStatus === 'asking'}
              className="text-[11px] font-bold px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <Crosshair className="w-3.5 h-3.5" />
              {geoStatus === 'asking' ? 'Đang định vị…' : 'Dùng vị trí của tôi'}
            </button>
            <button
              type="button"
              onClick={loadRoute}
              disabled={loading}
              className="text-[11px] font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Tải lại
            </button>
          </div>
        </div>

        {/* Nhắc rõ đang tính từ đâu — shipper phải biết con số km dựa trên giả định nào. */}
        {!usingMyLocation && (
          <p className="text-[11px] text-amber-700 mt-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Đang tính từ {DEFAULT_START.label} (chưa có vị trí của bạn)
          </p>
        )}
        {usingMyLocation && (
          <p className="text-[11px] text-emerald-700 mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Đang tính từ vị trí hiện tại của bạn
          </p>
        )}

        {disconnectedCount > 0 && (
          <p className="text-[11px] text-rose-700 mt-1 flex items-center gap-1.5 font-semibold">
            <XCircle className="w-3.5 h-3.5" />
            {disconnectedCount} tủ mất kết nối — kiểm tra trước khi đến
          </p>
        )}

        {errorMsg && (
          <p className="text-[11px] text-rose-700 mt-2">{errorMsg}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Bản đồ */}
        <div className="lg:col-span-7 liquid-glass-card rounded-3xl border border-white/90 p-3 shadow-md">
          <div ref={mapRef} style={{ height: '460px', width: '100%', borderRadius: '18px' }} />
        </div>

        {/* Panel lộ trình */}
        <div className="lg:col-span-5 space-y-3">
          <div className="liquid-glass-card rounded-3xl border border-white/90 p-4 shadow-md space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
              Thứ tự giao hàng
            </span>

            {loading && (
              <p className="text-[11px] text-slate-500 italic py-4">Đang tải lộ trình…</p>
            )}

            {!loading && route.length === 0 && (
              <div className="py-6 text-center">
                <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500">Hôm nay không còn đơn nào cần nạp.</p>
              </div>
            )}

            {!loading && route.map((stop, idx) => {
              const health = getLockerHealth(stop);
              const isSelected = selectedLockerId === stop.lockerId;
              return (
                <button
                  key={stop.lockerId}
                  type="button"
                  onClick={() => setSelectedLockerId(stop.lockerId)}
                  className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50/70 ring-2 ring-blue-300/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="shrink-0 w-6 h-6 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                      style={{ background: TONE_COLOR[health.tone] || '#64748b' }}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-800 truncate">
                          {stop.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {stop.legKm.toFixed(1)} km
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${TONE_BADGE[health.tone]}`}>
                          {health.tone === 'rose' ? 'MẤT KẾT NỐI' : health.label} · {formatAge(health.ageMs)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          Σ {stop.cumKm.toFixed(1)} km
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[10px] text-slate-500">
                          <Package className="w-3 h-3 inline mr-0.5" />
                          {stop.orderCount} kiện
                        </span>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-0.5"
                        >
                          <Navigation className="w-3 h-3" />
                          Chỉ đường
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Sức chứa của tủ đang chọn */}
          {selectedStop && (
            <div className="liquid-glass-card rounded-3xl border border-white/90 p-4 shadow-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Ngăn của {selectedStop.lockerId}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedLockerId(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Đóng
                </button>
              </div>
              {loadingCompartments ? (
                <p className="text-[11px] text-slate-500 italic">Đang tải…</p>
              ) : selectedCompartments.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic">Không đọc được danh sách ngăn.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCompartments.map((c) => {
                      const st = String(c.status || '').toUpperCase();
                      const cls =
                        st === 'EMPTY'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : st === 'OCCUPIED'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : st === 'RESERVED'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-300';
                      return (
                        <span
                          key={c.compartmentId ?? c.compIndex}
                          className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${cls}`}
                        >
                          #{c.compIndex} · {c.size} · {st || 'N/A'}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Còn{' '}
                    <strong className="text-emerald-700">
                      {selectedCompartments.filter((c) => String(c.status).toUpperCase() === 'EMPTY').length}
                    </strong>
                    /{selectedCompartments.length} ngăn trống
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
