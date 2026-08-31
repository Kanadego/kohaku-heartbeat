# 琥珀的心跳 · 前台窗口轻量探针（v0.9.2）
# 用法：powershell -File frontwin.ps1 -out <tmp.json>
# 输出：{ process, rect, screen, title, captured_at } —— 只查前台窗口，秒级返回。
# 用途：gate 开口前**实时**探查（替代 2h 心跳快照），见 docs/busy-detection.md。
# 隐私：与 screenpulse 同边界——只采前台，标题/进程敏感，由 caller 加密/即焚。

param([string]$out)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Fw {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$scr = if ($bounds) { @([int]$bounds.Width, [int]$bounds.Height) } else { $null }

$h = [Fw]::GetForegroundWindow()
$row = @{ process = ''; title = ''; rect = $null; screen = $scr; captured_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffzzz') }
if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 512
    [Fw]::GetWindowText($h, $sb, 512) | Out-Null
    $row.title = $sb.ToString()
    $procPid = 0
    [Fw]::GetWindowThreadProcessId($h, [ref]$procPid) | Out-Null
    if ($procPid -gt 0) {
        try { $row.process = (Get-Process -Id $procPid -ErrorAction Stop).ProcessName } catch { $row.process = '' }
    }
    $r = New-Object Fw+RECT
    if ([Fw]::GetWindowRect($h, [ref]$r)) {
        $row.rect = @{ left = $r.Left; top = $r.Top; right = $r.Right; bottom = $r.Bottom }
    }
}
$json = $row | ConvertTo-Json -Compress -Depth 4
[IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding($false)))