# notify.ps1 — Thông báo về máy tính (Windows 11 toast) khi bot xong việc.
#
# Vì sao dùng WinRT trực tiếp: BurntToast không cài sẵn, cài từ gallery cần quyền + mạng.
# WinRT ToastNotification có sẵn trong Windows 11, không cần module nào.
#
# Dùng:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\notify.ps1 "Tiêu đề" "Nội dung"
#   powershell ... -File scripts\notify.ps1 -Status OK "GĐ19 ĐẠT" "46/46 PASS, build exit 0"

param(
    [Parameter(Position = 0)]
    [string]$Title = "Smart Locker",
    [Parameter(Position = 1)]
    [string]$Message = "Xong việc",
    [ValidateSet("OK", "FAIL", "INFO", "BLOCK")]
    [string]$Status = "INFO"
)

$ErrorActionPreference = "Stop"

# Đọc tiếng Việt đúng: console mặc định cp1252 làm hỏng chuỗi truyền vào.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scenario =
    switch ($Status) {
        "OK"    { "default" }
        "FAIL"  { "alarm" }
        "BLOCK" { "reminder" }
        default { "default" }
    }

# AppID riêng để toast hiện tên "Smart Locker · Team Bot" thay vì "Windows PowerShell".
# Đã đăng ký ở HKCU:\Software\Classes\AppUserModelId\PTIT.SmartLocker.TeamBot (DisplayName).
$appId = "PTIT.SmartLocker.TeamBot"

try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

    $safeTitle = [System.Security.SecurityElement]::Escape($Title)
    $safeMsg   = [System.Security.SecurityElement]::Escape($Message)

    $xml = @"
<toast scenario="$scenario">
  <visual>
    <binding template="ToastGeneric">
      <text>$safeTitle</text>
      <text>$safeMsg</text>
      <text placement="attribution">Smart Locker · Team Tinh Gọn</text>
    </binding>
  </visual>
  <audio src="ms-winsoundevent:Notification.Default"/>
</toast>
"@

    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)

    $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
    # Tag cố định để thông báo mới đè thông báo cũ, không đầy Action Center.
    $toast.Tag = "smartlocker"
    $toast.Group = "bot"

    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
    Write-Output "TOAST_OK"
} catch {
    # Fallback: hộp thoại luôn hoạt động dù toast bị tắt trong Settings.
    Write-Output "TOAST_FAIL: $($_.Exception.Message)"
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $tip = New-Object System.Windows.Forms.NotifyIcon
        $tip.Icon = [System.Drawing.SystemIcons]::Information
        $tip.Visible = $true
        $tip.ShowBalloonTip(8000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Info)
        Start-Sleep -Milliseconds 1500
        $tip.Dispose()
        Write-Output "BALLOON_OK"
    } catch {
        Write-Output "BALLOON_FAIL: $($_.Exception.Message)"
    }
}
