import React from 'react';

/**
 * CircularTimer: Vòng tròn đếm ngược thời gian mượt mà dạng SVG
 * @param {number} secondsLeft Số giây còn lại
 * @param {number} totalSeconds Tổng số giây ban đầu
 * @param {number} size Kích thước đường kính (px)
 * @param {number} strokeWidth Độ dày viền tròn
 * @param {string} label Nhãn hiển thị bên dưới số giây
 * @param {string} format 'mm:ss' hoặc 'seconds'
 */
export default function CircularTimer({
  secondsLeft = 60,
  totalSeconds = 60,
  size = 120,
  strokeWidth = 7,
  label = '',
  format = 'auto'
}) {
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = Math.max(0, Math.min(1, secondsLeft / (totalSeconds || 1)));
  const strokeDashoffset = circumference - progressRatio * circumference;

  // Xác định màu sắc động theo tỷ lệ % thời gian còn lại
  const percent = progressRatio * 100;
  let strokeColor = '#3b82f6'; // Blue
  let bgGlow = 'rgba(59, 130, 246, 0.15)';
  let textColor = 'text-blue-600';

  if (percent <= 20) {
    strokeColor = '#f43f5e'; // Rose
    bgGlow = 'rgba(244, 63, 94, 0.2)';
    textColor = 'text-rose-600';
  } else if (percent <= 50) {
    strokeColor = '#f59e0b'; // Amber
    bgGlow = 'rgba(245, 158, 11, 0.15)';
    textColor = 'text-amber-600';
  } else {
    strokeColor = '#10b981'; // Emerald
    bgGlow = 'rgba(16, 185, 129, 0.15)';
    textColor = 'text-emerald-600';
  }

  // Định dạng hiển thị
  const formatTimeDisplay = () => {
    if (format === 'mm:ss' || (format === 'auto' && totalSeconds > 90)) {
      const mins = Math.floor(secondsLeft / 60);
      const secs = secondsLeft % 60;
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${secondsLeft}s`;
  };

  const isCritical = secondsLeft <= 10 && secondsLeft > 0;

  return (
    <div className="relative inline-flex flex-col items-center justify-center select-none">
      <svg
        width={size}
        height={size}
        className={`transform -rotate-90 transition-all duration-300 ${isCritical ? 'animate-pulse' : ''}`}
      >
        {/* Track viền nền */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
          fill="transparent"
        />

        {/* Vòng tiến trình đếm ngược */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          style={{
            transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease',
            filter: `drop-shadow(0 0 6px ${bgGlow})`
          }}
        />
      </svg>

      {/* Nội dung text trung tâm */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className={`text-xl font-bold font-mono tracking-tight leading-none ${textColor}`}>
          {formatTimeDisplay()}
        </span>
        {label && (
          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-1 block">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
