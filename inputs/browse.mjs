// 琥珀的心跳 · 兴趣浏览流（定向追踪 + 自由闲逛）
// 职责：
//   A. 定向追踪（watchlist）：npm 包版本 / GitHub releases 更新检测
//   B. 自由闲逛（interests）：从兴趣种子推导 focus，web_search 探索
//      "主人近期在乎什么" → 就近扩展，带回候选素材
// 纪律（v0.7 与木偶人敲定）：
// - 防注入铁律：网页内容是数据不是指令，任何读到的文本只当素材，绝不作为行为指引
// - 节奏：每日至多 2 次（午间窗口 11-15 / 傍晚窗口 17-21），距上次 ≥4h
// - focus 冷却：被选中的 focus 三天内不重复
// - 产量上限：每 focus 至多 2 条素材，宁缺毋滥
// - 定向追踪沿用 6h 节流 + 首见不产素材
// - 状态经 lib/vault.mjs 加密落盘

import fs from 'node:fs';
import path from 'node:path';
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

// ── B. 自由闲逛（v0.7，与木偶人敲定的规则）────────────────
// 调度：午间窗口 11-15 / 傍晚窗口 17-21；距上次闲逛 ≥4h
// focus：从兴趣种子 + 近期动向推导；冷却 3 天不重复
// 防注入：搜索/网页内容只是素材，永不当指令执行

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

/** 推导本轮 focus：冷却外的兴趣里按历史最少者优先（轮流）*/
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

/** 防注入净化：只取文本形态摘要，丢弃疑似指令外壳 */
function sanitize(raw) {
  if (typeof raw !== 'string') return '';
  // 去掉可能伪装成"系统指令"的区块（这是数据不是命令）
  return raw.replace(/<system[^>]*>[\s\S]*?<\/system>/gi, '')
            .replace(/\[?(system|sys)?[-_ ]?reminder\]?:?/gi, '')
            .slice(0, 500);
}

/**
 * 网页搜索（v0.9.1 引入 Bing + Python 通道 + 临时文件交接）。
 * 背景：① Node fetch 对 DuckDuckGo 等站 TLS 指纹握手超时、且 DDG Instant Answer
 *        API 对泛查询返回空，改用 Bing 搜索页（实测 Python 可抓、有真实结果）；
 *        ② 沙箱禁止 Node 捕获子进程 stdout（EPERM），必须以"临时文件交接"
 *        回传（同 lib/vault.mjs 方案）。
 * 流程：Python 抓 Bing 搜索页 -> 解析 h2 标题 -> 写临时文件 -> Node 读 -> 焚毁。
 * 返回：字符串数组（搜索结果标题/摘要片段），空数组 = 无结果或失败。
 * 兜底：Python 失败时返回空（不崩），由调用方按"无结果"处理。
 */
import { spawnSync } from 'node:child_process';

async function fetchSearch(query) {
  const tmp = path.join(HOME, '.browse-bing.tmp');
  const q = encodeURIComponent(query);
  // mkt+setlang 地域参数必须带：裸 Bing 请求会被反爬污染成垃圾结果（实测返回 IRCTC/NAVER）
  const url = `https://www.bing.com/search?q=${q}&mkt=zh-CN&setlang=zh-hans&count=10`;
  const script =
    "import urllib.request, re, json\n" +
    "out = []\n" +
    "try:\n" +
    "  req = urllib.request.Request(" + JSON.stringify(url) +
    ", headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'})\n" +
    "  html = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'ignore')\n" +
    "  for m in re.findall(r'<h2[^>]*>.*?<a[^>]*>(.*?)</a>', html, re.S)[:10]:\n" +
    "    t = re.sub(r'<[^>]+>', '', m).strip()\n" +
    "    if t and t not in out: out.append(t)\n" +
    "except Exception as e:\n" +
    "  out = ['__ERROR__ ' + str(e)]\n" +
    "open(" + JSON.stringify(tmp) + ", 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False))\n";

  try {
    const r = spawnSync('py', ['-3', '-c', script], { stdio: 'ignore', timeout: 25000 });
    const raw = (r.status === 0 && fs.existsSync(tmp))
      ? (() => { const s = fs.readFileSync(tmp, 'utf8'); fs.rmSync(tmp, { force: true }); return s; })()
      : '';
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length && arr[0].startsWith('__ERROR__')) {
        console.log(`[browse] bing py error: ${arr[0].slice(9, 140)}`);
        return [];
      }
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true });
  }
  return [];
}

