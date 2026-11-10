// Sửa mojibake: file đã bị UTF-8 decode nhầm bằng CP1252 (Windows-1252) MỘT lần.
// Cách sửa: lấy text hiện tại -> mã hoá lại thành CP1252 (byte gốc) -> giải mã bằng UTF-8.
// Giữ nguyên code, chỉ đổi ký tự. Không sửa logic.
const fs = require('fs');
const path = require('path');

const FILES = [
  'frontend/src/components/AdminTab.jsx',
  'frontend/src/components/LockerNetworkMapTab.jsx',
  'frontend/src/components/ShipperTab.jsx',
];

// Bảng ánh xạ CP1252 cho các mã 0x80-0x9F (vùng Windows-1252 khác Latin-1)
const CP1252_SPECIAL = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};
const REVERSE = new Map(Object.entries(CP1252_SPECIAL).map(([u, b]) => [Number(u), b]));

/** Chuyển text (đã bị decode nhầm) trở lại mảng byte gốc. */
function toOriginalBytes(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) {
      bytes.push(cp);
    } else if (REVERSE.has(cp)) {
      bytes.push(REVERSE.get(cp));
    } else {
      // Ký tự không thuộc CP1252 (ví dụ tiếng Việt đúng sẵn) -> giữ nguyên dạng UTF-8
      const b = Buffer.from(ch, 'utf8');
      for (const x of b) bytes.push(x);
    }
  }
  return Buffer.from(bytes);
}

let changed = 0;
for (const rel of FILES) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) { console.log('BO QUA (khong co):', rel); continue; }

  const before = fs.readFileSync(full, 'utf8');
  const badBefore = (before.match(/Ã|áº|á»/g) || []).length;
  if (badBefore === 0) { console.log(`SACH, khong sua: ${rel}`); continue; }

  const fixed = toOriginalBytes(before).toString('utf8');
  // Chỉ đếm mojibake THẬT: 'Ã' đứng một mình sau 'Đ' là chữ "ĐÃ" hợp lệ, không tính.
  const realMojibake = (s) =>
    (s.match(/Ã[\u00A0-\u00BF\u0080-\u009F]|áº|á»|Ã¢|Ãª|Ã´|Ã¨|Ã©|Ã¬|Ã­|Ã²|Ã³|Ã¹|Ãº/g) || []).length;
  const badAfter = realMojibake(fixed);
  const broken = (fixed.match(/\uFFFD/g) || []).length;

  console.log(`\n${rel}`);
  console.log(`  truoc : mojibake=${badBefore}`);
  console.log(`  sau   : mojibake=${badAfter}  ky-tu-hong=${broken}`);

  if (badAfter === 0 && broken === 0) {
    fs.writeFileSync(full, fixed, 'utf8');
    console.log('  -> DA SUA');
    changed++;
  } else {
    console.log('  -> KHONG SUA (se mat du lieu), can kiem tra tay');
  }
}
console.log(`\nTong file da sua: ${changed}`);
