# tooling

- The user checks the Smart Locker code in the Antigravity IDE; its Java Language Server keeps a stale index and reports false 'cannot be resolved' errors, so IDE errors must be confirmed with a real mvnw compile/test and npm run build before anything is fixed.
- PowerShell 5.1's Invoke-WebRequest decodes UTF-8 responses wrongly and reports false mojibake (e.g. 'Vite still serves the old text'); responses must be checked via raw bytes instead.
- The user's home Wi-Fi DNS (123.23.23.23) did not resolve tile.openstreetmap.org; it was switched to 1.1.1.1/1.0.0.1 and tiles now load, so blank Leaflet maps should first be checked for DNS rather than code.
- The Bot has no Administrator rights on the user's Windows machine, so system changes (e.g. Set-DnsClientServerAddress) must be handed to the user as exact commands to run in an elevated PowerShell.
- User muốn mỗi lần hoàn thành việc (sửa xong, bật dự án, nghiệm thu xong, hoặc phải chờ quyết) thì bắn thông báo desktop: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\notify.ps1 -Status OK "Tiêu đề" "Nội dung ngắn"` — WinRT toast, AppID PTIT.SmartLocker.TeamBot.
