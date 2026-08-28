# 琥珀的心跳 · 在场探针（隐私边界：仅输出空闲秒数这一个数字。
# 不知道用户在做什么、哪个窗口、任何内容——见 DESIGN.md 隐私宪章。）

param([string]$out)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IdleProbe {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static long IdleSeconds() {
    LASTINPUTINFO li = new LASTINPUTINFO();
    li.cbSize = (uint)Marshal.SizeOf(li);
    if (!GetLastInputInfo(ref li)) return -1;
    long tick = Environment.TickCount & 0x7FFFFFFF;   // 回绕保护(tom 教我的)
    long last = li.dwTime & 0x7FFFFFFF;
    return tick >= last ? (tick - last) / 1000 : 0;
  }
}
'@

$idle = [IdleProbe]::IdleSeconds()
[IO.File]::WriteAllText($out, $idle.ToString())
