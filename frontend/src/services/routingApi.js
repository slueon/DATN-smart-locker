/**
 * GĐ14 — Lấy LỘ TRÌNH LÁI XE THẬT từ OSRM (Open Source Routing Machine).
 *
 * <h2>Vì sao cần</h2>
 * Trước GĐ14, `ShipperRouteMap` tính khoảng cách bằng công thức **Haversine** — đường chim bay.
 * Với Hà Nội, số đó sai 20–60% so với đường đi thật (đo thật: HN_01 → HN_02 = **1.264 km** chim
 * bay nhưng **3.223 km** đường lái xe, chênh **2.55 lần**). Shipper dựa vào con số đó để tính thời
 * gian sẽ trễ. Polyline cũng nối thẳng hai toạ độ nên vẽ đường xuyên sông/đường sắt.
 *
 * <h2>Hợp đồng API OSRM</h2>
 * {@code GET https://router.project-osrm.org/route/v1/driving/{lng},{lat};{lng},{lat}...}
 *
 * <p><b>⚠ THỨ TỰ TOẠ ĐỘ LÀ {@code lng,lat} — KHÔNG phải {@code lat,lng}.</b> Đây là chỗ dễ hỏng
 * nhất và hỏng rất im lặng: đảo chiều thì OSRM vẫn trả 200 nhưng coi toạ độ là điểm giữa đại
 * dương, cho ra tuyến dài hàng nghìn km. Đã kiểm thật: đảo chiều với cặp HN_01/HN_02 trả
 * {@code code: "InvalidValue"} (Hà Nội nằm ngoài dải lat hợp lệ khi hoán vị) — nhưng với cặp toạ
 * độ khác thì có thể trả về một tuyến "hợp lệ" nhưng vô nghĩa, nên TUYỆT ĐỐI không dựa vào việc
 * OSRM báo lỗi để phát hiện nhầm chiều.
 *
 * <h2>Không cache</h2>
 * Tuyến đường phụ thuộc danh sách đơn của từng lần tải. Thêm cache ở đây chỉ làm shipper thấy số
 * liệu cũ khi tuyến đã đổi. Nếu sau này cần cache thì phải khoá theo bộ toạ độ + thời điểm.
 */

/** Endpoint công cộng của OSRM. Tách thành hằng để test/đổi sang self-host dễ dàng. */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

/** Timeout mặc định 8 giây — OSRM công cộng đôi khi chậm, chờ lâu hơn thì shipper sốt ruột. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Dựng đoạn path {@code lng,lat;lng,lat} cho URL OSRM.
 *
 * @param {Array<{lat:number,lng:number}>} points
 * @returns {string}
 */
const toOsrmCoordPath = (points) =>
  points
    .map((p) => `${Number(p.lng)},${Number(p.lat)}`)
    .join(';');

/**
 * Gọi OSRM lấy tuyến lái xe qua các điểm, theo đúng thứ tự truyền vào.
 *
 * <p><b>Lưu ý về thứ tự:</b> hàm này KHÔNG tối ưu thứ tự ghé. Nó trả tuyến đi qua các điểm theo
 * đúng mảng đầu vào, kèm {@code legs} để tầng trên biết từng chặng dài bao nhiêu km thật. Việc
 * sắp thứ tự do {@code buildGreedyRoute} (Haversine) quyết định — xem javadoc ở đó.
 *
 * @param {Array<{lat:number,lng:number}>} points ít nhất 2 điểm (điểm xuất phát + ít nhất 1 tủ)
 * @param {{timeoutMs?: number}} options
 * @returns {Promise<{
 *   distanceKm: number,
 *   durationMin: number,
 *   geometry: Array<[number, number]>,
 *   legs: Array<{distanceKm: number, durationMin: number}>,
 *   source: 'osrm'
 * }>} {@code geometry} là mảng {@code [lat, lng]} đã ĐỔI LẠI cho Leaflet (Leaflet dùng lat trước).
 * @throws {Error} khi mạng lỗi, timeout, HTTP không phải 2xx, hoặc OSRM trả {@code code !== 'Ok'}
 *   → tầng trên bắt lỗi này và fallback về Haversine kèm nhãn cảnh báo.
 */
export const fetchDrivingRoute = async (points, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('Cần ít nhất 2 điểm (điểm xuất phát + 1 tủ) để lấy lộ trình.');
  }
  points.forEach((p, i) => {
    if (!Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lng))) {
      throw new Error(`Toạ độ điểm thứ ${i} không hợp lệ.`);
    }
  });

  const url = `${OSRM_BASE}/${toOsrmCoordPath(points)}`
    + '?overview=full&geometries=geojson&steps=false';

  // AbortController thay vì chỉ dựa vào timeout của fetch: cần HUỶ request đang treo để không
  // giữ kết nối và không làm `loading` của UI kẹt lâu hơn mức cần thiết.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`OSRM trả HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.code !== 'Ok') {
      throw new Error(`OSRM không tìm được tuyến (code: ${data.code})`);
    }
    const route = data.routes?.[0];
    if (!route || !Array.isArray(route.geometry?.coordinates)) {
      throw new Error('OSRM trả dữ liệu tuyến không hợp lệ.');
    }

    // OSRM (geojson) trả [lng, lat]; Leaflet cần [lat, lng] → đổi lại ngay tại biên.
    const geometry = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    return {
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
      geometry,
      legs: (route.legs || []).map((leg) => ({
        distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
        durationMin: Math.round(leg.duration / 60),
      })),
      source: 'osrm',
    };
  } catch (err) {
    // `AbortError` cần message tiếng Việt rõ ràng: nguyên bản chỉ là "The operation was aborted",
    // không nói được là timeout 8 giây.
    if (err?.name === 'AbortError') {
      throw new Error(`OSRM không phản hồi trong ${Math.round(timeoutMs / 1000)} giây.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export default fetchDrivingRoute;
