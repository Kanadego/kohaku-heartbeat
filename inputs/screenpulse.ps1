# 琥珀的心跳 · 屏幕脉冲采集（v0.4）
# 采集：前台窗口标题 + 前台进程名 + 全屏截图（降采样至 1024 宽）
# 输出（明文中间产物，交由 screenpulse.mjs 加密后入库）：
#   <outdir>\screen.raw.json   { title, process, shot_path, captured_at }
#   <outdir>\screen.raw.jpg    降采样后的截图
#
# 隐私纪律（DESIGN.md 隐私宪章 + 用户授权）：
#   - 只采集前台窗口，不枚举全部窗口
#   - 截图强制降采样至宽 1024（细节足够判断氛围，小字已糊）
#   - 本脚本只产出临时明文，不留存；落盘加密由 caller 负责
#   - 进程名与标题文本敏感，经 DPAPI 加密后入库（防文件标题泄密）

param(
    [string]$outdir
)

$ErrorActionPreference = 'Stop'
if (-not $outdir) { $outdir = Join-Path $env:USERPROFILE '.kohaku_tmp' }
New-Item -ItemType Directory -Path $outdir -Force | Out-Null

# ── 1. 前台窗口标题 + 进程 ──────────────────────────────
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@

$title = ''
$procName = ''
$pid_ = 0
$h = [WinForeground]::GetForegroundWindow()
if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 512
    [WinForeground]::GetWindowText($h, $sb, 512) | Out-Null
    $title = $sb.ToString()
    $procPid = 0
    [WinForeground]::GetWindowThreadProcessId($h, [ref]$procPid) | Out-Null
    if ($procPid -gt 0) {
        $pid_ = [int]$procPid
        try { $procName = (Get-Process -Id $procPid -ErrorAction Stop).ProcessName } catch { $procName = '' }
    }
}

# ── 2. 全屏截图 + 降采样至 1024 宽（失败则降级为仅文字信号）──────
$shotPath = ''
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($null -eq $bounds -or $bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'no desktop' }
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $g.Dispose()

    # 降采样：目标宽 1024，等比缩放高度
    $sw = 1024
    $sh = [int]([math]::Round($bounds.Height * ($sw / [double]$bounds.Width)))
    if ($sh -le 0) { throw 'bad resize' }
    $small = New-Object System.Drawing.Bitmap $sw, $sh
    $sg = [System.Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($bmp, 0, 0, $sw, $sh)
    $sg.Dispose()
    $bmp.Dispose()

    $shotPath = Join-Path $outdir 'screen.raw.jpg'
    $small.Save($shotPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $small.Dispose()
} catch {
    Write-Warning "screen shot skipped: $($_.Exception.Message)"
    # 降级：无截图，仅文字信号
}

$meta = @{
    title       = $title
    process     = $procName
    pid         = $pid_
    shot_path   = $shotPath
    captured_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffzzz')
} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $outdir 'screen.raw.json'), $meta, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "SCREENPULSE_OK title='$title' process='$procName' shot=${sw}x${sh}"