import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation } from 'lucide-react';

const escapeHtml = (unsafe) => {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const getLockerStatusInfo = (locker) => {
  // GĐ10 — BẢO TRÌ phải được nhận diện TRƯỚC "mất kết nối" và trước "rỗi/bận".
  //
  // Vì sao cần trạng thái riêng: đây là hai chuyện KHÁC NHAU. `MAINTENANCE` là tủ CỐ TÌNH
  // ngừng phục vụ (admin đã khoá để sửa) — không có gì hỏng, không ai cần đi cứu. Còn
  // "mất kết nối" là tủ ĐANG CHẾT (heartbeat cũ). Nếu vẽ chung một màu đỏ thì admin không
  // phân biệt được "tôi vừa khoá tủ này" với "tủ này vừa hỏng".
  // Màu chọn: xám-xanh (slate/teal) — trung tính, khác hẳn đỏ cảnh báo.
  if (locker.connectionStatus === 'MAINTENANCE' || locker.connection_status === 'MAINTENANCE') {
    return {
      statusKey: 'MAINTENANCE',
      dotColor: '#64748b', // xám xanh: đang bảo trì (cố tình tắt)
      label: 'Bảo trì',
      badgeBg: '#f1f5f9',
      badgeText: '#334155',
      borderColor: '#94a3b8',
      isMaintenance: true,
    };
  }
  const isOffline = locker.status === 'OFFLINE' || locker.connectionStatus === 'OFFLINE' || locker.connection_status === 'OFFLINE';
  if (isOffline) {
    return {
      statusKey: 'OFFLINE',
      dotColor: '#94a3b8', // ⚪ Xám: Mất kết nối
      label: 'Mất kết nối',
      badgeBg: '#f1f5f9',
      badgeText: '#475569',
      borderColor: '#cbd5e1',
    };
  }
  const available = locker.availableCompartments ?? (
    Array.isArray(locker.compartments)
      ? locker.compartments.filter((c) => c.status === 'EMPTY').length
      : 1
  );
  // GĐ12 — TỦ ẢO: giữ nguyên logic sức chứa (Rỗi/Bận) vì đó là thông tin thật của tủ, nhưng
  // nhãn phụ ghi rõ "(tủ ảo)" để không ai tưởng đây là thiết bị đang chạy. Tủ ảo KHÔNG rơi vào
  // nhánh OFFLINE ở trên: nhánh đó dựa `connectionStatus`, mà tủ ảo luôn có 'ONLINE'.
  //
  // ⚠ KHÔNG đổi `statusKey` cho tủ ảo. Bộ lọc của CUSTOMER (`LockerNetworkMapTab:122-124`) so
  // khớp ĐÚNG chuỗi `'AVAILABLE'`/`'FULL'`; đổi thành `'AVAILABLE_VIRTUAL'` từng làm chip "Rỗi"
  // chỉ còn 1 marker (mất cả 9 tủ ảo) và "Mất kết nối" ra 0 — hồi quy thật do GĐ12 gây ra, đã bị
  // `minh` bắt. Tủ ảo khác tủ thật ở NHÃN, không khác ở trạng thái sức chứa.
  const virtualSuffix = locker.isVirtual === true ? ' (tủ ảo)' : '';
  if (available <= 0) {
    return {
      statusKey: 'FULL',
      dotColor: '#ef4444', // 🔴 Đỏ: Hết chỗ
      label: 'Bận (Hết chỗ)' + virtualSuffix,
      badgeBg: '#fef2f2',
      badgeText: '#b91c1c',
      borderColor: '#fca5a5',
    };
  }
  return {
    statusKey: 'AVAILABLE',
    dotColor: '#10b981', // 🟢 Xanh lá: Rỗi (Còn chỗ)
    label: 'Rỗi (Còn chỗ)' + virtualSuffix,
    badgeBg: '#f0fdf4',
    badgeText: '#15803d',
    borderColor: '#86efac',
  };
};

export default function LockerMap({
  lockers = [],
  selectedLockerId,
  onSelectLocker,
  height = '100%',
  minHeight = '320px',
  onActionClick = null,
  actionButtonLabel = 'Xem bưu kiện tại tủ này',
  // GĐ8 — hai prop TUỲ CHỌN cho nhánh ADMIN. Mặc định `undefined` nên nhánh CUSTOMER
  // (checkout) chạy y hệt như trước: không badge, popup giữ nguyên.
  //
  // `getMarkerBadge(locker)` → `{ count, tone } | null`: badge nhỏ trên marker (số đơn quá hạn).
  // `onPopupOpen(locker)` → gọi khi mở popup, để màn ADMIN tải chi tiết theo nhu cầu thay vì
  //   tải sẵn cho cả 10 tủ lúc mở tab.
  getMarkerBadge = undefined,
  onPopupOpen = undefined,
  // GĐ62 — hai prop TUỲ CHỌN cho nhánh KHÁCH (điều cấm #5: không đổi chữ ký các prop cũ).
  //
  // `userPos = { lat, lng } | null`: vị trí khách đã lấy được (chỉ khi họ bấm "Gần tôi").
  //   `null` ⇒ KHÔNG vẽ gì, KHÔNG fitBounds về điểm mặc định (điều cấm #4).
  // `routeInfo = { lockerId, geometry, source, ... } | null`: tuyến tới tủ đang xem, do
  //   `fetchDrivingRoute` trả về ở `LockerNetworkMapTab` — component này KHÔNG tự gọi OSRM
  //   (điều cấm #3).
  //
  // Vì sao phải nhận qua prop thay vì tự tính: trước GĐ62 tab đã có sẵn `userPos`/`routeInfo`
  // nhưng không truyền xuống, nên chữ trên UI đổi (khoảng cách, nhãn "đường đi thực tế") còn
  // bản đồ thì đứng yên — đúng lỗi user báo.
  userPos = null,
  routeInfo = null,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef(new Map());
  // GĐ62 — marker khách và tuyến đường nằm ở hai layer riêng, KHÔNG dùng `markersRef`: layer
  // marker tủ bị xoá/vẽ lại mỗi lần `lockers` đổi, còn vị trí khách thì không được biến mất theo.
  const userLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  // Chỉ `fitBounds` MỘT lần cho mỗi lần có được toạ độ (null → có). Không có cờ này thì mỗi lần
  // danh sách tủ làm mới (bấm "Làm mới") bản đồ lại giật về khung cũ, cướp khung nhìn người dùng.
  const userFitDoneRef = useRef(false);

  // GĐ62 — chữ ký toạ độ của danh sách tủ đang hiện. Dùng làm dependency thay cho mảng `lockers`
  // (mảng mới mỗi lần cha render, kể cả khi toạ độ y hệt) để marker khách không bị vẽ lại liên tục.
  const lockerKey = lockers
    .map((l) => `${l.latitude ?? ''},${l.longitude ?? ''}`)
    .join('|');

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Khởi tạo Leaflet Map nếu chưa có instance
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        scrollWheelZoom: true,
        zoomControl: true,
      }).setView([20.9820, 105.7850], 13);

      // Google Maps Tile Layer: Không cần API key, tốc độ cao, hiển thị rõ ràng đường xá PTIT
      const primaryTileLayer = L.tileLayer(
        'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        {
          subdomains: ['0', '1', '2', '3'],
          attribution: '&copy; Google Maps &mdash; Mạng Lưới Smart Locker PTIT',
          maxZoom: 20,
          crossOrigin: true,
        }
      );

      // Lớp dự phòng OpenStreetMap DE nếu mất mạng
      let hasSwitchedToFallback = false;
      primaryTileLayer.on('tileerror', () => {
        if (!hasSwitchedToFallback) {
          hasSwitchedToFallback = true;
          console.warn('Đang kích hoạt lớp bản đồ dự phòng OpenStreetMap...');
          map.removeLayer(primaryTileLayer);
          L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            subdomains: ['a', 'b', 'c'],
            maxZoom: 19,
          }).addTo(map);
        }
      });

      primaryTileLayer.addTo(map);
      mapInstanceRef.current = map;

      // GĐ62 — hai layer RIÊNG cho vị trí khách và tuyến đường. Tạo một lần ở đây (không tạo
      // trong effect vẽ marker tủ) để chúng không bị xoá khi danh sách tủ làm mới.
      userLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);

      // GĐ62 — thuộc tính ĐO ĐƯỢC: `data-center` + `data-zoom` trên chính container.
      //
      // Vì sao phải có: trước đây không có cách nào biết "bản đồ có đổi khung nhìn hay không"
      // từ bên ngoài — người nghiệm thu chỉ thấy chữ trên UI đổi còn map có thể đứng yên (đúng
      // lỗi GĐ62). Gắn ở `moveend`/`zoomend` (không phải mỗi `move`) để không ghi hàng trăm lần
      // trong lúc `flyTo`/`fitBounds` đang chạy animation.
      const syncViewAttrs = () => {
        const el = mapContainerRef.current;
        if (!el) return;
        const c = map.getCenter();
        el.setAttribute('data-center', `${c.lat.toFixed(3)},${c.lng.toFixed(3)}`);
        el.setAttribute('data-zoom', String(map.getZoom()));
      };
      map.on('moveend zoomend', syncViewAttrs);
      syncViewAttrs();

      // Tự động fitBounds cho mạng lưới phân tán
      if (lockers.length > 0) {
        const validLockers = lockers.filter((l) => (l.latitude || l.lat) && (l.longitude || l.lng));
        if (validLockers.length > 0) {
          const bounds = L.latLngBounds(validLockers.map((l) => [l.latitude || l.lat, l.longitude || l.lng]));
          map.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
        }
      }
    }

    const map = mapInstanceRef.current;

    // Cập nhật lại kích thước hiển thị Leaflet ngay khi container render
    const invalidate = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    };
    requestAnimationFrame(invalidate);
    const timer1 = setTimeout(invalidate, 150);
    const timer2 = setTimeout(invalidate, 500);

    // Xóa markers cũ trước khi render lại
    markersRef.current.forEach((m) => m.remove());
    markersRef.current.clear();

    // Vẽ markers mới với 3 mã màu động: 🟢 Xanh (Rỗi), 🔴 Đỏ (Bận), ⚪ Xám (Mất kết nối)
    lockers.forEach((locker) => {
      if (locker.latitude && locker.longitude) {
        const isSelected = locker.lockerId === selectedLockerId;
        const statusInfo = getLockerStatusInfo(locker);
        const availCount = locker.availableCompartments ?? 0;
        const totalCount = locker.totalCompartments ?? 3;
        // GĐ8 — badge tuỳ chọn (chỉ ADMIN truyền vào). Không truyền → `null` → HTML y hệt cũ.
        const badge = typeof getMarkerBadge === 'function' ? getMarkerBadge(locker) : null;
        const badgeHtml = badge && badge.count > 0
          ? `<span style="
                position: absolute;
                top: -8px;
                right: -8px;
                min-width: 18px;
                height: 18px;
                padding: 0 5px;
                border-radius: 9999px;
                background: ${badge.tone === 'amber' ? '#f59e0b' : '#ef4444'};
                color: #fff;
                font-size: 10px;
                font-weight: 800;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid #fff;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
              ">${badge.count}</span>`
          : '';

        const icon = L.divIcon({
          className: 'custom-leaflet-marker',
          html: `
            <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: pointer;">
              <!-- Pin Container -->
              <div style="
                display: flex;
                align-items: center;
                gap: 6px;
                background: ${isSelected ? '#2563eb' : '#ffffff'};
                color: ${isSelected ? '#ffffff' : '#0f172a'};
                padding: 6px 12px;
                border-radius: 9999px;
                font-weight: 600;
                font-size: 11px;
                font-family: 'Plus Jakarta Sans', sans-serif;
                box-shadow: ${isSelected ? '0 4px 14px rgba(37, 99, 235, 0.45)' : '0 2px 10px rgba(0, 0, 0, 0.15)'};
                border: 2px solid ${isSelected ? '#ffffff' : statusInfo.borderColor};
                white-space: nowrap;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
                transform: ${isSelected ? 'scale(1.08)' : 'scale(1)'};
              ">
                <!-- 3-Color Dynamic Indicator -->
                <span style="
                  width: 9px;
                  height: 9px;
                  border-radius: 9999px;
                  background: ${statusInfo.dotColor};
                  display: inline-block;
                  box-shadow: 0 0 0 2px ${isSelected ? 'rgba(255,255,255,0.6)' : statusInfo.badgeBg};
                "></span>
                <span>${escapeHtml(locker.name || 'Trạm Tủ PTIT')}</span>
                ${statusInfo.isMaintenance ? '<span title="Đang bảo trì" style="font-size:11px;">🔧</span>' : ''}
                <span style="
                  font-size: 10px;
                  font-weight: 600;
                  background: ${isSelected ? 'rgba(255,255,255,0.25)' : statusInfo.badgeBg};
                  padding: 1px 7px;
                  border-radius: 9999px;
                  color: ${isSelected ? '#ffffff' : statusInfo.badgeText};
                ">${availCount} Ngăn</span>
              </div>
              <!-- Pin Point Tail -->
              <div style="
                width: 0;
                height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 6px solid ${isSelected ? '#2563eb' : '#ffffff'};
                margin-top: -1px;
              "></div>
              ${badgeHtml}
            </div>
          `,
          iconSize: [168, 42],
          iconAnchor: [84, 21],
        });

        const marker = L.marker([locker.latitude, locker.longitude], { icon }).addTo(map);

        // Chuẩn hóa Popup chi tiết theo Mục 5.3 Tài liệu Đặc tả
        const popupContent = document.createElement('div');
        popupContent.style.fontFamily = "'Plus Jakarta Sans', sans-serif";
        popupContent.style.padding = '6px';
        popupContent.style.minWidth = '230px';
        popupContent.style.color = '#0f172a';

        popupContent.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
            <span style="font-weight: 700; font-size: 13px; color: #1e293b;">${escapeHtml(locker.name || 'Trạm Tủ PTIT')}</span>
            <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 9999px; background: ${statusInfo.badgeBg}; color: ${statusInfo.badgeText}; border: 1px solid ${statusInfo.borderColor};">
              <span style="width: 6px; height: 6px; border-radius: 9999px; background: ${statusInfo.dotColor};"></span>
              ${statusInfo.label}
            </span>
          </div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 8px; line-height: 1.4;">
            📍 ${escapeHtml(locker.address || 'Học viện CNBCVT, Hà Đông, Hà Nội')}
          </div>
          <div style="background: #f8fafc; border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; font-size: 11px; border: 1px solid #e2e8f0; display: flex; justify-content: space-between;">
            <span>Sức chứa: <b>${availCount} / ${totalCount}</b> ngăn</span>
            <span style="color: #64748b; font-family: monospace;">WGS84: ${locker.latitude.toFixed(4)}, ${locker.longitude.toFixed(4)}</span>
          </div>
          <div style="font-size: 10px; color: #94a3b8; margin-bottom: 10px; display: flex; justify-content: space-between;">
            <span>Mã trạm: <b style="color: #0284c7; font-family: monospace;">${escapeHtml(locker.lockerId)}</b></span>
            <span>Trạng thái: <b>${statusInfo.label}</b></span>
          </div>
        `;

        if (onActionClick) {
          const actionBtn = document.createElement('button');
          actionBtn.style.width = '100%';
          actionBtn.style.padding = '6px 12px';
          actionBtn.style.borderRadius = '6px';
          actionBtn.style.fontSize = '11px';
          actionBtn.style.fontWeight = '600';
          actionBtn.style.background = '#2563eb';
          actionBtn.style.color = '#ffffff';
          actionBtn.style.border = 'none';
          actionBtn.style.cursor = 'pointer';
          actionBtn.style.transition = 'background 0.15s ease';
          actionBtn.innerText = actionButtonLabel;
          actionBtn.onmouseover = () => { actionBtn.style.background = '#1d4ed8'; };
          actionBtn.onmouseout = () => { actionBtn.style.background = '#2563eb'; };
          actionBtn.onclick = () => {
            onActionClick(locker);
          };
          popupContent.appendChild(actionBtn);
        }

        marker.bindPopup(popupContent, { maxWidth: 290, className: 'modern-leaflet-popup' });

        marker.on('click', () => {
          if (onSelectLocker) {
            onSelectLocker(locker.lockerId);
          }
        });

        // GĐ8 — báo cho màn ADMIN biết popup vừa mở, để nó TẢI CHI TIẾT theo nhu cầu
        // (ngăn tủ, 20 lệnh gần nhất). Không truyền `onPopupOpen` → không làm gì, nhánh
        // CUSTOMER giữ nguyên hành vi.
        // Nghe `popupopen` của Leaflet chứ không phải sự kiện `click`, vì popup cũng mở được
        // bằng bàn phím / lập trình — lắng nghe đúng sự kiện sẽ không bỏ sót.
        if (typeof onPopupOpen === 'function') {
          marker.on('popupopen', () => onPopupOpen(locker));
        }

        markersRef.current.set(locker.lockerId, marker);

        if (isSelected) {
          map.flyTo([locker.latitude, locker.longitude], 16, { animate: true, duration: 0.75 });
        }
      }
    });

    // Tự động kích hoạt khi container thay đổi kích thước
    let resizeObserver = null;
    if (window.ResizeObserver && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        invalidate();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
    // GĐ8 — `getMarkerBadge` phải nằm trong dependency: badge (số đơn quá hạn) đổi thì marker
    // phải vẽ lại. `onPopupOpen` thì KHÔNG cần: nó chỉ là callback gắn sự kiện, đổi tham chiếu
    // không làm thay đổi nội dung marker.
  }, [lockers, selectedLockerId, onSelectLocker, onActionClick, actionButtonLabel, getMarkerBadge]);

  /**
   * GĐ62 — VỊ TRÍ KHÁCH trên bản đồ.
   *
   * <p>Chỉ vẽ khi `userPos` có thật (điều cấm #4): `null` ⇒ xoá layer, không `fitBounds` về điểm
   * mặc định. Nhãn "Vị trí của bạn" là `divIcon` (không phải `bindPopup`) để nó luôn hiện, người
   * dùng không phải bấm vào mới thấy — đây chính là thứ trước GĐ62 thiếu.
   *
   * <p>`fitBounds` CHỈ chạy một lần cho mỗi lần có được toạ độ (`userFitDoneRef`), vì effect này
   * còn chạy lại khi danh sách tủ đổi (sắp xếp theo khoảng cách) — nếu `fitBounds` mỗi lần thì
   * bản đồ giật về khung cũ ngay sau khi người dùng vừa kéo bản đồ đi chỗ khác.
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !userLayerRef.current) return;

    const layer = userLayerRef.current;
    layer.clearLayers();

    const lat = Number(userPos?.lat ?? userPos?.latitude);
    const lng = Number(userPos?.lng ?? userPos?.longitude);
    const coViTri = Number.isFinite(lat) && Number.isFinite(lng);

    if (!coViTri) {
      // Mất vị trí (đăng xuất / đổi vai trò) ⇒ dọn marker + cho phép fitBounds lần sau.
      userFitDoneRef.current = false;
      const el = mapContainerRef.current;
      if (el) el.removeAttribute('data-user');
      return;
    }

    L.circleMarker([lat, lng], {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#2563eb', // xanh dương: cùng tông với nút "Gần tôi"
      fillOpacity: 1,
      interactive: false,
    }).addTo(layer);

    L.marker([lat, lng], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'locker-user-marker',
        html: `
          <div style="
            display: flex; align-items: center; gap: 4px;
            transform: translate(12px, -34px);
            background: #2563eb; color: #ffffff;
            padding: 3px 10px; border-radius: 9999px;
            font-size: 11px; font-weight: 700; white-space: nowrap;
            font-family: 'Plus Jakarta Sans', sans-serif;
            box-shadow: 0 2px 10px rgba(37, 99, 235, 0.45);
            border: 2px solid #ffffff;
          ">📍 Vị trí của bạn</div>
        `,
        iconSize: [1, 1],
        iconAnchor: [0, 0],
      }),
    }).addTo(layer);

    // Ghi lại toạ độ đã vẽ để phép nghiệm thu đọc được bằng máy (không phải đoán qua pixel).
    const el = mapContainerRef.current;
    if (el) el.setAttribute('data-user', `${lat.toFixed(3)},${lng.toFixed(3)}`);

    if (!userFitDoneRef.current) {
      const diem = [[lat, lng]];
      lockers.forEach((l) => {
        if (l.latitude && l.longitude) diem.push([l.latitude, l.longitude]);
      });
      if (diem.length > 1) {
        map.fitBounds(L.latLngBounds(diem), { padding: [45, 45], maxZoom: 15 });
      } else {
        map.setView([lat, lng], 15);
      }
      userFitDoneRef.current = true;
    }
    // Phụ thuộc `lockerKey` (chuỗi toạ độ) chứ không phải `lockers`: mảng `filteredLockers` là
    // tham chiếu MỚI mỗi lần cha render, để nguyên thì marker khách bị xoá/vẽ lại liên tục.
  }, [userPos, lockerKey]);

  /**
   * GĐ62 — TUYẾN ĐƯỜNG tới tủ đang xem.
   *
   * <p>`geometry` do `fetchDrivingRoute` trả (đã đổi sang `[lat, lng]` cho Leaflet) — component này
   * KHÔNG tự dựng URL/không gọi OSRM lần 2 (điều cấm #3); `source` chỉ dùng để chọn nét vẽ.
   *
   * <p>Mỗi lần `routeInfo` đổi, layer bị `clearLayers()` TRƯỚC khi vẽ ⇒ tuyến của tủ cũ biến mất,
   * không bao giờ chồng 2 tuyến (phép thử (3)).
   */
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !routeLayerRef.current) return;

    const layer = routeLayerRef.current;
    layer.clearLayers();

    const geometry = Array.isArray(routeInfo?.geometry) ? routeInfo.geometry : [];
    const diem = geometry
      .map((pt) => [Number(pt?.[0]), Number(pt?.[1])])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    if (diem.length < 2) return;

    const laOsrm = routeInfo?.source === 'osrm';
    L.polyline(diem, {
      // Nét liền xanh khi là tuyến lái xe THẬT; nét đứt amber khi chỉ là "chim bay" — màu/nét nói
      // đúng độ tin cậy, khớp nhãn chữ trong thẻ tủ.
      color: laOsrm ? '#2563eb' : '#f59e0b',
      weight: 5,
      opacity: 0.9,
      dashArray: laOsrm ? undefined : '8 8',
      lineJoin: 'round',
    }).addTo(layer);

    // Khung nhìn theo tuyến để người dùng thấy cả đường đi lẫn hai đầu.
    map.fitBounds(L.latLngBounds(diem), { padding: [0.2, 0.2] });
  }, [routeInfo]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleCenterMap = () => {
    if (mapInstanceRef.current) {
      const validLockers = lockers.filter((l) => (l.latitude || l.lat) && (l.longitude || l.lng));
      if (validLockers.length > 0) {
        const bounds = L.latLngBounds(validLockers.map((l) => [l.latitude || l.lat, l.longitude || l.lng]));
        mapInstanceRef.current.fitBounds(bounds, { padding: [45, 45], maxZoom: 15 });
      } else {
        mapInstanceRef.current.setView([20.9820, 105.7850], 13, { animate: true });
      }
    }
  };

  return (
    <div
      className="relative w-full rounded-3xl overflow-hidden border border-white/90 shadow-xl bg-slate-100"
      style={{ height, minHeight }}
    >
      <div
        ref={mapContainerRef}
        data-testid="locker-map"
        className="w-full h-full"
        style={{ minHeight, zIndex: 1 }}
      />

      {/* Station Location Info Badge (Liquid Glass) */}
      <div className="absolute top-3 left-3 z-[400] liquid-glass-card border border-white/90 px-3.5 py-2 rounded-2xl text-xs font-mono font-semibold text-slate-800 flex items-center gap-2 shadow-lg pointer-events-none">
        <MapPin className="w-4 h-4 text-blue-600" />
        <span>Bản đồ số GIS Mạng lưới Tủ PTIT (WGS84)</span>
      </div>

      {/* Recenter Button (iOS Pill Button) */}
      <button
        onClick={handleCenterMap}
        className="ios-btn absolute top-3 right-3 z-[400] liquid-glass-card hover:bg-white border border-white/90 px-3.5 py-2 rounded-2xl text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-lg transition cursor-pointer active:scale-95"
        title="Về trung tâm Học viện"
      >
        <Navigation className="w-3.5 h-3.5 text-blue-600" />
        <span className="hidden sm:inline">Về trung tâm</span>
      </button>

      {/* Legend Badge (Chú giải 3 màu Apple Capsule) */}
      <div className="absolute bottom-3 left-3 z-[400] liquid-glass-card border border-white/90 px-4 py-2.5 rounded-2xl text-[11px] font-medium text-slate-700 flex items-center gap-3.5 shadow-lg pointer-events-none">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shadow-xs shadow-emerald-500/50"></span>
          <span className="font-semibold text-slate-800">Rỗi (Còn chỗ)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block shadow-xs shadow-red-500/50"></span>
          <span className="font-semibold text-slate-800">Bận (Hết chỗ)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block"></span>
          <span className="font-semibold text-slate-600">Mất kết nối</span>
        </span>
      </div>
    </div>
  );
}
