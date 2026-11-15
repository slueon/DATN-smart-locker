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
