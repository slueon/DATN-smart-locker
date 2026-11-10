// Phân tích chính xác kiểu hỏng encoding của file
const fs = require('fs');

const f = 'frontend/src/components/AdminTab.jsx';
const buf = fs.readFileSync(f);
const text = buf.toString('utf8');

const i = text.indexOf('Quáº£n');
console.log('Vị trí "Quáº£n":', i);
const seg = buf.subarray(i, i + 24);
console.log('Bytes:', [...seg].map((b) => b.toString(16).padStart(2, '0')).join(' '));

// "Quản" đúng UTF-8 phải là: 51 75 E1 BA A3 6E
console.log('\n"Quản" ĐÚNG phải là: 51 75 | e1 ba a3 (ả) | 6e (n)');
console.log('Thực tế có dấu ả không?', seg.includes(0xe1));

// Thử: chuỗi hiện tại -> latin1 -> utf8
const s1 = Buffer.from(text, 'latin1').toString('utf8');
const j = s1.indexOf('Quản');
console.log('\nSau 1 lớp latin1->utf8, có "Quản" đúng?', j >= 0);
if (j >= 0) {
  console.log('Ngữ cảnh:', s1.substring(j - 30, j + 40).replace(/\n/g, ' '));
}

// Đếm ký tự thay thế U+FFFD (mất dữ liệu)
const fffd = (s1.match(/\uFFFD/g) || []).length;
console.log('Số ký tự hỏng U+FFFD sau giải mã:', fffd);
