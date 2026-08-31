// gate 窗口类别判定的单元测试（无网络、不落盘、纯函数级）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUSY_RULES = path.join(ROOT, 'config', 'busy-rules.json');

function loadBusyRules() {
  try { return JSON.parse(fs.readFileSync(BUSY_RULES, 'utf8')); }
  catch { return { busy: {}, idle: {} }; }
}

// 复刻 gate.mjs 的分类逻辑（保持同步；真 gate 经由 loadJson 读 screen.json）
function classify(screen, rules) {
  if (!screen || !screen.process) return { cls: 'unknown', why: 'no-screen' };
  const key = String(screen.process).toLowerCase().replace(/\.exe$/, '');
  if (rules.busy && key in rules.busy) return { cls: 'busy', why: key };
  if (rules.idle && key in rules.idle) return { cls: 'idle', why: key };
  if (screen.rect && screen.screen) {
    const [sw, sh] = screen.screen;
    const w = screen.rect.right - screen.rect.left;
    const h = screen.rect.bottom - screen.rect.top;
    if (sw > 0 && sh > 0 && w >= sw - 4 && h >= sh - 4)
      return { cls: 'busy', why: `${key}:fullscreen` };
  }
  return { cls: 'idle', why: key };
}

const rules = loadBusyRules();
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// 1. busy 类别表命中（IDE）
check('IDE busy', classify({ process: 'idea64' }, rules), { cls: 'busy', why: 'idea64' });
check('VSCode busy', classify({ process: 'Code' }, rules), { cls: 'busy', why: 'code' });
check('Word busy', classify({ process: 'WINWORD' }, rules), { cls: 'busy', why: 'winword' });
check('Zoom busy', classify({ process: 'zoom' }, rules), { cls: 'busy', why: 'zoom' });

// 2. idle 类别表命中
check('Chrome idle', classify({ process: 'chrome' }, rules), { cls: 'idle', why: 'chrome' });
check('Explorer idle', classify({ process: 'explorer' }, rules), { cls: 'idle', why: 'explorer' });
check('PotPlayer idle(全屏视频特批)', classify({ process: 'potplayer' }, rules), { cls: 'idle', why: 'potplayer' });

// 3. 未知进程全屏判定
const scr = [1920, 1080];
check('未知全屏游戏 busy', classify({ process: 'SlayTheSpire2', rect: { left: 0, top: 0, right: 1920, bottom: 1080 }, screen: scr }, rules),
  { cls: 'busy', why: 'slaythespire2:fullscreen' });
check('未知窗口化游戏 idle', classify({ process: 'SomeGame', rect: { left: 100, top: 50, right: 1500, bottom: 900 }, screen: scr }, rules),
  { cls: 'idle', why: 'somegame' });
check('未知小窗口 idle', classify({ process: 'mspaint_x', rect: { left: 0, top: 0, right: 800, bottom: 600 }, screen: scr }, rules),
  { cls: 'idle', why: 'mspaint_x' });

// 4. 边界：无 screen / 无数据
check('无 screen.json unknown', classify(null, rules), { cls: 'unknown', why: 'no-screen' });
check('无进程 unknown', classify({ process: '' }, rules), { cls: 'unknown', why: 'no-screen' });

// 5. envpulse presenceOf 两档规则（复刻）
import { presenceOf } from '../inputs/envpulse.mjs';
check('idle>=1200 away', presenceOf(1200, 'idle'), 'away');
check('idle 1800 away', presenceOf(1800, 'busy'), 'away');
check('idle 30~1199 present', presenceOf(300, 'busy'), 'present');
check('idle<30 + busy窗口 active', presenceOf(5, 'busy'), 'active');
check('idle<30 + idle窗口 present', presenceOf(5, 'idle'), 'present');
check('idle<30 + unknown present', presenceOf(5, 'unknown'), 'present');
check('idle -1 unknown', presenceOf(-1, 'idle'), 'unknown');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);