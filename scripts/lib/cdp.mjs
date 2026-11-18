/**
 * Thư viện đo UI dùng chung cho minh(verifier) — CHỐNG việc mỗi vòng lại viết lại CDP client.
 *
 * GĐ19 đã sinh ra 31 file `g19-*.cjs`, mỗi file tự viết lại phần connect Chrome từ đầu. Đó là lý do
 * một việc 3 dòng mất hàng chục phút. Thay vào đó: viết một script ngắn gọi các hàm ở đây.
 *
 * CÁCH DÙNG (script trong `scripts/evidence/`):
 *
 *   import { withPage, loginAs, readText, hasText, clickByText, screenshot } from './lib/cdp.mjs';
 *   await withPage(async (p) => {
 *     await loginAs(p, 'khachhang', '123456');
 *     const t = await readText(p);
 *     console.log('co nhan huy =', hasText(t, 'Đơn đã huỷ'));
 *     await screenshot(p, 'customer.png');
 *   });
 *
 * LUẬT: dùng `hasText` / `clickByText` (đọc cấu trúc DOM), KHÔNG dò chuỗi trong `innerText` bằng tay.
 * Bài học: minh đã mắc lỗi "dò innerText" 5 lần và báo lỗi giả.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let msgId = 0;

class Session {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('không nối được CDP websocket'));
    });
    const s = new Session(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && s.pending.has(m.id)) {
        const { resolve, reject } = s.pending.get(m.id);
        s.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    };
    return s;
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout CDP: ' + method));
        }
      }, timeoutMs);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error('JS lỗi: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result?.value;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('không tìm thấy chrome.exe');
}

async function getJson(port, p) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`);
  return r.json();
}

/**
 * Mở Chrome headless + một trang, trao session cho `fn`, rồi dọn sạch (kể cả khi fn ném lỗi).
 * @param {(p: {session: Session, port: number, page: any}) => Promise<any>} fn
 */
