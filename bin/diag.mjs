#!/usr/bin/env node
// 琥珀的心跳 · 诊断体检单（diag）
// 用法：node bin/diag.mjs
// 作用：把分散在多个脚本/文件里的诊断信息汇总成一张 PASS/FAIL 体检单，
//       排查任何问题第一步跑它，定位问题在哪一层（宿主/数据/网络/判定）。
// 设计原则：只读不改、不加采集面、不依赖新功能——纯粹汇总已有信息。
// 每项输出格式：✓ 正常 / ✗ 异常 / · 中性信息

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadJson, isEncrypted } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const HOME = dataHome();
const BUSY_RULES = path.join(ROOT, 'config', 'busy-rules.json');
const INTERESTS = path.join(ROOT, 'config', 'interests.json');
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));

let pass = 0, fail = 0, info = 0;
const ok = (s) => { pass++; console.log(`  ✓ ${s}`); };
const bad = (s) => { fail++; console.log(`  ✗ ${s}`); };
const inf = (s) => { info++; console.log(`  · ${s}`); };

const exists = (p) => fs.existsSync(p);
const humane = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
};

console.log(`\n== 琥珀的心跳 · 诊断体检单 ==`);
console.log(`HOME: ${HOME}  ROOT: ${ROOT}\n`);

// ── 1. 环境链路：idle → presence → 前台窗口类别 ─────────────
console.log('[环境链路]');
try {
  const env = loadJson(path.join(HOME, 'envpulse.json'));
  if (env) {
    inf(`idle=${env.idle_seconds ?? '?'}s → presence=${env.presence} window_class=${env.window_class ?? '?'} fg=${env.fg_process ?? '?'}`);
    if (env.presence === 'away') inf('presence=away（≥20min 无输入：离开或看电影）');
  } else bad('envpulse.json 缺失或不可解');
} catch { bad('envpulse.json 读取失败'); }

try {
  const rules = JSON.parse(fs.readFileSync(BUSY_RULES, 'utf8'));
  inf(`busy-rules 可读：busy ${Object.keys(rules.busy ?? {}).length} 项 / idle ${Object.keys(rules.idle ?? {}).length} 项`);
} catch { bad('busy-rules.json 不可读'); }

// gate 实时探针链路（不改变任何状态）
try {
  const tmp = path.join(HOME, '.diag-fw.tmp');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'inputs', 'frontwin.ps1'), '-out', tmp],
    { stdio: 'ignore', timeout: 10000 });
  if (r.status === 0 && exists(tmp)) {
    const fw = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.rmSync(tmp, { force: true });
    inf(`前台实时探针：process=${fw.process || '(空)'} captured=${fw.captured_at?.slice(11, 19) || '?'}`);
  } else bad('frontwin.ps1 实时探针失败');
} catch { bad('frontwin.ps1 实时探针异常'); }

// ── 2. 宿主装配（schedule / time-context）───────────────
console.log('\n[宿主装配]');
try {
  const log = fs.readFileSync(path.join(HOME, 'logs', 'heartbeat.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
  const last = log.length ? JSON.parse(log[log.length - 1]) : null;
  inf(`heartbeat.jsonl ${log.length} 行；最近一条：${last ? `${last.decision}（${(last.reason || '').slice(0, 40)}）` : '空'}`);
  if (log.length === 0) inf('尚无心跳记录（首次部署？）');
} catch { bad('heartbeat.jsonl 不可读'); }

// ── 3. 数据完整性 ───────────────────────────────────────
console.log('\n[数据完整性]');
const dataFiles = ['seeds.json', 'sent.json', 'ledger.md', 'screen.json', 'envpulse.json'];
for (const f of dataFiles) {
  const p = path.join(HOME, f);
  if (!exists(p)) { inf(`${f} 不存在（正常：首次部署或未生成）`); continue; }
  const enc = isEncrypted(p);
  const kb = Math.round(fs.statSync(p).size / 1024 * 10) / 10;
  inf(`${f} ${kb}KB ${enc ? '(密文 ✓)' : '(明文)'}`);
}
try {
  const seeds = loadJson(path.join(HOME, 'seeds.json'));
  if (seeds) inf(`seeds 可解：alive=${(seeds.items ?? []).filter(s => !s.retired).length} / total=${seeds.seq ?? 0}`);
  else bad('seeds.json 解密失败或损坏');
} catch { bad('seeds.json 解密异常'); }
try {
  const s = loadJson(path.join(HOME, 'sent.json'));
  if (s) inf(`sent 可解：today=${s.today} items=${(s.items ?? []).length}`);
  else inf('sent.json 解密失败或为空');
} catch { bad('sent.json 解密异常'); }

// ── 4. 抓取与网络 ──────────────────────────────────────
console.log('\n[抓取网络]');
try {
  const py = spawnSync('py', ['-3', '-c', 'print(1)'], { stdio: 'ignore', timeout: 10000 });
  py.status === 0 ? ok('Python (py -3) 可用') : bad('Python 不可用（浏览流·闲逛通道会空手）');
} catch { bad('Python 探测异常'); }
const browseLog = path.join(HOME, 'logs', 'browse.log');
if (exists(browseLog)) {
  const lines = fs.readFileSync(browseLog, 'utf8').trim().split('\n').filter(Boolean);
  const tail = lines.slice(-3).join('\n      ');
  inf(`browse.log ${lines.length} 行；最近：\n      ${tail}`);
} else {
  inf('browse.log 不存在（闲逛尚未跑过或未失败过）');
}

// ── 5. 卫生与安全 ──────────────────────────────────────
console.log('\n[卫生安全]');
const orphanPatterns = ['.khv-', '.browse-', '.frontwin', '.diag-', '.burn-list', '.idle.'];
const allHome = fs.readdirSync(HOME, { withFileTypes: true });
const orphans = allHome.filter(d => d.isFile() && orphanPatterns.some(p => d.name.includes(p)));
orphans.length === 0 ? ok('无临时文件残留') : bad(`发现临时残留：${orphans.map(d => d.name).join(', ')}`);

// 写入权检查：kohaku-data 可写？
try {
  const probe = path.join(HOME, '.diag-write.tmp');
  fs.writeFileSync(probe, 'ok');
  fs.rmSync(probe, { force: true });
  ok('kohaku-data 可写');
} catch { bad('kohaku-data 不可写（心跳会无法落盘！）'); }

// 时间感知档位（对照 busy-rules/policy 无，但从 heartbeats 推导）
console.log('\n[配置摘要]');
inf(`policy: max_daily_send=${POLICY.max_daily_send} cooldown=${POLICY.cooldown_minutes}m quiet=${POLICY.quiet_hours.start}-${POLICY.quiet_hours.end}`);
try {
  const it = JSON.parse(fs.readFileSync(INTERESTS, 'utf8'));
  inf(`interests: ${(it.interests ?? []).length} 种子，窗口 ${(it._schedule?.windows ?? []).map(w => w.start + '-' + w.end).join('/') || '无'}`);
} catch { bad('interests.json 不可读'); }

// ── 汇总 ───────────────────────────────────────────────
console.log(`\n== 体检结果：${pass} 正常 / ${fail} 异常 / ${info} 中性 ==`);
if (fail === 0) console.log('一切正常，心跳链路健康。');
else console.log(`有 ${fail} 项异常，见上方 ✗ 标记——通常先看[数据完整性]与[宿主装配]。`);
process.exit(fail ? 1 : 0);