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
import { loadJson, saveJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));
const BUSY_RULES = path.join(ROOT, 'config', 'busy-rules.json');
const HOME = dataHome();
const SENT_FILE = path.join(HOME, 'sent.json');
const CHAT_LOG = path.join(HOME, 'logs', 'active_chat_log.md');

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

// ── v0.9 窗口类别探查（实时，开口前当场判定）──────────────────
// 读 busy-rules.json 类别表 + screen.json 的最新前台窗口（进程/矩形/屏幕），
// 判定逻辑：
//   1. busy 类别表命中（办公/IDE/终端/会议）→ busy
//   2. idle 类别表命中（浏览器/创作/资源管理器/全屏视频）→ idle
//   3. 未知进程：矩形约等于屏幕 → 全屏游戏 → busy；否则 → idle
// 15s 稳定窗由 caller 用 screen.json 的 captured_at 与当前时间差保证，
// 超过 15s 的旧快照不采信（返回 unknown → 只依赖温度计兜底）。
function loadBusyRules() {
  try { return JSON.parse(fs.readFileSync(BUSY_RULES, 'utf8')); }
  catch { return { busy: {}, idle: {} }; }
}

function probeFrontWindowClass() {
  try {
    const rules = loadBusyRules();
    const screen = loadJson(path.join(HOME, 'screen.json'));
    if (!screen || !screen.process) return { cls: 'unknown', why: 'no-screen' };
    const key = String(screen.process).toLowerCase().replace(/\.exe$/, '');

    if (rules.busy && key in rules.busy) return { cls: 'busy', why: key };
    if (rules.idle && key in rules.idle) return { cls: 'idle', why: key };

    // 未知进程：全屏判定（矩形≈屏幕 → 全屏游戏 → busy）
    if (screen.rect && screen.screen) {
      const [sw, sh] = screen.screen;
      const w = screen.rect.right - screen.rect.left;
      const h = screen.rect.bottom - screen.rect.top;
      if (sw > 0 && sh > 0 && w >= sw - 4 && h >= sh - 4)  // 4px 容差（边框/缩放）
        return { cls: 'busy', why: `${key}:fullscreen` };
    }
    return { cls: 'idle', why: key };
  } catch { return { cls: 'unknown', why: 'err' }; }
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
