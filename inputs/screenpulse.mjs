#!/usr/bin/env node
// 琥珀的心跳 · 屏幕脉冲入口（v0.4）
// 用法（经心跳或手动触发）：
//   node inputs/screenpulse.mjs        （在仓库根下运行）
//
// 流程：调 screenpulse.ps1 采集(标题/进程/截图1024宽) -> 加密入库 -> 焚毁明文
// 产出（全部 DPAPI 加密，KHBV1 头）：
//   <dataHome>/screen.json   前台标题/进程/时间（敏感，加密）
//   <dataHome>/screen.jpg    降采样截图（敏感，加密）
// 保留策略：每次采集覆盖上一张（只存"当前状态"快照，天然满足短 retention）

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptFile, isEncrypted } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const PULSE_PS1 = path.join(ROOT, 'inputs', 'screenpulse.ps1');
const HOME = dataHome();
const TMP = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'khak-screen-'));

const main = () => {
  // 1. 采集：明文中间产物进临时目录
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PULSE_PS1, '-outdir', TMP],
    { stdio: 'ignore', timeout: 60000 });
  if (r.status !== 0) {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log('SCREENPULSE_FAIL: collect error');
    process.exit(1);
  }

  // 2. 读元数据 + 加密产物（截图可能缺失=ps1 降级；json 必有）
  const metaRaw = fs.readFileSync(path.join(TMP, 'screen.raw.json'), 'utf8');
  const meta = JSON.parse(metaRaw);
  const shotSrc = path.join(TMP, 'screen.raw.jpg');
  const hasShot = fs.existsSync(shotSrc);

  // 截图空间检查：本就不应特大（1024宽 JPEG），防御性上限防异常
  let shotBytes = 0;
  if (hasShot) {
    shotBytes = fs.statSync(shotSrc).size;
    if (shotBytes > 2 * 1024 * 1024) {
      fs.rmSync(TMP, { recursive: true, force: true });
      console.log('SCREENPULSE_REFUSED: shot too large');
      process.exit(1);
    }
  }

  const encJson = path.join(HOME, 'screen.json');
  const encShot = path.join(HOME, 'screen.jpg');
  encryptFile(path.join(TMP, 'screen.raw.json'), encJson);
  if (hasShot) encryptFile(shotSrc, encShot);
  else if (fs.existsSync(encShot)) fs.rmSync(encShot); // 旧截图清理（本次无新图）

  // 3. 焚毁明文中间产物
  fs.rmSync(TMP, { recursive: true, force: true });

  console.log(JSON.stringify({ ok: true, title: meta.title,
    process: meta.process, shot_bytes: shotBytes,
    json_enc: isEncrypted(encJson),
    jpg_enc: hasShot ? isEncrypted(encShot) : 'absent',
    captured_at: meta.captured_at }));
};

main();