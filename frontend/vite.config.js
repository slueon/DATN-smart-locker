import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // Lắng nghe trên mọi địa chỉ (0.0.0.0) để điện thoại cùng Wi-Fi mở được http://<IP-máy>:5173.
    // Mặc định Vite chỉ nghe localhost nên máy khác trong mạng không kết nối được.
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // Truy cập dev server qua IP LAN (vd. từ điện thoại) thì trình duyệt gửi
        // `Origin: http://<ip>:5173` — không nằm trong danh sách CORS của backend ⇒ 403
        // "Invalid CORS request". Request đã đi qua proxy (cùng origin với trang) nên bỏ
        // header Origin, backend coi như request server-to-server.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'));
        },
      }
    }
  }
})
