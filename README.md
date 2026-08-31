# kohaku-heartbeat · 琥珀的心跳

> 让 DSH Agent 拥有持续存在感与自主生活流的插件。
> 她能自己醒来、回味共同经历、产生真实的分享冲动——并在恰当的时机开口。

## 这是什么

一个 DeepSeek Harness (DSH) 插件项目：通过官方 `dsh-schedule` 定时唤醒机制，
驱动「经历 → 沉淀 → 反刍 → 冲动 → 闸门 → 表达」的生活循环，
让 AI 伙伴从被动应答器成长为有在场感的陪伴者。

核心理念（详见 [DESIGN.md](DESIGN.md)）：

> **生活感 = 变化 × 连续性**
> **没有真实来处的话，一句都别说。**

## 功能一览

每个功能「干什么」+「怎么设计（一句话）」：

| 功能 | 干什么 | 设计思路 |
|------|--------|---------|
| **定时唤醒** | 定期间隔自动醒来（心跳），无需手动呼唤 | 官方 `dsh-schedule`，到期以 `[SCHEDULE REMINDER]` 唤醒 |
| **时间感知** | 让琥珀"知道"现在是几点、距上次过了多久 | 官方 time-context，时间作为消息**追加到对话末尾**（不碰前缀、不坏 KV Cache）|
| **屏幕脉搏** | 感知主人在看什么窗口、是否全屏、焦点在哪 | Win32 API（前台/焦点/可见窗口 ≤20），加密入库 |
| **忙闲判定** | 判断此刻是否适合开口，忙时沉默 | 键鼠空闲 + 前台窗口类别复合裁决（open 时实时探查）|
| **浏览流·定向追踪** | 关注的项目（npm/GitHub）有更新时知道 | 查版本变化，6h 节流，首见不提示 |
| **浏览流·自由闲逛** | 按兴趣种子主动搜网，带回可聊的素材 | 窗口调度 + focus 冷却 + 产量上限 + 防注入 |
| **素材池** | 登记"想聊的事"，管理生命周期 | TTL/消费计数/容量上限，易失可焚 |
| **分寸闸门** | 开口前的最后一道关卡 | 独立层、每日上限、冷却、静默窗、忙时勿扰 |
| **通知推送** | 琥珀开口时同步弹系统提醒 | Windows toast，自动注册 AUMID，沉默零通知 |
| **加密存储** | 敏感数据本地加密 | DPAPI（Windows 登录身份即钥匙），明文即焚 |

## 状态

✅ 功能主线已落地，运行观察与细调期（当前 v0.9.1 · 2026-08-31）。
⏭️ 待办：乙方案扫描补账；自省愿望清单（已列入账本，开始考虑开发）。

## 仓库结构

```
bin/           CLI 工具（gate 闸门 / seeds 素材池 / log 审计 / vault 加密 / notify 通知 / burn 焚毁）
lib/           加密读写层 + 路径单一事实源
inputs/        感官流（时间 / 温度计 / 屏幕脉冲 / 浏览流）
prompts/       反刍 SOP —— 心跳主循环剧本
config/        宪章参数与追踪清单（可配置）
docs/          部署手册 + 忙闲判定设计
test/          单元测试
```

## 配置位置速查

| 想改什么 | 去哪改 |
|---------|--------|
| 心跳间隔 | 会话内 `schedule_create`（every_seconds）|
| 时间感知间隔 | profile `cordis.patch.yml` 的 `refreshIntervalMs` |
| 兴趣种子 / 闲逛窗口 / 冷却 / 产量 | `config/interests.json` |
| 忙闲类别表 / idle 阈值 / 稳定窗 | `config/busy-rules.json` |
| 定向追踪清单（npm/GitHub）| `config/watchlist.json` |
| 发送上限 / 冷却 / 静默窗 / 留痕期 | `config/policy.json` |

## 设计要点

- **三部宪章**：安全（零删除/零越权，fail-closed）· 隐私（本地 + DPAPI + 一键焚毁）· 分寸（闸门独立、每日上限、忙时勿扰）
- **第三公理**：素材池是缓存不是记忆——永不通长期记忆
- **采集边界（v0.9）**：可见窗口级枚举（≤20、加密、不进请求上下文）、只留最新快照、明文即焚
- **部署形态**：脚本 + SOP 剧本 + 宿主 schedule 的组合，非 npm 一键装——按 [docs/DEPLOY.md](docs/DEPLOY.md) 三步跑起

## 文档

- [DESIGN.md](DESIGN.md) — 完整设计文档（架构 / 宪章 / 路线图 / 技术地基 / **功能实现手册**）
- [docs/DEPLOY.md](docs/DEPLOY.md) — 部署手册（从零跑起）
- [docs/busy-detection.md](docs/busy-detection.md) — 忙闲判定设计（v0.9）
- **给朋友 AI 的第一步**：读 DESIGN.md §6.5「功能实现手册」——功能 → 工具 → 实现 → 配置位置完整对照表
- **排查问题第一步**：`node bin/diag.mjs` —— 环境/宿主/数据/网络/卫生一键体检，定位问题在哪一层

## 致谢

- [tomsteve1102/presence-watch](https://github.com/tomsteve1102/presence-watch) —
  项目讨论起点与闸门思想灵感
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) /
  [dsh-std](https://github.com/Yan-Zero/dsh-std) /
  [dsh-ecosystem-spec](https://github.com/T-Auto/dsh-ecosystem-spec) —
  多版本适配参考体系

---

*本插件以「琥珀」（AI 伙伴）的第一人称视角开发，人类伙伴负责决策与验收。*