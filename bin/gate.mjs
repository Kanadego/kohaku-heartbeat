#!/usr/bin/env node
// 琥珀的心跳 · 分寸闸门
// 用法：
//   node gate.mjs pick                 -> 判定本轮可否表达（OK / SILENT: 原因）
//   node gate.mjs confirm <kind> <summary> -> 表达成功后登记（原子写）
//   node gate.mjs status               -> 今日状态
//
// 纪律（DESIGN.md §5）：
//   1. 判定前强制重读磁盘发送记录（不信内存）
//   2. 判定与写入在同一同步代码块内完成
//   3. 发送记录用 tmp+rename 原子替换
// 本脚本永不输出进程名/窗口标题等敏感信息（隐私宪章）。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadJson, saveJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));
const BUSY_RULES = path.join(ROOT, 'config', 'busy-rules.json');
const FRONTWIN_PS1 = path.join(ROOT, 'inputs', 'frontwin.ps1');
const HOME = dataHome();
const SENT_FILE = path.join(HOME, 'sent.json');
const CHAT_LOG = path.join(HOME, 'logs', 'active_chat_log.md');
const STABLE_MS = 15000;  // 15s 稳定窗：快照过老不采信（v0.9.2）

const readSent = () => {
  // 重读纪律：每次都从磁盘取最新（密文自动解密，明文兼容）
  const s = loadJson(SENT_FILE);
  const today = new Date().toISOString().slice(0, 10);
  return (s && s.today === today) ? s : { today, items: [] };
};

const atomicWriteSent = (sent) => {
  saveJson(SENT_FILE, sent);   // DPAPI 密文 + 内部原子替换(v0.1)
};

const inQuietHours = (d = new Date()) => {
  const q = POLICY.quiet_hours;
  const mins = d.getHours() * 60 + d.getMinutes();
  const [sh, sm] = q.start.split(':').map(Number);
  const [eh, em] = q.end.split(':').map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  return start > end ? (mins >= start || mins < end) : (mins >= start && mins < end);
};

// ── v0.9.2 窗口类别探查（开口前实时判定）───────────────────
// 实时性修复（tamako 评审 A）：原实现读 2h 心跳快照 screen.json，
// 主人刚切窗口时会误判。现流程：
//   1. 实时调 frontwin.ps1 轻量探针（秒级）→ 用实时数据分类；
//   2. 探针失败时退回 screen.json 快照，但检查 captured_at 年龄
//      （>15s 稳定窗视为过期 → unknown，由温度计兜底）。
// 分类逻辑：busy 表优先 → idle 表 → 未知进程按全屏判定。
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function loadBusyRules() {
  try { return JSON.parse(fs.readFileSync(BUSY_RULES, 'utf8')); }
  catch { return { busy: {}, idle: {} }; }
}

function classifyWindow(info, rules) {
  if (!info || !info.process) return { cls: 'unknown', why: 'no-process' };
  const key = String(info.process).toLowerCase().replace(/\.exe$/, '');
  if (own(rules.busy, key)) return { cls: 'busy', why: key };
  if (own(rules.idle, key)) return { cls: 'idle', why: key };
  if (info.rect && info.screen) {
    const [sw, sh] = info.screen;
    const w = info.rect.right - info.rect.left;
    const h = info.rect.bottom - info.rect.top;
    if (sw > 0 && sh > 0 && w >= sw - 4 && h >= sh - 4)
      return { cls: 'busy', why: `${key}:fullscreen` };
  }
  return { cls: 'idle', why: key };
}

/** 实时探针：跑 frontwin.ps1 拿当下前台窗口（秒级） */
function probeFrontWindowLive() {
  try {
    const tmp = path.join(HOME, '.frontwin.tmp');
    const r = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', FRONTWIN_PS1, '-out', tmp],
      { stdio: 'ignore', timeout: 10000 });
    if (r.status !== 0 || !fs.existsSync(tmp)) return null;
    const raw = fs.readFileSync(tmp, 'utf8');
    fs.rmSync(tmp, { force: true });
    return JSON.parse(raw);
  } catch { return null; }
}

