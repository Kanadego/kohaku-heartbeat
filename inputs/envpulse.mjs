// 琥珀的心跳 · 环境温度计
// 信号：键鼠空闲秒数(经 idle.ps1，仅此一个数字) + 时段。
// 用途：温度计而非触发器——供反刍调整语气、gate 推迟打扰。
// 快照写入 kohaku\envpulse.json（只存当前态，无历史累积 → 天然满足 retention）。

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
import timeflow from './timeflow.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const IDLE_PS1 = path.join(ROOT, 'inputs', 'idle.ps1');
const HOME = dataHome();

export function presenceOf(idleSec) {
  if (idleSec < 0) return 'unknown';
  if (idleSec < 45) return 'active';    // 密集操作中：勿扰
  if (idleSec < 1800) return 'present'; // 在场轻活动
  return 'away';                        // 离开
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
  const t = timeflow(policy, now).context;

  const snapshot = {
    taken_at: now.toISOString(),
    idle_seconds: idle,
    presence: presenceOf(idle),
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
