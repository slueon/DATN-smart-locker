// Giữ phần đầu STATE.md (giai đoạn mới nhất ở TRÊN) tới trước MARKER, chuyển phần còn lại sang cuối ARCHIVE.md.
// Chỉ append vào ARCHIVE.md (không đọc nội dung). Dùng Node để không hỏng tiếng Việt UTF-8.
import fs from 'node:fs';

const STATE = 'STATE.md';
const ARCH = 'ARCHIVE.md';
const MARKER = process.argv[2] || '# GĐ56 — ';
const HEADER = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8') : '';

const src = fs.readFileSync(STATE, 'utf8');
const idx = src.indexOf('\n' + MARKER);
if (idx < 0) { console.error('KHONG TIM THAY marker: ' + MARKER); process.exit(1); }
const kept = src.slice(0, idx).replace(/\s*-{3}\s*$/, '') + '\n';
const archived = src.slice(idx + 1);

fs.appendFileSync(ARCH, '\n\n---\n\n<!-- archived ' + new Date().toISOString() + ' : ' +
  archived.split('\n').length + ' dong -->\n\n' + archived, 'utf8');
fs.writeFileSync(STATE, HEADER + kept, 'utf8');

const check = fs.readFileSync(STATE, 'utf8');
console.log(JSON.stringify({
  dongGiu: check.split('\n').length,
  dongChuyen: archived.split('\n').length,
  fffd: (check.match(/�/g) || []).length,
  bom: check.charCodeAt(0) === 0xfeff,
}));
