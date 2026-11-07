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
  if (available <= 0) {
    return {
      statusKey: 'FULL',
      dotColor: '#ef4444', // 🔴 Đỏ: Hết chỗ
      label: 'Bận (Hết chỗ)',
      badgeBg: '#fef2f2',
      badgeText: '#b91c1c',
      borderColor: '#fca5a5',
    };
  }
  return {
    statusKey: 'AVAILABLE',
    dotColor: '#10b981', // 🟢 Xanh lá: Rỗi (Còn chỗ)
    label: 'Rỗi (Còn chỗ)',
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
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef(new Map());

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
  }, [lockers, selectedLockerId, onSelectLocker, onActionClick, actionButtonLabel]);

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
