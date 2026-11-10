// Script quét mojibake trong frontend/src — đọc bằng .NET UTF-8, KHÔNG dùng Get-Content
// (Get-Content của PowerShell 5.1 đọc hỏng dấu tiếng Việt, đã gây chẩn đoán sai nhiều lần)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'frontend', 'src');
// Các mẫu mojibake thật: chuỗi UTF-8 bị giải mã nhầm thành Latin-1 rồi lưu lại
const PATTERNS = [
  { name: 'mojibake-Ã', re: /\u00C3[\u00A0-\u00BF\u0080-\u009F]|Ã¡|Ã¢|Ã£|Ã¨|Ã©|Ã¬|Ã­|Ã²|Ã³|Ã¹|Ãº|Ã½/g },
  { name: 'mojibake-áº', re: /áº|á»/g },
  { name: 'mojibake-Ä', re: /Ä‘|Ä\u0090/g },
  { name: 'dau-cham-giua', re: /·/g }, // dấu · xuất hiện trong "BẢ·ẾN"
  { name: 'dau-sao-M', re: /Ạ·|Ả·|Ậ·/g },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let total = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const hits = [];
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(`${name}=${m.length}`);
  }
  if (hits.length) {
    total++;
    const rel = path.relative(process.cwd(), f);
    console.log(`${rel}  ->  ${hits.join(' ')}`);
  }
}
console.log(`\nTong file co mojibake: ${total} / ${files.length} file da quet`);
