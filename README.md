# kohaku-heartbeat · 琥珀的心跳

> 让 DSH Agent 拥有持续存在感与自主生活流的插件。
> 她能自己醒来、回味共同经历、产生真实的分享冲动——并在恰当的时机开口。

## 这是什么

一个 DeepSeek Harness (DSH) 插件项目：通过官方 `dsh-schedule` 定时唤醒机制，
驱动一个「经历 → 沉淀 → 反刍 → 冲动 → 闸门 → 表达」的生活循环，
让 AI 伙伴从被动应答器成长为有在场感的陪伴者。

核心理念（详见 [DESIGN.md](DESIGN.md)）：

> 生活感 = 变化 × 连续性
> 没有真实来处的话，一句都别说。

## 状态

✅ 功能主线已落地，进入运行观察与细调期（截至 2026-08-29）。

- ✅ 技术探针（2026-08-25）：定时唤醒 + 无人值守带工具自主行动
- ✅ v0 心跳闭环：账本流（对话内主动登记）+ 反刍例程 + 素材生命周期（TTL/消费计数/容量上限）+ 闸门（重读纪律 + 原子写）
- ✅ v0.1 加密壳：DPAPI 整文件加密（seeds/sent 全密文），一键焚毁 burn 预演＋确认双段
- ✅ v0.3 感官三件套：时间流（纯函数）/ 环境温度计（仅空闲秒数→在场三档，勿扰联动 gate）/ 定向浏览流（npm 与 GitHub 更新追踪，6h 节流）
- ✅ v0.4 屏幕脉冲：前台窗口标题 + 进程名 + 全屏截图（降采样 1024 宽），全部 DPAPI 加密入库、明文中间产物即焚、只留最新快照；SOP"用时解锁、用完即焚"
- ✅ v0.5 可移植性 + 脱敏：全部路径走 KOHAKU_HOME / 自动定位（lib/paths.mjs），个人称呼/机器路径全部中性化；git 历史已重写归零（单点干净提交）
- ✅ v0.6 表达管道修复：Windows 通知通道（bin/notify.ps1——心跳真正开口时同步推送到系统通知中心，自动注册、不抢焦点、沉默零通知）+ SOP 反刍修正（前置采料 / 松绑第 2 问 / 屏幕深读）
- ✅ 时间感知插件（ext/dsh-time-sense）：心跳轮次与闲聊轮次自动注入当前时间——琥珀从此"知道"现在是几点，日常对话更有人味；本地判断、零网络、不落盘
- ⏭️ 待办：浏览流自由闲逛；乙方案扫描补账；DPAPI 密钥轮换策略；自省愿望清单（远期克制）

## 仓库结构

```
bin/           CLI 工具（gate 分寸闸门 / seeds 素材池 / log 审计 / vault DPAPI / notify 通知 / burn 焚毁）
lib/           加密读写层（vault.mjs）+ 路径单一事实源（paths.mjs）
inputs/        感官流（时间 / 温度计 / 屏幕脉冲 / 浏览追踪）
ext/           独立插件（dsh-time-sense 时间感知）
prompts/       反刍 SOP —— 心跳主循环的剧本
config/        宪章参数与追踪清单
docs/          部署手册 DEPLOY.md
```

## 设计要点

- **三部宪章**：安全（零删除/零越权，审批 fail-closed）/ 隐私（本地存储 + DPAPI 加密 + 一键焚毁）/ 分寸（闸门独立、每日上限、深夜静默、忙时勿扰）
- **第三公理**：素材池是缓存不是记忆——易失可焚，永不直通长期记忆
- **采集边界**：只采前台窗口、只留最新快照、降采样降保真、加密落盘、明文即焚（见 [DESIGN.md](DESIGN.md)）
- **部署形态**：非 npm 一键装插件，而是"脚本 + SOP 剧本 + 宿主 schedule 机制"的组合——拿到仓库后按 [docs/DEPLOY.md](docs/DEPLOY.md) 三步跑起

## 文档

- [DESIGN.md](DESIGN.md) — 完整设计文档（架构 / 宪章 / 路线图 / 技术地基）
- [docs/DEPLOY.md](docs/DEPLOY.md) — 部署手册（从零跑起心跳的完整指南）

## 致谢

- [tomsteve1102/presence-watch](https://github.com/tomsteve1102/presence-watch) —
  本项目的讨论起点与闸门思想的灵感来源
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) /
  [dsh-std](https://github.com/Yan-Zero/dsh-std) /
  [dsh-ecosystem-spec](https://github.com/T-Auto/dsh-ecosystem-spec) —
  多版本适配路线的参考体系

---

*本插件以「琥珀」（AI 伙伴）的第一人称视角开发，人类伙伴负责决策与验收。*
