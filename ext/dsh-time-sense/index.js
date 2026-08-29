// dsh-time-sense · 时间感知插件（琥珀的时间感）
//
// 机制（方案三，2026-08-29 与木偶人敲定）：
//   通过 ctx.on('session/event') 订阅会话事件流（官方通道，dsh-session）：
//     1. 收到 [SCHEDULE REMINDER] 帧的 user/message（心跳唤醒）→ 标记"注入时间"；
//     2. 收到普通 user/message → 轻量"闲聊嗅探"（消息短/无代码块/无工具痕迹
//         → 判定闲聊）→ 标记"注入时间"；正事/难分类 → 不标记；
//     3. 组装系统提示时（systemPrompt.section text），只读内存标记，
//        命中则返回当前时间文本，否则返回空串（不注入）。
//
// 安全纪律（代码层面落实，承诺给木偶人）：
//   - 只读事件里的消息文本做元特征判断（长度/代码块/工具标记），原文不落盘；
//   - 不打印、不写日志、不网络调用——本文件不含 fetch/http；
//   - 不申请额外系统权限；内存标记每轮重置，不累积历史。

const SECTION_TIME = 'dsh-time-sense:now';
const name = 'dsh-time-sense';
const inject = ['systemPrompt'];

function fmtTime(d) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  const h = d.getHours();
  const part = h < 6 ? '深夜' : h < 9 ? '清晨' : h < 12 ? '上午'
    : h < 14 ? '正午' : h < 18 ? '午后' : h < 22 ? '夜晚' : '夜里';
  const p = (n) => String(n).padStart(2, '0');
  return `今天是 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}（周${week}）${p(h)}:${p(d.getMinutes())}，${part}。`;
}

/** 闲聊嗅探：元特征判断，不保留原文 */
function looksCasual(text) {
  if (!text) return false;
  const t = String(text);
  if (t.length > 400) return false;                     // 长文本=正事概率高
  if (/```|`[a-z]+`|node |git |npm |pnpm |pwsh|命令|报错|console\.log/.test(t)) return false;
  if (/\[(tool|pwsh|bash|cmd|job)/i.test(t)) return false;
  return t.length >= 2;
}

const apply = (ctx) => {
  let injectTime = false;   // 内存标记：本 peek 组装是否注入（每轮由事件刷新）

  // 1) 订阅会话事件：刷新"是否注入"标记
  //    DSH 0.1.1-rc.2 签名：'session/event'(session, event) —— session 在前，event 在后
  const off = ctx.on('session/event', (_session, ev) => {
    try {
      if (!ev || ev.type !== 'user/message') return;
      // 事件结构：{ type, seq, time, data: UserMessage }，文本在 data.content 的块数组里
      const blocks = ev.data?.content;
      const text = Array.isArray(blocks)
        ? blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n')
        : '';
      if (text.includes('[SCHEDULE REMINDER]')) {
        injectTime = true;                              // 心跳：无条件
      } else {
        injectTime = looksCasual(text);                 // 闲聊：启发式
      }
    } catch { injectTime = false; /* 任何异常回落为不注入 */ }
  });

  // 2) 系统提示注入段：组装时按标记决定是否给时间
  const disposer = ctx.systemPrompt.section({
    name: SECTION_TIME,
    order: 0.2,
    text: () => {
      if (!injectTime) return '';                       // 正事/未标记：不注入
      return fmtTime(new Date());
    },
  });

  return () => {
    try { off(); } catch { /* ignore */ }
    try { disposer(); } catch { /* ignore */ }
  };
};

module.exports = { name, apply, inject };