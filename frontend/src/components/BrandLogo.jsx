/**
 * GĐ55 — logo SmartLocker lấy từ bộ logo của user (`public/brand/*.svg`, chép nguyên byte từ `logo/`).
 *
 * `variant="dark"` dùng `smartlocker-icon-dark.svg` (nền #1E293B) cho nền tối như Sidebar — bản
 * thường có nền #0F172A trùng màu sidebar nên mất viền. Mặc định dùng `smartlocker-icon.svg`
 * (trang đăng nhập, nền sáng). Cỡ truyền qua `className` (w-9 h-9 / w-11 h-11).
 *
 * @param {string} className lớp Tailwind quyết định cỡ
 * @param {'light'|'dark'} variant
 */
import React from 'react';

export default function BrandLogo({ className = 'w-9 h-9', variant = 'light' }) {
  const src = variant === 'dark' ? '/brand/smartlocker-icon-dark.svg' : '/brand/smartlocker-icon.svg';
  return (
    <img
      src={src}
      alt="SmartLocker"
      className={className}
      style={{ flexShrink: 0, maxWidth: 'none', objectFit: 'contain' }}
    />
  );
}
