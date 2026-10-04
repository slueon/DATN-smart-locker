import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function LockerMap({ lockers, selectedLockerId, onSelectLocker }) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Nếu chưa khởi tạo bản đồ
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        scrollWheelZoom: false,
      }).setView([20.9808, 105.7877], 17);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Xóa markers cũ
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Vẽ markers mới
    lockers.forEach((locker) => {
      if (locker.latitude && locker.longitude) {
        const isSelected = locker.lockerId === selectedLockerId;
        const icon = L.divIcon({
          className: 'custom-leaflet-marker',
          html: `
            <div style="
              background: ${isSelected ? '#4f46e5' : '#0ea5e9'};
              color: white;
              padding: 5px 10px;
              border-radius: 9999px;
              font-weight: bold;
              font-size: 11px;
              box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
              border: 2px solid white;
              white-space: nowrap;
              cursor: pointer;
              transition: all 0.2s;
              transform: ${isSelected ? 'scale(1.05)' : 'scale(1)'};
            ">
              📍 <span>${locker.name || 'TỦ THÔNG MINH'}</span>
            </div>
          `,
          iconSize: [140, 28],
          iconAnchor: [70, 14],
        });

        const marker = L.marker([locker.latitude, locker.longitude], { icon }).addTo(map);
        marker.on('click', () => {
          if (onSelectLocker) {
            onSelectLocker(locker.lockerId);
          }
        });
        markersRef.current.push(marker);
      }
    });
  }, [lockers, selectedLockerId, onSelectLocker]);

  // Hủy map khi component unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapContainerRef}
      className="w-full h-full rounded-xl overflow-hidden shadow-inner"
      style={{ minHeight: '190px' }}
    />
  );
}
