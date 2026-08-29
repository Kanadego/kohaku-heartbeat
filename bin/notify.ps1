# 琥珀的心跳 · Windows 通知通道（toast）
# 用法：
#   notify.ps1 -Title "琥珀" -Message "正文..."        # 注册（如需）并发送通知
#   notify.ps1 -RegisterOnly                            # 只补注册，不发通知
#   notify.ps1 -Check                                   # 检查注册状态（存在性）
#
# 机制：桌面应用 toast 身份 = 开始菜单快捷方式(AppUserModelID) + HKCU 注册表 DisplayName。
# 本脚本自动检测缺失并注册（每台机器每用户一次，普通权限即可写 HKCU/%APPDATA%）。
# 发送用 WinRT ToastNotificationManager + 已注册 AUMID，不抢焦点、进通知中心。

param(
    [string]$Title = "琥珀的心跳",
    [string]$Message = "",
    [switch]$RegisterOnly,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$AUMID = 'KohakuHeartbeat.App'
$DisplayName = '琥珀的心跳'
$lnkDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnkPath = Join-Path $lnkDir 'KohakuHeartbeat.lnk'
$regPath = "HKCU:\Software\Classes\AppUserModelId\$AUMID"

# ── 注册检测 ───────────────────────────────────────────
function Test-Registered {
    $hasLnk = Test-Path $lnkPath
    $hasReg = (Test-Path $regPath) -and (Get-ItemProperty $regPath -Name DisplayName -ErrorAction SilentlyContinue)
    return ($hasLnk -and $hasReg)
}

# ── 注册（幂等）────────────────────────────────────────
function Register-AmberNotifier {
    New-Item -ItemType Directory -Force -Path $lnkDir | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
    $lnk.Arguments = "-NoProfile -Command Write-Host 'amber-heartbeat'"
    $lnk.Save()
    New-Item -Path $regPath -Force | Out-Null
    Set-ItemProperty -Path $regPath -Name DisplayName -Value $DisplayName
    Set-ItemProperty -Path $regPath -Name IconUri -Value "powershell.exe,0"
    Write-Host "REGISTERED: $AUMID"
}

# ── 发送 toast ─────────────────────────────────────────
function Send-AmberToast([string]$t, [string]$m) {
    $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
    $escT = [System.Security.SecurityElement]::Escape($t)
    $escM = [System.Security.SecurityElement]::Escape($m)
    $xml = "<toast><visual><binding template='ToastGeneric'><text>$escT</text><text>$escM</text></binding></visual></toast>"
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AUMID)
    $notifier.Show((New-Object Windows.UI.Notifications.ToastNotification $doc))
    Write-Host "TOAST_SENT: $t"
}

# ── 主流程 ─────────────────────────────────────────────
if ($Check) {
    if (Test-Registered) { Write-Host "REGISTERED: yes" } else { Write-Host "REGISTERED: no" }
    exit 0
}

if (-not (Test-Registered)) { Register-AmberNotifier }

if ($RegisterOnly) { exit 0 }

if ([string]::IsNullOrWhiteSpace($Message)) {
    Write-Host "ERROR: -Message required (或使用 -RegisterOnly / -Check)"
    exit 1
}

Send-AmberToast $Title $Message