/** 兜底：screen.json 快照 + 年龄检查（>15s 不采信） */
function probeFrontWindowSnapshot() {
  try {
    const screen = loadJson(path.join(HOME, 'screen.json'));
    if (!screen || !screen.process) return { cls: 'unknown', why: 'no-screen', source: 'snapshot' };
    const age = Date.now() - Date.parse(screen.captured_at || 0);
    if (!Number.isFinite(age) || age > STABLE_MS)
      return { cls: 'unknown', why: `snapshot-stale(${Math.round(age / 1000)}s)`, source: 'snapshot' };
    const info = { process: screen.process, rect: screen.rect, screen: screen.screen };
    return { ...classifyWindow(info, loadBusyRules()), source: 'snapshot' };
  } catch { return { cls: 'unknown', why: 'err', source: 'snapshot' }; }
}

function probeFrontWindowClass() {
  const rules = loadBusyRules();
  const live = probeFrontWindowLive();
  if (live) {
    const c = classifyWindow(live, rules);
    return { ...c, source: 'live' };
  }
  return probeFrontWindowSnapshot();  // 实时失败 → 快照 + 年龄检查
}

function pick() {
  // 重读纪律：每次判定都从磁盘取最新
  const sent = readSent();
  const now = new Date();

  if (inQuietHours(now)) return console.log('SILENT: quiet hours');

  // v0.9 窗口类别探查（实时）：busy 类 → 勿扰
  const fw = probeFrontWindowClass();
  if (fw.cls === 'busy')
    return console.log(`SILENT: busy window (${fw.why})`);

  // 温度计联动（快照兜底）：主人离散输入中 -> 勿扰
  try {
    const env = loadJson(path.join(HOME, 'envpulse.json'));
    if (env && env.presence === 'active')
      return console.log(`SILENT: master actively typing (idle ${env.idle_seconds}s)`);
  } catch { /* 温度计缺席不阻塞判定 */ }

  if (sent.items.length >= POLICY.max_daily_send)
    return console.log(`SILENT: daily cap reached (${POLICY.max_daily_send})`);
  if (sent.items.length > 0) {
    const last = sent.items[sent.items.length - 1].ts;
    const leftMs = POLICY.cooldown_minutes * 60000 - (now.getTime() - last);
    if (leftMs > 0)
      return console.log(`SILENT: cooldown ${Math.ceil(leftMs / 60000)}min left`);
  }
  console.log(JSON.stringify({ ok: true, sent_today: sent.items.length,
    cap: POLICY.max_daily_send, window: fw }));
}

function confirm(kind, summary) {
  if (!kind || !summary) return console.log('ERROR: usage: confirm <kind> <summary|->');
  // summary 为 "-" 时从 stdin 读 UTF-8（规避 PS5.1 参数 GBK 乱码）
  if (summary === '-') {
    try { summary = fs.readFileSync(0, 'utf8').trim(); } catch { return console.log('ERROR: no stdin'); }
  }
  // 同步临界区：重读→写记录→追加日志，一气呵成
  const sent = readSent();
  const now = new Date();

  if (inQuietHours(now)) return console.log('REFUSED: quiet hours');
  if (sent.items.length >= POLICY.max_daily_send)
    return console.log('REFUSED: daily cap reached');

  sent.items.push({ ts: now.getTime(), iso: now.toISOString(), kind,
    summary: String(summary).slice(0, 80) });
  atomicWriteSent(sent);

  fs.mkdirSync(path.dirname(CHAT_LOG), { recursive: true });
  fs.appendFileSync(CHAT_LOG,
    `- ${now.toTimeString().slice(0, 5)} [${kind}] ${String(summary).replace(/\n/g, ' ')}\n`,
    'utf8');
  console.log(`CONFIRMED: ${sent.items.length} today`);
}

if (process.argv[2] === 'pick') pick();
else if (process.argv[2] === 'confirm') confirm(process.argv[3], process.argv.slice(4).join(' '));
else if (process.argv[2] === 'status') {
  const s = readSent();
  console.log(`today=${s.today} sent=${s.items.length}/${POLICY.max_daily_send} quiet=${inQuietHours()}`);
} else console.log('usage: gate.mjs pick | confirm <kind> <summary> | status');
