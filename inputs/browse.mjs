// 琥珀的心跳 · 兴趣浏览流（定向追踪版；自由闲逛留待后续版本）
// 职责：按 watchlist 定期检查 npm 包版本 / GitHub releases，
//      发现「上次见过 -> 现在」的变化时产出候选素材。
// 纪律：
// - 内置节流：距上次成功检查不足 min_interval_ms 直接跳过（查询频率成文，朋友 AI 建议 A）
// - 首见只登记不产素材（避免初始化把旧闻当新闻）
// - 只 GET 公开资源；单个目标失败不影响其他
// - 状态经 lib/vault.mjs 加密落盘

import fs from 'node:fs';
import path from 'node:path';
import { loadJson, saveJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const WATCHLIST_FILE = path.join(ROOT, 'config', 'watchlist.json');
const HOME = dataHome();
const STATE_FILE = path.join(HOME, 'watch_state.json');

const MIN_INTERVAL_MS = 6 * 3600 * 1000;   // 6 小时一轮
const UA = { 'User-Agent': 'kohaku-heartbeat/0.2 (+local; personal companion)' };

async function checkNpm(name) {
  const r = await fetch(`https://registry.npmjs.org/${name}/latest`, { headers: UA });
  if (!r.ok) throw new Error(`npm ${r.status}`);
  const j = await r.json();
  return { version: j.version, seen: `npm:${j.version}` };
}

async function checkGithub(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { ...UA, Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null;               // 该仓库从未发 release
  if (!r.ok) throw new Error(`gh ${r.status}`);
  const j = await r.json();
  return { version: j.tag_name, seen: `gh:${j.tag_name}`, title: j.name || '' };
}

export default async function collect(_policy, now = new Date()) {
  const state = loadJson(STATE_FILE) ?? { targets: {}, last_check_at: 0 };

  // 节流：没到点就安静返回
  if (now.getTime() - state.last_check_at < MIN_INTERVAL_MS)
    return { source: '浏览', items: [],
      context: { skipped: 'interval',
        next_due: new Date(state.last_check_at + MIN_INTERVAL_MS).toISOString() } };

  let targets = [];
  try { targets = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')).targets ?? []; }
  catch { /* 清单缺失则本轮空跑 */ }

  const items = [], errors = [];
  for (const t of targets) {
    try {
      const info = t.type === 'npm' ? await checkNpm(t.name)
                 : t.type === 'github' ? await checkGithub(t.repo) : null;
      if (!info) continue;
      const prev = state.targets[t.id];
      if (prev && prev.seen !== info.seen)
        items.push({ text:
          `${t.note || t.id} 有更新：${prev.version} -> ${info.version}` +
          (info.title ? `（${info.title.slice(0, 60)}）` : ''), weight: 2 });
      state.targets[t.id] = info;                  // 首见仅登记，不当新闻
    } catch (e) {
      errors.push(`${t.id}: ${e.message}`);
    }
  }

  if (targets.length > 0 && errors.length < targets.length) {
    state.last_check_at = now.getTime();           // 至少部分成功才算查过
    saveJson(STATE_FILE, state);
  }

  return { source: '浏览', items,
    context: { checked: targets.length, updates: items.length, errors } };
}
