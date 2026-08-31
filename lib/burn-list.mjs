// 琥珀的心跳 · 焚毁清单（单一事实源，burn.mjs 与 vault.ps1 共用）
// 路径均为相对 <dataHome> 的条目；burn 阶段由调用方拼接 HOME。
// tamako 评审隐患：burn.mjs 与 vault.ps1 曾各自硬编码两份清单，易漏——收拢此处。
export const BURN_TARGETS = [
  'seeds.json',
  'sent.json',
  'ledger.md',
  'logs/heartbeat.jsonl',
  'logs/active_chat_log.md',
  'drafts',
  'profiles',
];

/** 渲染成 vault.ps1 可接收的清单文件内容（一行一条，绝对路径由 -home 拼接） */
export function renderBurnList(home) {
  return BURN_TARGETS.map((t) => `${home}\\${t.replace(/\//g, '\\')}`).join('\r\n') + '\r\n';
}