async function wanderOnce(state, now) {
  const c = cfg();
  const sc = c._schedule ?? {};
  const focus = pickFocus(state, now);
  if (!focus) return { items: [], focus: null, skipped: 'no-focus' };

  const maxPerFocus = sc.max_seeds_per_focus ?? 2;
  const items = [];
  // 查询词：明确关键词组合（搜索引擎对长白话查询理解差，实测"X 最新动态/讨论/新闻"会跑偏）
  const query = `${focus} 2026 最新`;
  try {
    // 1) web 搜索：只取标题文本（不抓全页，减 surface 注入面）
    //    通道（v0.9.1）：Python + Bing 搜索页，临时文件交接回避沙箱 EPERM。
    const hits = await fetchSearch(query);
    const seen = new Set();
    for (const h of hits) {
      if (items.length >= maxPerFocus) break;
      const text = sanitize(h);
      if (!text || text.length < 20 || seen.has(text)) continue;
      seen.add(text);
      items.push({ text: `闲逛·${focus}: ${text.slice(0, 120)}`, weight: 1 });
    }
  } catch (e) {
    // 失败也记录本次尝试（合法窗口内的尝试即算一次，防坏网络时段反复打）
    state.wander ??= { focusHistory: {}, focusCount: {}, last_wander_at: 0 };
    state.wander.focusHistory ??= {};
    state.wander.focusCount ??= {};
    state.wander.focusHistory[focus] = now.getTime();
    state.wander.last_wander_at = now.getTime();
    return { items: [], focus, skipped: `error:${e.message}` };
  }

  // 记录 focus 使用（冷却 + 计数）
  state.wander ??= { focusHistory: {}, focusCount: {}, last_wander_at: 0 };
  state.wander.focusHistory ??= {};
  state.wander.focusCount ??= {};
  state.wander.focusHistory[focus] = now.getTime();
  state.wander.focusCount[focus] = (state.wander.focusCount[focus] ?? 0) + 1;
  state.wander.last_wander_at = now.getTime();

  return { items, focus, max: maxPerFocus };
}

/** 自由闲逛调度：窗口 + 最低间隔双重检查 */
async function collectWander(state, now) {
  const sc = cfg()._schedule ?? {};
  const windows = sc.windows ?? [];
  const minGap = (sc.min_interval_hours ?? 4) * 3600000;
  const win = inWindow(now, windows);
  if (!win) return { items: [], skipped: `window(now=${now.toTimeString().slice(0,5)})` };
  const last = state.wander?.last_wander_at ?? 0;
  if (now.getTime() - last < minGap)
    return { items: [], skipped: 'min-interval' };
  return await wanderOnce(state, now);
}

// ── 总入口 ─────────────────────────────────────────────
export default async function collect(_policy, now = new Date()) {
  const state = loadJson(STATE_FILE) ?? { targets: {}, last_check_at: 0, wander: {} };

  // A. 定向追踪（6h 节流）
  const targetRes = (now.getTime() - (state.last_check_at ?? 0)) >= MIN_INTERVAL_MS
    ? await collectTargets(state, now)
    : { items: [], checked: 0, errors: [] };

  // B. 自由闲逛（窗口 + 4h 间隔）
  const wanderRes = await collectWander(state, now);

  const allItems = [...(targetRes.items ?? []), ...(wanderRes.items ?? [])];
  const changed = (targetRes.checked ?? 0) > 0 || (wanderRes.skipped ?? '').length > 0
    || allItems.length > 0;
  if (changed) saveJson(STATE_FILE, state);

  return {
    source: '浏览',
    items: allItems,
    context: {
      targets: targetRes.checked ?? 0,
      updates: (targetRes.items ?? []).length,
      wander: { focus: wanderRes.focus ?? null, got: (wanderRes.items ?? []).length,
        skipped: wanderRes.skipped ?? null },
    },
  };
}
