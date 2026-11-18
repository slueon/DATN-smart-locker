# scripts/lib — thư viện đo dùng lại (GĐ59)

Script đo viết ngắn: `import` từ đây, đừng tự viết lại CDP/MySQL/MQTT. Chỉ dùng **tủ ảo `LOCKER_HN_02`**.

- `db.mjs`: `q(sql)`→mảng object · `one(sql)` · `num(sql)` · `run(sql)` · `baseline()`→`{orders,creds,cmd,tokens,users,compartments,hn01}` · `diffBaseline(a,b)`→`{same,changed}` · `assertVirtualLocker(id)` chặn tủ thật.
- `mqtt.mjs`: `pub(topic,payload,{tries})`→`{ok,soLan}` **tự thử lại** (broker TLS rớt ~50%; `soLan>1`=hạ tầng) · `pubOrThrow` · `heartbeat(id)` (bắt buộc trước luồng nạp, GĐ30) · `compartmentStatus/Event`.
- `fixture.mjs`: `withOrder(opts,fn)` tạo đơn PENDING+credential trên tủ ảo rồi **luôn dọn trong `finally`** (kể cả khi `fn` ném lỗi) → `{ketQua,loi,baseline:{truoc,sau,diff}}` · `kioskFlow(id,{shipperToken,compartment})` = QR shipper → mã vận đơn → chọn ngăn (**0-based**) → `deposit_success` (**1-based**) · `orderStatus` · `snapshotShipperToken` · `setShipperToken`.
- `cdp.mjs` (hàm cũ giữ nguyên): `withPage` · `loginAs` · `waitReady` · `screenshot` · `hasText` · `clickByText` · `textsOf`; thêm `watchAttr(p,sel,attrs)`→`{stop(),muts(),thoiLuong(pred)}` (MutationObserver+rAF, bắt khung vài ms) · `collectErrors(p)`→`{loi,net,hienTai()}` gắn **TRƯỚC** `Page.navigate` · `openTab(p,role,label)` bấm tab theo nhãn chính xác, ném lỗi kèm danh sách nút nếu hụt.

## Ví dụ — đo lại phép (2) GĐ57 (bước 6 giữ ≥4 s)

```js
import { withPage, waitReady, sleep, watchAttr, collectErrors } from '../lib/cdp.mjs';
import { withOrder, kioskFlow, heartbeat, LOCKER_AO } from '../lib/fixture.mjs';
const API = 'http://localhost:8080';
const post = async (p, b, t) => (await (await fetch(API + p, { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) },
  body: b ? JSON.stringify(b) : undefined })).json()).data;
const kq = await withOrder({}, ({ orderId }) => withPage(async (p) => {
  const errs = await collectErrors(p);
  const tk = await post('/api/auth/login', { username: 'shipper', password: 'shipper123' });
  const ma = (await post('/api/shipper/token/generate', {}, tk.token)).dynamicToken;
  await p.session.eval(`localStorage.setItem('smart_locker_user', ${JSON.stringify(JSON.stringify(tk))}); location.reload();`);
  await sleep(700); await waitReady(p.session); await sleep(4000);
  await heartbeat(LOCKER_AO); await sleep(700);
  await watchAttr(p, '[data-testid="deposit-steps"]', ['data-buoc']);
  const flow = await kioskFlow(orderId, { shipperToken: ma });
  await sleep(6000);
  const m = await p.session.eval(`(() => { window.__watch.stop(); return window.__watch.muts; })()`);
  const i = m.findIndex((x) => x['data-buoc'] === '6'), j = m.findIndex((x, k) => k > i && x['data-buoc'] !== '6');
  return { giuBuoc6: i < 0 || j < 0 ? null : m[j].t - m[i].t, flow: flow.buoc, ...errs.hienTai() };
}), { startUrl: null });
console.log(JSON.stringify(kq, null, 2));
```

Đo thật 18/11: `giuBuoc6 = 4007`, `flow` đủ 4 chặng `ok`, `loiConsole 0`, `baseline.diff.same = true`. Chạy sẵn: `node scripts/evidence/lib-demo.mjs`.
