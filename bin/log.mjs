#!/usr/bin/env node
// 琥珀的心跳 · 决策日志（透明度审计用）
// 用法：
//   node log.mjs append <decision> <reason> [detail]   追加一条决策记录
//   node log.mjs clean                                 按 retention 清理旧行
//
// 隐私宪章：本日志只记决策类型/理由/主题类别，永不记录进程名、窗口标题等原始观测。

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));
const HOME = dataHome();
const LOG_FILE = path.join(HOME, 'logs', 'heartbeat.jsonl');

const cmd = process.argv[2];

function main() {
if (cmd === 'append') {
  const [decision, reason, detail = ''] = process.argv.slice(3);
  if (!decision || !reason) { console.log('ERROR: append <decision> <reason> [detail]'); return; }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const line = JSON.stringify({ ts: Date.now(),
    iso: new Date().toISOString(), decision, reason,
    detail: String(detail).slice(0, 120) });
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log('LOGGED');
}

else if (cmd === 'clean') {
  if (!fs.existsSync(LOG_FILE)) { console.log('NO_LOG'); return; }
  const cutoff = Date.now() - POLICY.log_retention_days * 86400000;
  const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const keep = lines.filter(l => { try { return JSON.parse(l).ts >= cutoff; } catch { return false; } });
  fs.writeFileSync(LOG_FILE, keep.length ? keep.join('\n') + '\n' : '', 'utf8');
  console.log(`CLEAN: ${lines.length - keep.length} removed, ${keep.length} kept`);
}

else console.log('usage: log.mjs append <decision> <reason> [detail] | clean');
}

main();
