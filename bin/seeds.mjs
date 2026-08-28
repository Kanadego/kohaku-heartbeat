#!/usr/bin/env node
// 琥珀的心跳 · 素材池管理（防污染三件套：TTL / 消费计数退休 / 容量上限）
// 用法：
//   node seeds.mjs add "<text>" [--source 会话|浏览|时间]  登记素材（自动去重+容量检查）
//   node seeds.mjs list                                    列出活素材（id + 摘要）
//   node seeds.mjs surface <id>                            反刍提及一次（计数+1，满则退休）
//   node seeds.mjs gc                                      清理：TTL 过期 + 计数退休
//   node seeds.mjs stats                                   池子状态
//
// 第三公理：素材池是缓存不是记忆。这里的一切皆可焚毁。

import fs from 'node:fs';
import path from 'node:path';
import { loadJson, saveJson } from '../lib/vault.mjs';
import { repoRoot, dataHome } from '../lib/paths.mjs';

const ROOT = repoRoot();
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'policy.json'), 'utf8'));
const HOME = dataHome();
const SEEDS_FILE = path.join(HOME, 'seeds.json');

const load = () => loadJson(SEEDS_FILE) ?? { seq: 0, items: [] };
const save = (db) => saveJson(SEEDS_FILE, db);   // DPAPI 密文落盘(v0.1)

const alive = (items) => items.filter(s => !s.retired);

function gc() {
  const db = load();
  const now = Date.now();
  const ttlMs = POLICY.seed_ttl_days * 86400000;
  const before = alive(db.items).length;
  db.items = db.items.map(s => {
    if (s.retired) return s;
    const expired = now - s.born_at > ttlMs;
    const overused = s.surfaced_count >= POLICY.seed_retire_after_surfaces;
    if (expired || overused) return { ...s, retired: true,
      retired_reason: expired ? 'ttl' : 'surfaced_out' };
    return s;
  });
  save(db);
  console.log(`GC: ${before} -> ${alive(db.items).length} alive`);
}

const cmd = process.argv[2];

// 文本参数为 "-" 时从 stdin 读 UTF-8（规避 PS5.1 参数 GBK 乱码）
const readStdinText = () => {
  try { return fs.readFileSync(0, 'utf8').trim(); } catch { return ''; }
};

async function main() {
if (cmd === 'add') {
  let text = process.argv[3]?.trim();
  if (text === '-') text = readStdinText();
  if (!text) { console.log('ERROR: add "<text>" [--source x]'); return; }
  const srcIdx = process.argv.indexOf('--source');
  const source = srcIdx > -1 ? process.argv[srcIdx + 1] : '会话';
  const db = load();

  // 去重：与活素材完全相同或前 24 字符相同视为重复
  const head = text.slice(0, 24);
  if (alive(db.items).some(s => s.text === text || s.text.slice(0, 24) === head)) {
    console.log('DUPLICATE: 已有相近素材，未入库');
    return;
  }

  // 容量上限：满则最老优先淘汰
  let live = alive(db.items);
  if (live.length >= POLICY.seed_pool_cap) {
    live.sort((a, b) => a.born_at - b.born_at);
    db.items = db.items.map(s =>
      s.id === live[0].id ? { ...s, retired: true, retired_reason: 'pool_cap' } : s);
  }

  const id = ++db.seq;
  db.items.push({ id, text, source, born_at: Date.now(), surfaced_count: 0,
    last_surfaced_at: null, retired: false });
  save(db);
  console.log(`ADDED #${id} (${alive(db.items).length}/${POLICY.seed_pool_cap})`);
}

else if (cmd === 'list') {
  const db = load();
  for (const s of alive(db.items)) {
    const age = Math.floor((Date.now() - s.born_at) / 86400000);
    console.log(`#${s.id} [${s.source}] d${age} x${s.surfaced_count} ${s.text.slice(0, 50)}`);
  }
  if (!alive(db.items).length) console.log('(empty)');
}

else if (cmd === 'surface') {
  const id = Number(process.argv[3]);
  const db = load();
  const s = db.items.find(x => x.id === id && !x.retired);
  if (!s) { console.log('NOT_FOUND'); return; }
  s.surfaced_count += 1;
  s.last_surfaced_at = Date.now();
  if (s.surfaced_count >= POLICY.seed_retire_after_surfaces)
    s.retired = true, s.retired_reason = 'surfaced_out';
  save(db);
  console.log(`SURFACED #${id} x${s.surfaced_count}${s.retired ? ' -> retired' : ''}`);
}

else if (cmd === 'retire') {
  // 正当退役：事项已完成/已失效，不必等消费计数或 TTL
  const id = Number(process.argv[3]);
  const db = load();
  const s = db.items.find(x => x.id === id && !x.retired);
  if (!s) { console.log('NOT_FOUND'); return; }
  s.retired = true;
  s.retired_reason = 'completed';
  save(db);
  console.log(`RETIRED #${id} (completed)`);
}

else if (cmd === 'gc') gc();

else if (cmd === 'stats') {
  const db = load();
  console.log(JSON.stringify({ alive: alive(db.items).length,
    cap: POLICY.seed_pool_cap, total_ever: db.seq }));
}

else console.log('usage: seeds.mjs add "<text>" | list | surface <id> | gc | stats');
}

await main();
