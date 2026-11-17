// Chuyển các giai đoạn cũ của STATE.md sang ARCHIVE.md, chỉ giữ phần đang chạy.
// Dùng Node (không dùng PowerShell) để không làm hỏng tiếng Việt UTF-8.
import fs from 'node:fs';

const STATE = 'STATE.md';
const ARCH = 'ARCHIVE.md';
const MARKER = '# GĐ42 — WEB ĐỨNG YÊN';

const src = fs.readFileSync(STATE, 'utf8');
const idx = src.indexOf(MARKER);
if (idx < 0) {
  console.error('KHONG TIM THAY marker: ' + MARKER);
  process.exit(1);
}
const archived = src.slice(0, idx);
const kept = src.slice(idx);

fs.appendFileSync(
  ARCH,
  '\n\n---\n\n<!-- archived ' + new Date().toISOString() + ' : ' +
    archived.split('\n').length + ' dong -->\n\n' + archived,
  'utf8'
);
fs.writeFileSync(STATE, kept, 'utf8');

const check = fs.readFileSync(STATE, 'utf8');
const fffd = (check.match(/\uFFFD/g) || []).length;
const bom = check.charCodeAt(0) === 0xfeff;
console.log(JSON.stringify({
  dongGiu: kept.split('\n').length,
  dongLuuTru: archived.split('\n').length,
  fffd,
  bom
}));
