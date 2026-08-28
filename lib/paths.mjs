// 琥珀的心跳 · 路径单一事实来源
// 用法：
//   import { dataHome } from '../lib/paths.mjs'
//   const HOME = dataHome();          // 数据目录（可被 KOHAKU_HOME 覆盖）
//   const ROOT = repoRoot();          // 仓库根（自动定位，无需改动）
//
// 隐私/可移植说明：仓库内不得写死任何绝对路径（D:\... 等）。
// 数据目录的默认值 = 用户主目录下的 .kohaku（跨机器通用）；
// 想换位置设环境变量 KOHAKU_HOME 即可（与 vault/seeds/gate 全链路一致）。

import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

/** 仓库根目录（自动定位：本文件位于 <root>/lib/） */
export const repoRoot = () =>
  path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

/**
 * 数据目录：优先环境变量 KOHAKU_HOME；
 * 未设置时默认 <repo>/../kohaku-data（跟随仓库的旁置数据目录）。
 * 说明：不落主目录，避开部分受限环境对 ~ 的写保护；部署文档会建议显式设置。
 */
export const dataHome = () =>
  process.env.KOHAKU_HOME || path.join(repoRoot(), '..', 'kohaku-data');