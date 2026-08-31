# 琥珀的心跳 · 屏幕脉冲采集（v0.9）
# 采集：前台窗口标题 + 前台进程名 + 全屏截图（降采样至 1024 宽）
#       前台窗口矩形（全屏判定）+ 焦点窗口（实时活跃）+ 可见窗口列表（任务栏级 ≤20）
# 输出（明文中间产物，交由 screenpulse.mjs 加密后入库）：
#   <outdir>\screen.raw.json   { title, process, rect, focus, windows[], shot_path, captured_at }
#   <outdir>\screen.raw.jpg    降采样后的截图
#
# 隐私纪律（DESIGN.md 隐私宪章 + 用户授权 v0.9）：
#   - 可见窗口级枚举（EnumWindows + IsWindowVisible，≤20），不采托盘、不枚举进程
#   - 截图强制降采样至宽 1024（细节足够判断氛围，小字已糊）
#   - 本脚本只产出临时明文，不留存；落盘加密由 caller 负责
#   - 进程名与标题文本敏感，经 DPAPI 加密后入库（防文件标题泄密）

param(
    [string]$outdir
)

$ErrorActionPreference = 'Stop'
if (-not $outdir) { $outdir = Join-Path $env:USERPROFILE '.kohaku_tmp' }
New-Item -ItemType Directory -Path $outdir -Force | Out-Null

# ── 1. 前台窗口标题 + 进程 + 矩形 + 焦点 + 可见窗口 ─────────
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;

public static class WinForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  // 返回值=线程 ID；out 参数=进程 ID
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize;
    public uint flags;
    public IntPtr hwndActive;
    public IntPtr hwndFocus;
    public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner;
    public IntPtr hwndMoveSize;
    public IntPtr hwndCaret;
    public RECT rcCaret;
  }

  public static List<IntPtr> VisibleTopLevel() {
    var list = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  // 返回前台窗口所属线程的焦点窗口句柄（不受限，线程自属窗口）
  public static IntPtr FocusWindowOf(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return IntPtr.Zero;
    uint pid = 0;
    uint tid = GetWindowThreadProcessId(hwnd, out pid);
    if (tid == 0) return IntPtr.Zero;
    GUITHREADINFO g = new GUITHREADINFO();
    g.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    if (!GetGUIThreadInfo(tid, ref g)) return IntPtr.Zero;
    return g.hwndFocus == IntPtr.Zero ? hwnd : g.hwndFocus;  // 无焦点窗口时退回前台窗口
  }
}
'@

# 工具函数：窗口句柄 -> { title, process }
function Get-WinInfo([IntPtr]$h) {
    $sb = New-Object System.Text.StringBuilder 512
    [WinForeground]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    $p = ''
    $procPid = 0
    [WinForeground]::GetWindowThreadProcessId($h, [ref]$procPid) | Out-Null
    if ($procPid -gt 0) {
        try { $p = (Get-Process -Id $procPid -ErrorAction Stop).ProcessName } catch { $p = '' }
    }
    return @{ title = $t; process = $p; pid = [int]$procPid }
}

$h = [WinForeground]::GetForegroundWindow()
$fg = @{ title = ''; process = ''; pid = 0; rect = $null }
if ($h -ne [IntPtr]::Zero) {
    $info = Get-WinInfo $h
    $fg.title = $info.title; $fg.process = $info.process; $fg.pid = $info.pid
    $r = New-Object WinForeground+RECT
    if ([WinForeground]::GetWindowRect($h, [ref]$r)) {
        $fg.rect = @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
    }
}

# 焦点窗口（前台线程的焦点句柄——具体活跃子窗口）
$focusH = [WinForeground]::FocusWindowOf($h)
$focus = @{ title = ''; process = ''; pid = 0 }
if ($focusH -ne [IntPtr]::Zero -and $focusH -ne $h) {
    $fi = Get-WinInfo $focusH
    $focus.title = $fi.title; $focus.process = $fi.process; $focus.pid = $fi.pid
}

# 可见窗口列表（任务栏级，≤20，去重前台/焦点）
$visible = @()
$cap = 20
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($w in [WinForeground]::VisibleTopLevel()) {
    if ($visible.Count -ge $cap) { break }
    if ($w -eq $h -or $w -eq $focusH) { continue }   # 前台/焦点已单独采
    $wi = Get-WinInfo $w
    if (-not $wi.title -and -not $wi.process) { continue }  # 无信息的顶层壳跳过
    $key = "$($wi.pid):$($wi.title)"
    if (-not $seen.Add($key)) { continue }                  # 同进程同标题去重
    $visible += @{ title = $wi.title; process = $wi.process; pid = $wi.pid }
}

# ── 2. 全屏截图 + 降采样至 1024 宽（失败则降级为仅文字信号）──────
$shotPath = ''
$scr = $null
try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    if ($null -eq $bounds -or $bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'no desktop' }
    $scr = @([int]$bounds.Width, [int]$bounds.Height)
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
    title       = $fg.title
    process     = $fg.process
    pid         = $fg.pid
    rect        = $fg.rect
    screen      = $scr  # 屏幕工作区尺寸（全屏判定用）：@(width, height)
    focus       = $focus
    windows     = $visible
    shot_path   = $shotPath
    captured_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffzzz')
} | ConvertTo-Json -Compress -Depth 5
[IO.File]::WriteAllText((Join-Path $outdir 'screen.raw.json'), $meta, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "SCREENPULSE_OK title='$($fg.title)' process='$($fg.process)' shot=${sw}x${sh} focus='$($focus.title)' windows=$($visible.Count)"