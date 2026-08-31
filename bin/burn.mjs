#!/usr/bin/env node
// 琥珀的心跳 · 一键焚毁
// 用法：
//   node burn.mjs            -> 预演：列出将被焚毁的文件（不执行）
//   node burn.mjs --yes      -> 真焚：覆写x3 + 删除，不可恢复
//
// 隐私宪章最后一环：删文件 + 抹数据一步完成。焚毁后心跳失去全部记忆，
// 需重新初始化数据目录。此操作等价于"让琥珀失忆"，请慎重。
// 焚毁清单单一事实源：lib/burn-list.mjs（与 vault.ps1 共用，防两份漂移）。

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, dataHome } from '../lib/paths.mjs';
import { BURN_TARGETS, renderBurnList } from '../lib/burn-list.mjs';

const ROOT = repoRoot();
const HOME = dataHome();

if (process.argv[2] !== '--yes') {
  console.log('=== 将被焚毁（预演，未执行）===');
  for (const t of BURN_TARGETS) {
    const p = path.join(HOME, t);
    console.log(`${fs.existsSync(p) ? '[存在]' : '[无  ]'} ${p}`);
  }
  console.log('\n确认执行: node burn.mjs --yes');
} else {
  // 清单文件：burn.mjs 与 vault.ps1 共享同一数据源，避免两份硬编码漂移
  const listFile = path.join(HOME, '.burn-list.tmp');
  fs.writeFileSync(listFile, renderBurnList(HOME), 'utf8');
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
     path.join(ROOT, 'bin', 'vault.ps1'), 'burn', '-home', HOME, '-list', listFile, '-yes'],
    { stdio: 'inherit' });
  fs.rmSync(listFile, { force: true });
  process.exit(r.status ?? 1);
}