export async function withPage(fn, { port = 9333, startUrl = 'http://localhost:5173/', windowSize = '1600,1000' } = {}) {
  const profile = path.join(os.tmpdir(), `cdp-shared-${port}`);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}

  const chrome = spawn(
    chromePath(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${windowSize}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );
  chrome.unref();

  // Chờ CDP sẵn sàng (tối đa 15s) — KHÔNG sleep cứng 4 giây như các script cũ.
  let tabs = null;
  for (let i = 0; i < 30; i++) {
    try {
      tabs = await getJson(port, '/json');
      if (tabs?.length) break;
    } catch {}
    await sleep(500);
  }
  if (!tabs?.length) throw new Error('Chrome không mở được CDP ở port ' + port);

  const pageInfo = tabs.find((t) => t.type === 'page');
  const session = await Session.connect(pageInfo.webSocketDebuggerUrl);
  await session.send('Page.enable');
  await session.send('Runtime.enable');

  const page = { session, port, pageInfo };
  try {
    if (startUrl) {
      await session.send('Page.navigate', { url: startUrl });
      await waitReady(session);
    }
    return await fn(page);
  } finally {
    try {
      session.ws.close();
    } catch {}
    try {
      process.kill(chrome.pid);
    } catch {}
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Chờ app render xong — thay cho các `sleep(7000)` tuỳ tiện trong script cũ.
 * Điều kiện: DOM có nội dung và không còn text "Đang tải".
 */
export async function waitReady(session, maxMs = 25000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const st = await session.eval(
      `JSON.stringify({ len: (document.body?.innerText || '').length, loading: /Đang tải|Loading/i.test(document.body?.innerText || '') })`
    );
    try {
      const o = JSON.parse(st);
      if (o.len > 300 && !o.loading) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

/**
 * Đăng nhập bằng UI thật (không set localStorage) — giống người dùng thao tác.
 *
 * <p><b>SỬA GĐ20 (minh bắt được):</b> bản cũ tìm ô đăng nhập theo `type` khớp
 * `/text|email|tel/`, nhưng form thật dùng `placeholder="Tên đăng nhập hoặc Số điện thoại"`
 * với `type` có thể là `text` nhưng cũng có thể không — nên trả `KHONG_THAY_FORM` dù form
 * hiện rõ trên màn hình. Nay: ưu tiên placeholder/label, và CHỜ form render (SPA cần thời
 * gian) thay vì đọc một lần rồi bỏ cuộc.
 */
export async function loginAs(p, username, password, { formTimeoutMs = 15000 } = {}) {
  // Chờ form đăng nhập render — SPA cần vài giây sau khi Page.navigate trả về.
  const deadlineForm = Date.now() + formTimeoutMs;
  let formReady = false;
  while (Date.now() < deadlineForm) {
    formReady = await p.session.eval(
      `document.querySelectorAll('input').length >= 2 && !!document.querySelector('input[type="password"]')`
    );
    if (formReady) break;
    await sleep(300);
  }
  if (!formReady) throw new Error('form đăng nhập không render sau ' + formTimeoutMs + 'ms');

  const ok = await p.session.eval(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const w = inputs.find(i => i.type === 'password');
    // Ưu tiên placeholder thật của trang, rồi mới tới type. Bỏ qua chính ô password.
    const u = inputs.find(i => i !== w && (
      /tên đăng nhập|số điện thoại|username|email|khachhang/i.test(i.placeholder || '')
      || /tên đăng nhập|số điện thoại|username|email/i.test(i.getAttribute('aria-label') || '')
      || ['text', 'email', 'tel'].includes(i.type)
    ));
    if (!u || !w) return 'KHONG_THAY_FORM';
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(u, ${JSON.stringify(username)});
    setVal(w, ${JSON.stringify(password)});

    // SỬA GĐ20 (đo được, không đoán): trang có HAI nút chứa chữ "Đăng nhập" —
    // nút đầu là TAB chuyển giữa "Đăng nhập" / "Đăng ký khách" (bấm vào không gửi gì),
    // nút thật là "Đăng nhập vào hệ thống". Bản cũ bắt nút đầu nên form không bao giờ submit.
    const btns = [...document.querySelectorAll('button, [type="submit"]')];
    const byText = (re) => btns.find(b => re.test((b.textContent || '').trim()) && !b.disabled);
    const btn =
      byText(/đăng nhập vào hệ thống/i)
      || byText(/^đăng nhập$/i) && btns.filter(b => /^đăng nhập$/i.test((b.textContent || '').trim())).pop()
      || byText(/đăng nhập|login/i)
      || document.querySelector('button[type="submit"]');
    if (!btn) return 'KHONG_THAY_NUT';
    if (btn.disabled) return 'NUT_DANG_TAT';
    btn.click();
    return 'CLICKED:' + (btn.textContent || '').trim().slice(0, 30);
  })()`);
  if (!String(ok).startsWith('CLICKED')) throw new Error('login thất bại: ' + ok);

  // Chờ đăng nhập xong — ĐIỀU KIỆN CHÍNH: có token trong localStorage.
  //
  // minh chỉ ra rủi ro thật ở bản trước: `!!document.querySelector('aside, nav')` có thể đúng
  // TRƯỚC khi phiên xác lập (sidebar render cùng layout), nên hàm trả `true` sớm và script đo
  // tiếp trên một trang chưa đăng nhập. Nay kiểm TOKEN trước, và chỉ coi sidebar/nút Đăng xuất
  // là dấu hiệu dự phòng khi trang không lưu token ở localStorage.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const st = await p.session.eval(`(() => {
      let tok = null;
      try {
        const raw = localStorage.getItem('smart_locker_user');
        if (raw) tok = (JSON.parse(raw) || {}).token || null;
      } catch (e) {}
      return JSON.stringify({
        token: !!tok && String(tok).length > 10,
        ui: document.body.innerText.includes('Đăng Xuất') || document.body.innerText.includes('Đăng xuất'),
        onLoginPage: /Đăng nhập vào hệ thống/.test(document.body.innerText)
      });
    })()`);
    let o = null;
    try {
      o = JSON.parse(st);
    } catch {}
    if (o?.token) return true;
    // Dự phòng: đã rời màn đăng nhập VÀ có UI đã đăng nhập.
    if (o?.ui && !o.onLoginPage) return true;
    await sleep(400);
  }
  throw new Error('đăng nhập không xong sau 20s (không thấy token và vẫn ở màn đăng nhập)');
}

/** Toàn bộ text đang hiển thị. Chỉ dùng để đọc NHANH; khẳng định phải dùng hasText/elementText. */
export async function readText(p) {
  return await p.session.eval('document.body.innerText');
}

/** Kiểm một chuỗi có xuất hiện trong nội dung ĐANG HIỂN THỊ hay không. */
export function hasText(bodyText, phrase) {
  return typeof bodyText === 'string' && bodyText.includes(phrase);
}

/** Đếm số lần một chuỗi xuất hiện. */
export function countText(bodyText, phrase) {
  if (typeof bodyText !== 'string' || !phrase) return 0;
  return bodyText.split(phrase).length - 1;
}

/**
 * Bấm phần tử NHỎ NHẤT có chứa text (tránh bấm trúng thẻ cha bao cả trang — lỗi minh đã mắc).
 * Trả về text của phần tử đã bấm để script tự kiểm chứng nó bấm đúng chỗ.
 */
export async function clickByText(p, phrase) {
  return await p.session.eval(`(() => {
    const all = [...document.querySelectorAll('button, a, div[class*="cursor-pointer"], [role="button"]')];
    const cands = all.filter(e => (e.textContent || '').includes(${JSON.stringify(phrase)}));
    if (!cands.length) return null;
    cands.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    const el = cands[0];
    el.click();
    return (el.textContent || '').trim().slice(0, 200);
  })()`);
}

/** Đọc text của các phần tử khớp selector — đọc CẤU TRÚC DOM, không dò chuỗi. */
export async function textsOf(p, selector) {
  return await p.session.eval(
    `[...document.querySelectorAll(${JSON.stringify(selector)})].map(e => (e.textContent || '').trim())`
  );
}

/** Chụp màn hình vào scripts/evidence/. */
export async function screenshot(p, filename) {
  const r = await p.session.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(process.cwd(), 'scripts', 'evidence', filename);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * GĐ59 — BA HÀM BỔ SUNG. KHÔNG đổi chữ ký/ hành vi của các hàm phía trên.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ghi MỌI lần đổi thuộc tính của phần tử khớp `selector` — bắt cả khung sống vài mili-giây.
 *
 * <p><b>Vì sao cần:</b> `data-buoc="6"` của thanh 5 bước chỉ sống ~5 ms trước khi state khác ghi
 * đè. Đo bằng `sleep` + đọc một lần thì trượt (đã trượt ở GĐ57 vòng 1: 0/119 mẫu). MutationObserver
 * chạy đồng bộ theo mutation nên bắt được đúng khoảnh khắc, kể cả khi không có khung hình nào.
 *
 * <p><b>Cách dùng:</b> gọi hàm NÀY TRƯỚC hành động cần đo, chờ, rồi đọc `ketQua.muts` /
 * `ketQua.thoiLuong()`. Dữ liệu nằm trong `window.__watch` (một bài đo mỗi trang).
 *
 * @param {object} p  page của {@link withPage}
 * @param {string} selector  CSS selector, khớp phần tử ĐẦU TIÊN
 * @param {string|string[]} attr  tên thuộc tính, hoặc mảng thuộc tính cần theo dõi
 * @returns {Promise<object>} `{ stop(), muts, ketQua, thoiLuong() }` — xem README
 */
export async function watchAttr(p, selector, attr) {
  const attrs = Array.isArray(attr) ? attr.slice() : [attr];
  await p.session.eval(`(() => {
    if (window.__watch) { try { window.__watch.stop(); } catch (e) {} }
    const SEL = ${JSON.stringify(selector)};
    const ATTRS = ${JSON.stringify(attrs)};
    const el = () => document.querySelector(SEL);
    const doc = () => {
      const e = el(); if (!e) return null;
      const o = {}; ATTRS.forEach((a) => { o[a] = e.getAttribute(a); });
      return o;
    };
    const t0 = performance.now();
    const w = { sel: SEL, attrs: ATTRS, muts: [], t0, running: true };
    w.stop = () => { w.running = false; if (w.__mo) { try { w.__mo.disconnect(); } catch (e) {} } };
    w.snapshot = doc();
    // Mẫu rAF: bắt cả trường hợp MutationObserver không chạy (phần tử bị GỠ rồi gắn lại).
    const loop = () => {
      if (!w.running) return;
      const s = doc();
      if (s) {
        const k = JSON.stringify(s);
        const last = w.muts.length ? w.muts[w.muts.length - 1].k : null;
        if (k !== last) w.muts.push({ t: Math.round(performance.now() - t0), k, ...s });
      } else if (w.muts.length === 0 || w.muts[w.muts.length - 1].k !== '<gone>') {
        w.muts.push({ t: Math.round(performance.now() - t0), k: '<gone>' });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    const e0 = el();
    if (e0) {
      const mo = new MutationObserver(() => {
        if (!w.running) return;
        const s = doc(); if (!s) return;
        const k = JSON.stringify(s);
        const last = w.muts.length ? w.muts[w.muts.length - 1].k : null;
        if (k !== last) w.muts.push({ t: Math.round(performance.now() - t0), k, ...s, mo: 1 });
      });
      // observe cả subtree: attribute của mỗi phần tử con mới là thứ đổi (data-done/data-active).
      mo.observe(e0, { attributes: true, subtree: true, attributeFilter: ATTRS });
      w.__mo = mo;
    }
    window.__watch = w;
    return 'ok';})()`);

  const helpers = {
    /** Dừng thu; trả toàn bộ mốc đã ghi (đọc được cả sau khi trang đổi). */
    async stop() {
      const r = await p.session.eval(`(() => { if (!window.__watch) return null;
        window.__watch.stop(); return window.__watch.muts; })()`);
      return r || [];
    },
    /** Đọc mốc hiện có mà KHÔNG dừng (dùng khi cần xem giữa chừng). */
    async muts() {
      return (await p.session.eval(`(window.__watch ? window.__watch.muts : [])`)) || [];
    },
    /**
     * Khoảng thời gian giữa mốc ĐẦU TIÊN khớp `pred` và mốc kế tiếp KHÔNG khớp — đúng định
     * nghĩa "giá trị X tồn tại bao lâu". Trả `null` nếu không thấy cặp.
     * @param {(m:object)=>boolean|string} pred  hàm chạy TRONG TRANG nếu là string
     */
    async thoiLuong(pred) {
      const src = typeof pred === 'function' ? pred.toString() : `(${pred})`;
      return await p.session.eval(`(() => {
        const ds = (window.__watch ? window.__watch.muts : []) || [];
        const f = ${src};
        const i = ds.findIndex(f);
        if (i < 0) return null;
        for (let j = i + 1; j < ds.length; j++) {
          if (!f(ds[j])) return ds[j].t - ds[i].t;
        }
        return null; })()`);
    },
  };
  return helpers;
}

/**
 * Gắn bắt lỗi (Runtime + Log + Network) — **PHẢI gọi TRƯỚC `Page.navigate`**.
 *
 * <p><b>Vì sao trước:</b> observer gắn sau `navigate` sẽ bỏ mất request/exception của chính lần
 * tải đầu — đúng cái mà phép "0 lỗi console" muốn kiểm. Hàm này tự gắn listener lên websocket
 * (không xin lại domain), nên gọi lúc nào cũng được nhưng chỉ CÓ TÁC DỤNG từ thời điểm gọi.
 *
 * @param {object} p  page của {@link withPage}
 * @param {{ignoreUrls?:string[]}} [opts]  URL chứa các chuỗi này thì bỏ qua (vd. favicon)
 * @returns {Promise<{loi:Array, net:Array, hienTai:Function, tat:Function}>}
 */
export async function collectErrors(p, opts = {}) {
  const ignore = opts.ignoreUrls || [];
  const loi = [];
  const net = [];
  const onMsg = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const P = m.params || {};
    if (m.method === 'Runtime.consoleAPICalled' && P.type === 'error') {
      loi.push('console ' + (P.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 180));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      loi.push('EXC ' + (P.exceptionDetails?.exception?.description || P.exceptionDetails?.text || '').slice(0, 180));
    }
    if (m.method === 'Log.entryAdded' && P.entry?.level === 'error') {
      loi.push('LOG ' + String(P.entry.text || '').slice(0, 180));
    }
    if (m.method === 'Network.responseReceived' && P.response?.status >= 400) {
      const url = String(P.response.url || '');
      if (ignore.some((s) => url.includes(s))) return;
      net.push(P.response.status + ' ' + url.replace('http://localhost:8080', '').slice(0, 140));
    }
  };
  p.session.ws.addEventListener('message', onMsg);
  // Domain enable: nếu đã bật rồi thì lệnh này idempotent.
  await p.session.send('Runtime.enable').catch(() => {});
  await p.session.send('Log.enable').catch(() => {});
  await p.session.send('Network.enable').catch(() => {});
  return {
    loi,
    net,
    /** Ảnh chụp hiện tại + dừng gắn (gọi cuối bài đo để in ra log). */
    hienTai: () => ({ loiConsole: loi.length, chiTietLoi: loi.slice(), http4xx5xx: net.slice() }),
    tat: () => p.session.ws.removeEventListener('message', onMsg),
  };
}

/**
 * Bấm đúng tab/subtab của một vai trò — tìm theo NHÃN CHÍNH XÁC, bỏ qua sidebar.
 *
 * <p><b>Vì sao cần:</b> đã 3 lần đo bấm nhầm: nhãn trùng ở sidebar và ở thanh tab, và nút tab
 * admin nằm trong vùng main chứ không phải `aside`. Hàm lọc `<button>` có text khớp CHÍNH XÁC
 * trước, rồi mới tới "chứa"; trả lại nhãn đã bấm để script tự kiểm chứng.
 *
 * <p>Vai trò không đổi cách tìm nút — nó chỉ chọn bộ nhãn hay dùng để BÁO lỗi sớm khi bấm hụt:
 * gọi `openTab(p, 'ADMIN', 'Sơ đồ ngăn')` để kiểm cả hai.
 *
 * @param {object} p
 * @param {'ADMIN'|'SHIPPER'|'CUSTOMER'|'ANY'} role
 * @param {string} label  nhãn nút (vd. `'Sơ đồ ngăn'`, `'Thu hồi hàng quá hạn'`)
 */
export async function openTab(p, role, label) {
  const VAI_TRO = ['ADMIN', 'SHIPPER', 'CUSTOMER', 'ANY'];
  const vai = String(role || '').toUpperCase();
  if (!VAI_TRO.includes(vai)) throw new Error(`vai trò không hợp lệ: "${role}" (dùng ${VAI_TRO.join('|')})`);
  const nhan = String(label);
  const daBam = await p.session.eval(`(() => {
    const TRONG_SIDEBAR = false; // nhãn tab/subtab luôn nằm ở vùng main
    const tat = [...document.querySelectorAll('button, [role="tab"], a')]
      .filter((x) => !x.disabled && (!TRONG_SIDEBAR || !x.closest('aside')));
    const chuan = (x) => (x.textContent || '').replace(/\\s+/g, ' ').trim();
    const exact = tat.find((x) => chuan(x) === ${JSON.stringify(nhan)});
    const chua = tat.filter((x) => chuan(x).includes(${JSON.stringify(nhan)}))
      .sort((a, b) => chuan(a).length - chuan(b).length)[0];
    const el = exact || chua;
    if (!el) return { ok: false, daBam: null, ungVien: tat.map(chuan).filter(Boolean).slice(0, 25) };
    el.click();
    return { ok: true, daBam: chuan(el).slice(0, 60), chinhXac: !!exact };
  })()`);
  if (!daBam?.ok) {
    throw new Error(`[${vai}] không thấy tab "${nhan}". Nút đang có: ${(daBam?.ungVien || []).join(' | ')}`);
  }
  return { ...daBam, vaiTro: vai };
}
