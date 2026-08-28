#!/usr/bin/env node
// 琥珀的心跳 · 一键焚毁
// 用法：
//   node burn.mjs            -> 预演：列出将被焚毁的文件（不执行）
//   node burn.mjs --yes      -> 真焚：覆写x3 + 删除，不可恢复
//
// 隐私宪章最后一环：删文件 + 抹数据一步完成。焚毁后心跳失去全部记忆，
// 需重新初始化数据目录。此操作等价于"让琥珀失忆"，请慎重。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const HOME = dataHome();

const targets = [
  'seeds.json', 'sent.json', 'ledger.md',
  path.join('logs', 'heartbeat.jsonl'), path.join('logs', 'active_chat_log.md'),
  'drafts', 'profiles',
];

if (process.argv[2] !== '--yes') {
  console.log('=== 将被焚毁（预演，未执行）===');
  for (const t of targets) {
    const p = path.join(HOME, t);
    console.log(`${fs.existsSync(p) ? '[存在]' : '[无  ]'} ${p}`);
  }
  console.log('\n确认执行: node burn.mjs --yes');
} else {
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
     path.join(ROOT, 'bin', 'vault.ps1'), 'burn', '-home', HOME, '-yes'],
    { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
