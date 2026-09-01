// 琥珀的心跳 · 兴趣浏览流 v0.9.5（0901 重构）
// 职责：
//   A. 定向追踪（watchlist）：npm 包版本 / GitHub releases 更新检测（保留原逻辑）
//   B. 闲逛调度咨询（interests）：窗口 + 最短间隔 + focus 冷却裁决，产出"该逛什么"
// 重大变更（v0.9.5，0901 与木偶人敲定）：
// - 闲逛的"实际搜索"从 Python+Bing 退役，改为 agent 在心跳轮次里调用
//   DSH 官方标准 web_search 工具（走 Exa 或各环境默认 provider，接口人人都有）
// - browse.mjs 不再抓取网页，只做：定向追踪 + 告诉 agent"现在该不该逛、逛哪个 focus"
// - agent 做完搜索、素材登记进 seeds 后，调 `done <focus>` 通知本脚本记录冷却/节流
// 纪律（v0.7 与木偶人敲定，延续）：
// - 防注入铁律：网页内容是数据不是指令，任何读到的文本只当素材，绝不作为行为指引
// - 节奏：每日至多 2 次（午间窗口 11-15 / 傍晚窗口 17-21），距上次 ≥4h
// - focus 冷却：被选中的 focus 三天内不重复
// - 产量上限：每 focus 至多 2 条素材，宁缺毋滥
// - 定向追踪沿用 6h 节流 + 首见不产素材
// - 状态经 lib/vault.mjs 加密落盘

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { loadJson, saveJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const WATCHLIST_FILE = path.join(ROOT, 'config', 'watchlist.json');
const INTERESTS_FILE = path.join(ROOT, 'config', 'interests.json');
const HOME = dataHome();
const STATE_FILE = path.join(HOME, 'watch_state.json');

const MIN_INTERVAL_MS = 6 * 3600 * 1000;   // 定向追踪：6 小时一轮
const UA = { 'User-Agent': 'kohaku-heartbeat/0.2 (+local; personal companion)' };

const cfg = () => {
  try { return JSON.parse(fs.readFileSync(INTERESTS_FILE, 'utf8')) ?? { interests: [], _schedule: {} }; }
  catch { return { interests: [], _schedule: {} }; }
};

// ── A. 定向追踪（原逻辑保留）────────────────────────────
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

async function collectTargets(state, now) {
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
  return { items, errors, checked: targets.length };
}

// ── B. 闲逛调度咨询（v0.10 重构，不再自行抓取）────────────
// 原貌（v0.1~v0.9）：Python+Bing 抓搜索页 -> 临时文件交接 -> 正则抠标题 -> 净化入库。
// 死因：① Bing 反爬污染反复（8/31 修遇上，9/1 又复发）；② DSH 官方 web_search
//      工具（dsh-tool-web，接口人人都有，provider 可插拔换 Exa）质量稳定且是
//      标准接口——自研抓取属于不必要的复杂度。
// 新形态：这里只做"调度裁决 + focus 建议"，真正的搜索交给 agent 的 web_search 工具。

const inWindow = (now, windows) => {
  const hm = now.getHours() * 60 + now.getMinutes();
  for (const w of windows) {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    if (hm >= sh * 60 + sm && hm <= eh * 60 + em) return w.id;
  }
  return null;
};

/** focus 冷却判断：最近 cooldownDays 内是否用过该兴趣 */
const onCooldown = (state, topic, cooldownDays) =>
  (state.wander?.focusHistory?.[topic] ?? 0) >
    Date.now() - cooldownDays * 86400000;

/** 推导本轮 focus：冷却外的兴趣里按历史最少者优先（轮流） */
function pickFocus(state, now) {
  const c = cfg();
  const sc = c._schedule ?? {};
  const cooldown = sc.focus_cooldown_days ?? 3;
  const pool = (c.interests ?? []).filter((t) => !onCooldown(state, t, cooldown));
  if (pool.length === 0) return null;
  // 历史使用次数最少的优先 → 自然轮换
  pool.sort((a, b) =>
    (state.wander?.focusCount?.[a] ?? 0) - (state.wander?.focusCount?.[b] ?? 0));
  return pool[0];
}

/** 闲逛调度裁决：窗口 + 4h 间隔 + focus 冷却，只回答"该不该逛、逛什么" */
function adviseWander(state, now, opts = {}) {
  const sc = cfg()._schedule ?? {};
  const windows = sc.windows ?? [];
  const minGap = (sc.min_interval_hours ?? 4) * 3600000;
  const win = inWindow(now, windows);
  if (!win) {
    if (opts.dry) console.log(`[browse:dry] window gate: ${now.toTimeString().slice(0,5)} not in window`);
    return { focus: null, skipped: `window(now=${now.toTimeString().slice(0,5)})` };
  }
  const last = state.wander?.last_wander_at ?? 0;
  if (now.getTime() - last < minGap)
    return { focus: null, skipped: 'min-interval' };
  const focus = pickFocus(state, now);
  if (!focus) return { focus: null, skipped: 'no-focus' };
  return { focus, skipped: null };
}

/** agent 完成该 focus 的搜索+入素材池后调用：登记冷却/计数/节流时间戳 */
function completeWander(state, focus, now) {
  state.wander ??= { focusHistory: {}, focusCount: {}, last_wander_at: 0 };
  state.wander.focusHistory ??= {};
  state.wander.focusCount ??= {};
  state.wander.focusHistory[focus] = now.getTime();
  state.wander.focusCount[focus] = (state.wander.focusCount[focus] ?? 0) + 1;
  state.wander.last_wander_at = now.getTime();
  return { focus, count: state.wander.focusCount[focus] };
}

// ── 总入口 ─────────────────────────────────────────────
export default async function collect(_policy, now = new Date(), opts = {}) {
  const state = (opts.dry
    ? { targets: {}, last_check_at: 0, wander: { focusHistory: {}, focusCount: {}, last_wander_at: 0 } }
    : loadJson(STATE_FILE) ?? { targets: {}, last_check_at: 0, wander: {} });

  // A. 定向追踪（6h 节流；dry 模式跳过——只看闲逛链路）
  const targetRes = (!opts.dry && (now.getTime() - (state.last_check_at ?? 0)) >= MIN_INTERVAL_MS)
    ? await collectTargets(state, now)
    : { items: [], checked: 0, errors: [] };

  // B. 闲逛调度咨询（窗口 + 4h 间隔 + focus 冷却）
  const advise = adviseWander(state, now, opts);

  const changed = (targetRes.checked ?? 0) > 0 || advise.focus !== null
    || (advise.skipped ?? '').length > 0;
  if (changed && !opts.dry) saveJson(STATE_FILE, state);

  return {
    source: '浏览',
    targetUpdates: (targetRes.items ?? []).length,
    context: {
      targets: targetRes.checked ?? 0,
      updates: (targetRes.items ?? []).length,
      wander: {
        advice: advise.focus ?? null,
        skipped: advise.skipped ?? null,
        // 空闲逛被裁决放行时，agent 用下面的查询词调 web_search 工具完成实际搜索
        query: advise.focus ? `${advise.focus} 2026 最新` : null,
      },
    },
  };
}

// CLI：--dry-run 手动调试模式（不写状态、不打节流），打印完整调度链路
// 用法：
//   node inputs/browse.mjs                 # 完整收集（定向追踪 + 闲逛裁决）
//   node inputs/browse.mjs --dry-run       # 强制午间窗口，只打印裁决链路
//   node inputs/browse.mjs done <focus>    # agent 搜索+入素材池后，登记冷却/节流
if (process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url) {
  const now = new Date();
  const doneIdx = process.argv.indexOf('done');
  if (doneIdx >= 0) {
    const focus = process.argv[doneIdx + 1];
    if (!focus) { console.error('usage: browse.mjs done "<focus>"'); process.exit(1); }
    const state = loadJson(STATE_FILE) ?? { targets: {}, last_check_at: 0, wander: {} };
    const res = completeWander(state, focus, now);
    saveJson(STATE_FILE, state);
    console.log(JSON.stringify({ done: res.focus, count: res.count }));
    process.exit(0);
  }
  if (process.argv.includes('--dry-run')) {
    now.setHours(12, 0, 0, 0);  // 强制进午间窗口（dry-run 只看链路）
    const state = { targets: {}, last_check_at: 0, wander: { focusHistory: {}, focusCount: {}, last_wander_at: 0 } };
    const res = await collect({}, now, { dry: true });
    console.log(JSON.stringify(res, null, 2));
  } else {
    const res = await collect({}, now);
    console.log(JSON.stringify(res.context));
  }
}