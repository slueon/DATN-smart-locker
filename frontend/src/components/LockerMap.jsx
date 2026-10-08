import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

export default function LockerMap({ lockers = [], selectedLockerId, onSelectLocker }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Khởi tạo Leaflet Map nếu chưa có instance
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        scrollWheelZoom: false,
        zoomControl: true,
      }).setView([20.9808, 105.7877], 17);

      // Sử dụng Google Maps Tile Layer: hoàn toàn miễn phí, không yêu cầu API key, không bị watermark "API KEY REQUIRED", tốc độ CDN cực nhanh và hiển thị rõ ràng đường xá/địa danh Việt Nam
      const primaryTileLayer = L.tileLayer(
        'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        {
          subdomains: ['0', '1', '2', '3'],
          attribution: '&copy; Google Maps &mdash; Trạm Tủ PTIT Hà Đông',
          maxZoom: 20,
          crossOrigin: true,
        }
      );

      // Lớp dự phòng OpenStreetMap DE (không giới hạn API key) nếu gặp sự cố mạng
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
    markersRef.current = [];

    // Vẽ markers mới chuẩn phong cách Toss / Smart Logistics
    lockers.forEach((locker) => {
      if (locker.latitude && locker.longitude) {
        const isSelected = locker.lockerId === selectedLockerId;

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
                box-shadow: ${isSelected ? '0 4px 14px rgba(37, 99, 235, 0.4)' : '0 2px 8px rgba(0, 0, 0, 0.12)'};
                border: 2px solid ${isSelected ? '#ffffff' : '#e2e8f0'};
                white-space: nowrap;
                transition: transform 0.15s ease;
                transform: ${isSelected ? 'scale(1.06)' : 'scale(1)'};
              ">
                <span style="
                  width: 8px;
                  height: 8px;
                  border-radius: 9999px;
                  background: ${isSelected ? '#ffffff' : '#10b981'};
                  display: inline-block;
                "></span>
                <span>${locker.name || 'Trạm Tủ PTIT'}</span>
                <span style="
                  font-size: 10px;
                  font-weight: 500;
                  background: ${isSelected ? 'rgba(255,255,255,0.25)' : '#f1f5f9'};
                  padding: 1px 6px;
                  border-radius: 9999px;
                  color: ${isSelected ? '#ffffff' : '#64748b'};
                ">${locker.availableCompartments ?? 3} Ngăn</span>
              </div>
            </div>
          `,
          iconSize: [160, 36],
          iconAnchor: [80, 18],
        });

        const marker = L.marker([locker.latitude, locker.longitude], { icon }).addTo(map);
        marker.on('click', () => {
          if (onSelectLocker) {
            onSelectLocker(locker.lockerId);
          }
        });
        markersRef.current.push(marker);

        if (isSelected) {
          map.panTo([locker.latitude, locker.longitude], { animate: true, duration: 0.4 });
        }
      }
    });

    // Tự động kích hoạt khi container thay đổi kích thước (ví dụ khi tab được mở)
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
  }, [lockers, selectedLockerId, onSelectLocker]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full min-h-[220px] rounded-xl overflow-hidden border border-slate-200/80 shadow-xs bg-slate-100">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
        style={{ minHeight: '220px', zIndex: 1 }}
      />
      {/* Station Location Info Badge */}
      <div className="absolute top-3 right-3 z-[400] bg-white/95 backdrop-blur-sm border border-slate-200 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1.5 shadow-xs pointer-events-none">
        <MapPin className="w-3.5 h-3.5 text-blue-600" />
        <span>Bản đồ Vị trí KTX PTIT</span>
      </div>
    </div>
  );
}
