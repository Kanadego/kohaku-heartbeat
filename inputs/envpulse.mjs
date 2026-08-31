// 琥珀的心跳 · 环境温度计（v0.9）
// 信号：键鼠空闲秒数(经 idle.ps1) + 前台窗口类别(busy-rules.json detector)。
// 用途：温度计而非触发器——供反刍调整语气、gate 推迟打扰。
// v0.9 判定规则（docs/busy-detection.md）：
//   - 键鼠两档：idle>=1200s → away/看电影(截图兜底)；30s~1200s → present
//   - 键鼠不参与繁忙判定：idle<30s 时忙闲由"前台窗口类别"裁决
//   - 窗口类别：busy(办公/IDE/终端/会议/全屏游戏) → active；其余 → present
// 快照写入 <dataHome>/envpulse.json（只存当前态，无历史累积 → 天然短 retention）。

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
import timeflow from './timeflow.mjs';
import { loadJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const IDLE_PS1 = path.join(ROOT, 'inputs', 'idle.ps1');
const HOME = dataHome();
const BUSY_RULES = path.join(ROOT, 'config', 'busy-rules.json');

/** 读取忙闲类别表（busy-rules.json），失败返回空表（不影响主流程） */
function loadBusyRules() {
  try {
    return JSON.parse(fs.readFileSync(BUSY_RULES, 'utf8'));
  } catch { return { busy: {}, idle: {} }; }
}

/** 前台进程名 → 忙闲类别：busy | idle | unknown */
function classifyProcess(procName, rules) {
  if (!procName) return 'unknown';
  const key = String(procName).toLowerCase().replace(/\.exe$/, '');
  if (rules.busy && key in rules.busy) return 'busy';
  if (rules.idle && key in rules.idle) return 'idle';
  return 'unknown';
}

/** 读取最近一次屏幕脉冲的前台进程名（screen.json 为 DPAPI 密文，自动解密） */
function readForegroundProcess() {
  try {
    const j = loadJson(path.join(HOME, 'screen.json'));
    return j?.process ?? null;
  } catch { return null; }
}

/** v0.9 在场判定：键鼠两档 + 窗口类别组合 */
export function presenceOf(idleSec, windowClass = 'unknown') {
  if (idleSec < 0) return 'unknown';
  if (idleSec >= 1200) return 'away';        // 离开/看电影（截图兜底区分）
  if (idleSec >= 30) return 'present';       // 30s~1200s 有输入 = 空闲
  // idle<30s：键鼠不判忙，忙闲交给窗口类别
  return windowClass === 'busy' ? 'active' : 'present';
}

function probeIdle() {
  const tmp = path.join(HOME, '.idle.tmp');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', IDLE_PS1, '-out', tmp],
    { stdio: 'ignore', timeout: 20000 });
  if (r.status !== 0 || !fs.existsSync(tmp)) return -1;
  const v = parseInt(fs.readFileSync(tmp, 'utf8').trim(), 10);
  fs.rmSync(tmp, { force: true });
  return Number.isNaN(v) ? -1 : v;
}

export default function collect(policy, now = new Date()) {
  const idle = probeIdle();
  const rules = loadBusyRules();
  const fgProc = readForegroundProcess();
  const windowClass = classifyProcess(fgProc, rules);
  const t = timeflow(policy, now).context;

  const snapshot = {
    taken_at: now.toISOString(),
    idle_seconds: idle,
    presence: presenceOf(idle, windowClass),
    window_class: windowClass,        // busy / idle / unknown
    fg_process: fgProc,
    daypart: t.daypart,
    weekday: t.weekday,
    is_weekend: t.is_weekend,
  };

  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(path.join(HOME, 'envpulse.json'), JSON.stringify(snapshot, null, 1));
  } catch { /* 温度计故障不阻塞心跳 */ }

  return { source: '环境', items: [], context: snapshot };
}

// CLI 入口：直接运行本文件 = 刷新快照并输出
if (process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url) {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));
  console.log(JSON.stringify(collect(policy).context));
}