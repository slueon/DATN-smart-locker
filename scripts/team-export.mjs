// Xuất cấu hình "Team Tinh Gọn" từ DS Bot trong DeepSeek Harness (~/.dsh/bot) thành 1 file markdown,
// để Chief bên DS Bot riêng (~/.ds-bot) đọc và tự cài bằng công cụ của nó (update_bot, remember, create_group).
// Chỉ ĐỌC ~/.dsh, không ghi vào dữ liệu app nào. Dùng Node để giữ đúng UTF-8.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SRC = path.join(os.homedir(), '.dsh', 'bot');
const OUT = process.argv[2] || 'scripts/evidence/team-export/TEAM-TINH-GON-EXPORT.md';
const st = JSON.parse(fs.readFileSync(path.join(SRC, 'state.json'), 'utf8'));
const mem = (...p) => { const f = path.join(SRC, 'memory', ...p); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : ''; };
const fence = (s) => '~~~~text\n' + s.trim() + '\n~~~~';

const bots = Object.values(st.bots);
const room = Object.values(st.rooms).find((r) => r.name === 'Team Tinh Gọn');
const nameOf = (id) => (bots.find((b) => b.id === id) || {}).name || id;

let md = `# XUẤT TEAM TINH GỌN — từ DS Bot (DeepSeek Harness) sang DS Bot riêng
Tạo lúc ${new Date().toISOString()} bởi \`scripts/team-export.mjs\`. File này chứa lời dặn + trí nhớ của team — KHÔNG đưa lên git.

## HƯỚNG DẪN CHO CHIEF BÊN DS BOT RIÊNG (làm đúng thứ tự, mỗi bước 1 lần)
1. \`list_bots\` — đối chiếu 3 bot đang có (Chief, sóc, minh). KHÔNG tạo bot trùng; nếu tên khác thì đổi tên bằng \`update_bot\`
   cho khớp mục 2 (\`sóc(dev)\`, \`minh(verifier)\`). KHÔNG đổi \`work_dir\` (user cấm), KHÔNG đổi model trừ khi user bảo.
2. **Chief:** \`update_bot\` (bỏ tham số \`bot\` để sửa chính mình) đặt role/color/instructions đúng nguyên văn khối lời dặn của Chief.
   **sóc, minh: GIỮ NGUYÊN lời dặn đang có** (bên DS Bot riêng đã viết lại mới hơn ngày 18/11). Chỉ đặt role/color, và nếu lời dặn
   hiện tại THIẾU luật nào trong khối cũ (vd. cầu chì 2 vòng/thẻ, cấm ghi file bằng PowerShell, không restart server khi minh đo) thì
   nối thêm đúng luật đó — không thay cả khối.
3. Trí nhớ TEAM (mục "TRÍ NHỚ TEAM"): mỗi dòng \`- …\` là 1 entry ⇒ \`remember\` scope \`team\`, bỏ phần đuôi \`[id · ngày]\`.
4. Trí nhớ riêng từng bot: MEMORY.md ⇒ \`remember\` (scope = tên bot; của Chief thì không cần scope);
   các file chủ đề (\`smart-locker.md\`, \`project.md\`…) ⇒ \`remember\` với \`topic\` = tên file bỏ \`.md\`. Entry nào >300 ký tự thì tách đôi.
   Bỏ qua entry đã lỗi thời so với repo (vd. nói tới GĐ đã xong) — không sao chép mù.
5. Kiểm \`list_bots\`: nếu đã có nhóm "Team Tinh Gọn" thì dùng \`update_group\`, không tạo trùng. Không thì \`create_group\` tên **Team Tinh Gọn**, thành viên 3 bot, admin Chief, reply mode **admin**, notice đúng nguyên văn mục "NHÓM".
6. Báo user 3 dòng: số entry đã ghi (team / Chief / sóc / minh), nhóm đã tạo, việc nào bỏ qua + lý do.
Trạng thái công việc KHÔNG nằm ở đây mà ở repo: đọc \`STATE.md\` (2 giai đoạn gần nhất + "DỮ LIỆU CHUẨN"), \`MAP.md\`, \`AGENTS.md\`.

`;

md += '## BOT\n';
for (const b of bots) {
  md += `\n### ${b.name}\n- role: \`${b.role}\` · color: \`${b.color}\` · avatar: \`${b.avatar?.shape}\` · model bên cũ: \`${b.model}\` · work_dir: \`${b.workDir}\`\n\n**Lời dặn (instructions):**\n\n${fence(b.instructions || '(trống)')}\n`;
}

md += '\n## NHÓM\n';
if (room) {
  md += `- Tên: **${room.name}** · admin: ${nameOf(room.admin)} · reply mode: \`${room.mode}\` · thành viên: ${room.members.map(nameOf).join(', ')}\n\n**Notice:**\n\n${fence(room.notice || '')}\n`;
}

md += `\n## TRÍ NHỚ TEAM (team/MEMORY.md)\n\n${fence(mem('team', 'MEMORY.md'))}\n`;

for (const b of bots) {
  const dir = path.join(SRC, 'memory', 'bots', b.id);
  if (!fs.existsSync(dir)) { md += `\n## TRÍ NHỚ ${b.name}\n(không có)\n`; continue; }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort((a, c) => (a === 'MEMORY.md' ? -1 : c === 'MEMORY.md' ? 1 : a.localeCompare(c)));
  md += `\n## TRÍ NHỚ ${b.name}\n`;
  for (const f of files) md += `\n### ${f === 'MEMORY.md' ? 'MEMORY.md (chính)' : 'topic: ' + f.replace(/\.md$/, '')}\n\n${fence(mem('bots', b.id, f))}\n`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf8');
const chk = fs.readFileSync(OUT, 'utf8');
console.log(JSON.stringify({ out: OUT, kb: Math.round(chk.length / 1024), dong: chk.split('\n').length, bots: bots.map((b) => b.name), nhom: !!room,
  fffd: (chk.match(/�/g) || []).length, bom: chk.charCodeAt(0) === 0xfeff }));
