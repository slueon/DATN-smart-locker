/**
 * GĐ52 — LOGO "NGĂN TỦ" của SmartLocker (phương án A, user chọn 17/11 17:05).
 *
 * <h2>Vì sao tách thành component</h2>
 * <p>Trước GĐ52 ba chỗ dùng ba thứ khác nhau: `Sidebar` dùng icon lucide `Package` trong ô xanh,
 * `LoginPage` dùng `Lock`, còn `public/favicon.svg` vẫn là **logo Vite tím mặc định** (`#863bff`) —
 * tức thẻ trình duyệt và màn hình đăng nhập nói hai câu chuyện khác nhau về cùng một sản phẩm.
 * Gom về một nguồn duy nhất thì sửa logo chỉ phải sửa một nơi.
 *
 * <h2>Hình vẽ</h2>
 * <p>Ngăn tủ: nền `#2563eb` bo góc 12, **5 ngăn trắng** (4 ô trên + 1 thanh dưới), ô phải-giữa màu
 * `#34d399` có dấu tick `#065f46` = "ngăn đang có bưu kiện". Đây là SVG **chốt sẵn** trong
 * `scripts/evidence/ui/logo/logos.html` khối `<template id="A">`, viewBox 48×48 — chép nguyên hình
 * học, không vẽ lại.
 *
 * <p><b>Dùng được ở mọi cỡ:</b> `viewBox` + `width/height = 100%` nên truyền cỡ qua `className`
 * (`w-9 h-9` cho Sidebar, `w-11 h-11` cho trang đăng nhập). Nền bo góc nằm TRONG SVG nên không cần
 * bọc thêm `div` nền xanh như trước — tránh viền vuông lòi ra sau góc bo.
 *
 * <p><b>Không dùng ảnh PNG</b> (điều cấm #4): SVG nét nên sắc ở mọi độ phân giải và không phát sinh
 * request mạng thêm.
 *
 * @param {string} className lớp Tailwind quyết định cỡ (mặc định 36px — cỡ của Sidebar)
 */
import React from 'react';

export default function BrandLogo({ className = 'w-9 h-9' }) {
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="SmartLocker"
      // `shrink-0`: trong Sidebar khối chữ bên cạnh có `overflow-hidden`; thiếu dòng này logo bị
      // flex bóp méo khi thu gọn cửa sổ.
      style={{ flexShrink: 0 }}
    >
      <rect width="48" height="48" rx="12" fill="#2563eb" />
      <rect x="11" y="10" width="11" height="8" rx="2" fill="#fff" opacity=".95" />
      <rect x="26" y="10" width="11" height="8" rx="2" fill="#fff" opacity=".95" />
      <rect x="11" y="20.5" width="11" height="8" rx="2" fill="#fff" opacity=".95" />
      <rect x="26" y="20.5" width="11" height="8" rx="2" fill="#34d399" />
      <path
        d="M28.6 24.6l2 2 3.6-3.8"
        fill="none"
        stroke="#065f46"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="11" y="31" width="26" height="7" rx="2" fill="#fff" opacity=".95" />
      <circle cx="33.5" cy="34.5" r="1.2" fill="#2563eb" />
    </svg>
  );
}
