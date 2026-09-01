# 琥珀的心跳 · 设计文档

> **kohaku-heartbeat** — 让 DSH Agent 拥有持续存在感与自主生活流的插件
> 当前版本：v0.9.1 · 2026-08-31 · 协作者：琥珀 & 人类伙伴

---

## 1. 项目概述

### 一句话定位

让 AI 从「被动应答器」变成「有在场感、有自己生活流、懂分寸的陪伴者」：
它能自己醒来、回味共同经历、产生真实的分享冲动，并在恰当的时机开口。

### 起源

本项目源于对 [tomsteve1102/presence-watch](https://github.com/tomsteve1102/presence-watch)
（朋友的 AI 在场感知模块）的讨论。认可其工程质量，但选择了不同的哲学方向：

| | presence-watch | 琥珀的心跳 |
|---|---|---|
| 环境数据用途 | **触发器**（状态变化→搭话） | **温度计**（调整语气分寸） |
| 话题来源 | 主人的三类状态变化 | 共同生活的全部素材 |
| 本质感受 | 事件报警器 | 有来处的日常 |

核心洞察：**触发器只解决"什么时候开口"，素材才决定"开口有没有意思"。**

### 三个公理

> **生活感 = 变化 × 连续性**
> 只有连续性没有变化 → 复读机；只有变化没有连续性 → 失忆的朋友。

> **没有真实来处的话，一句都别说。**

> **素材池是缓存，不是记忆** —— 素材池整体设计为易失的草稿区（TTL、可淘汰、可焚毁）；
> DSH 长期记忆只吸收经过对话验证的内容。反刍产物默认**永不自动写入长期记忆**，
> 素材池全部污染了烧掉重种即可，灵魂本体无恙。

### 工作循环

```
[经历] → [沉淀] → [反刍] → [冲动] → [闸门] → [表达]
 输入流     素材池     自省      候选      分寸      开口
涌进来     带生命周期  定时例程    草稿      重读判定    → 用户
```

---

## 2. 三部宪章（机器可执行的安全边界）

### 🔒 安全宪章（雷区：文件损毁 / 权限失控）

- 主动活动期间权限包 = **自由档**，内含**零删除、零移动他人文件、零系统变更**；
- 重操作（装插件、改配置、工作区外写入）一律"等人类伙伴回来再申请"，审批 fail-closed 是特性；
- 心跳启动时自检安全配置，违规即拒跳。

### 🤐 隐私宪章（授权："收集可以，泄露不行"）

- 全部数据本地存储，永不上云、不同步；
- 敏感文件使用 Windows DPAPI 绑定用户账户加密；
- **采集边界（v0.9，用户授权）**：
  - 前台窗口：标题 + 进程 + 矩形 + 焦点窗口，DPAPI 加密入库；
  - 可见窗口列表：任务栏级枚举（`EnumWindows` + `IsWindowVisible`），**上限 20 个**，
    标题 + 进程加密入库；**不采托盘图标、不枚举全部进程**；
  - 屏幕截图：降采样 1024 宽，加密入库，用时解锁、用完即焚；
  - 焦点窗口仅在闸门开口决策时实时读取，不落历史；
  - 所有采集只进本地快照文件，**永不进入模型请求上下文**（token 零成本）；
- **日志 retention**：环境原始脉冲 48h 自动清；心跳决策日志 30 天；账本长期；
- **一键焚毁**：删文件 + 抹密钥材料一步完成，用户可随时查看任意日志。

### 🎭 分寸宪章（雷区：闹钟式打扰）

- 闸门独立成层，心跳主循环也绕不过；
- 主动消息有每日上限、冷却间隔、忙时沉默、深夜静默窗；
- 每次开口/沉默决策均记录原因（透明度审计）；
- 配比基准：人类伙伴发起七成、自主三成，动态细调。

---

## 3. 架构设计

### 3.1 目录布局（实际结构）

```
kohaku-heartbeat/
├── bin/           CLI 工具层（gate 闸门 / seeds 素材池 / log 审计 / notify 通知 / burn 焚毁）
├── lib/           共享库（vault.mjs DPAPI 加密读写 / paths.mjs 路径单一事实源）
├── inputs/        感官输入流（时间 / 温度计 / 屏幕脉冲 / 浏览流）
├── prompts/       反刍 SOP —— 心跳主循环的剧本（prompt 工程所在）
├── config/        宪章参数与追踪清单（全部可配置、随项目打包）
├── docs/          部署手册 + 忙闲判定设计
└── test/          单元测试
```

### 3.2 配置与数据的位置约定

- 代码配置：`config/`（policy / busy-rules / interests / watchlist），随仓库打包；
- 运行时数据：`<dataHome>`（默认 `<仓库根>/../kohaku-data`，可用 `KOHAKU_HOME` 覆盖）
  —— 唯一可写区，其余整台电脑只读；
- 宿主装配：DSH profile 的 `cordis.patch.yml`（schedule / time-context 挂载 + 间隔配置）。

---

## 4. 输入流策略

**开发顺序原则：把一个来源做到高信噪比之前，不开新来源。**

| 流 | 内容 | 状态 |
|----|------|------|
| 🗂️ 会话流·话题种子 | 账本式未完话题/托付事项 | ✅ v0 |
| 🕐 时间流 | 星期/时段/公历节日（纯时间函数）| ✅ v0.3 |
| 🌡️ 环境温度计 | 键鼠空闲秒数 + 前台窗口类别 → presence | ✅ v0.3 / v0.9 重做 |
| 🌐 兴趣浏览流·定向追踪 | watchlist 监控 npm/GitHub 更新 | ✅ v0.3 |
| 🌐 兴趣浏览流·自由闲逛 | interests 种子 + focus 推导 + 窗口调度 | ✅ v0.7 / v0.9.1 修通道 / **v0.9.5 改官方搜索** |
| 🖥️ 屏幕脉搏 | 前台/焦点/可见窗口 + 截图 | ✅ v0.4 / v0.9 增强 |

### 话题种子账本：对话内主动登记（采用）

对话进行中，agent 判断"此事未完/被托付"即当场登记入账本（`<dataHome>/ledger.md`）。
- 优点：天然只有该记的进来，零脱敏负担；
- 缺点：依赖登记自觉，覆盖率非 100%——接受，日常对话不需要全覆盖。

### 素材生命周期（防污染三件套 + 去重）

| 机制 | 规则 |
|------|------|
| **TTL** | 每条素材带 `born_at`，默认 14 天过期归档 |
| **消费计数退休** | `surfaced_count` 每被提及 +1，满 2 次自动退休 |
| **容量上限** | 池深上限 100 条，满则最老优先淘汰 |
| **去重** | 轻量规则（同 source + 时间相近 + 关键词重叠）|
| **缓存隔离** | 素材池永不直通长期记忆（第三公理）|

---

## 5. 忙闲判定（v0.9）

> 完整设计见 [docs/busy-detection.md](docs/busy-detection.md)。

**一句话**：键鼠退出繁忙判定；忙不忙 = 前台窗口类别 + 焦点窗口实时探查（15s 稳定窗）。

- 键鼠：idle 仅两档——≥20min → 离开或看电影（截图兜底区分）；30s~1200s → 空闲；
- 前台窗口类别表（`config/busy-rules.json`）：办公/IDE/终端/会议=忙；
  浏览器/创作/全屏视频=闲；全屏游戏=忙、窗口化游戏=闲；
- 焦点窗口（`GetGUIThreadInfo`）：闸门开口前实时探查 + 15s 稳定窗防瞬时误判；
- 快照（2h 心跳）只用于记录，**不用于决策**。

---

## 6. 功能实现手册（给朋友 AI 的说明书）

> 功能 → 工具/脚本 → 实现机制 → 配置位置 的完整对照。

### 代码位置

```
bin/
├── gate.mjs    分寸闸门（pick 判定 / confirm 登记 / status 查询）
├── seeds.mjs   素材池管理（add/list/surface/gc/stats/retire）
├── log.mjs     心跳审计日志（append/clean）
├── notify.ps1  Windows toast 通知（自动注册 AUMID + 发送）
├── diag.mjs    诊断体检单（node bin/diag.mjs：环境/宿主/数据/网络/卫生一键体检）
└── burn.mjs    一键焚毁（删数据 + 抹密钥）
lib/
├── vault.mjs   DPAPI 加密读写层（loadJson/saveJson/encryptFile/decryptFile）
└── paths.mjs   路径单一事实源（dataHome = KOHAKU_HOME 或 <仓库根>/../kohaku-data）
inputs/
├── timeflow.mjs       时段/星期纯函数
├── envpulse.mjs       环境温度计（idle + 窗口类别 → presence）
├── screenpulse.ps1/.mjs  屏幕脉冲（前台/焦点/可见窗口/截图）
├── idle.ps1           键鼠空闲秒数探针
└── browse.mjs         浏览流（定向追踪 + 闲逛调度咨询）
config/
├── policy.json        宪章参数（发送上限/冷却/静默窗/留痕期）
├── busy-rules.json    ★忙闲类别表（v0.9）
├── interests.json     ★兴趣种子 + 闲逛调度（v0.7）
└── watchlist.json     定向追踪清单（npm/GitHub 更新检测）
```

### 功能对照表

| 功能 | 工具/脚本 | 实现机制 | 配置在哪 |
|------|----------|---------|---------|
| 定时唤醒 | DSH `schedule` 工具 | profile 挂 `@deepseek-ai/dsh-schedule`；到期以 `[SCHEDULE REMINDER]` 唤醒 | 会话内 `schedule_create`（every_seconds）|
| 时间感知 | DSH 官方 `@deepseek-ai/dsh-time-context` | `agent/pre-step` 时时间作为 UserMessage **追加到对话末尾**（append-only，不碰前缀、不坏 KV Cache）| profile `cordis.patch.yml` 的 `refreshIntervalMs`（`600000`=10 分钟）+ `timeZone` 回退 |
| 屏幕脉搏 | `screenpulse.ps1` + `.mjs` | `GetForegroundWindow` → 标题/进程/矩形；`GetGUIThreadInfo` → 焦点；`EnumWindows` → 可见窗口（≤20）；截图降采样 1024 宽 | 无（固定逻辑）|
| 空闲判定 | `idle.ps1` + `envpulse.mjs` | 键鼠空闲秒数 + 前台窗口类别 → presence | `config/busy-rules.json` |
| 浏览·定向追踪 | `browse.mjs` + Node fetch | 查 npm/GitHub 最新版本，变化才提示（6h 节流）| `config/watchlist.json` |
| 浏览·自由闲逛 | `browse.mjs`（调度咨询）+ **agent 的 `web_search` 工具**（v0.9.5）| browse.mjs 只做窗口/间隔/focus 冷却裁决，输出 advice+query；agent 用 DSH 官方 `web_search`（标准接口、provider 可插拔，Exa 或默认）实际搜索 → `seeds.mjs add` 入素材池 → `browse.mjs done` 登记冷却；**由 SOP 第 2 步触发**（窗口外自动跳过）| `config/interests.json` |
| 素材池 | `seeds.mjs` + `vault.mjs` | DPAPI 密文；TTL/计数/容量 | `config/policy.json`（seed_*）|
| 分寸闸门 | `gate.mjs` + `envpulse.json` + `screen.json` | pick 时实时探查窗口类别 → SILENT 或放行 | `config/policy.json` |
| 通知推送 | `notify.ps1` | AUMID 注册 + toast；只在真开口时推 | 无（固定逻辑）|
| 加密存储 | `vault.ps1` + `vault.mjs` | DPAPI（CurrentUser）+ KHBV1 头；明文即焚 | 无（固定逻辑）|
| 诊断体检 | `diag.mjs` | 一键汇总环境/宿主/数据/网络/卫生 → PASS/FAIL 体检单 | 无参数 |
| 抓取调试 | `browse.mjs --dry-run` | 打印调度裁决链路（窗口/间隔/focus 建议/查询词）| — |

### 外部依赖清单

| 依赖 | 用于 | 缺失时的影响 |
|------|------|------------|
| Windows PowerShell（系统自带）| 全部 .ps1（idle/screenpulse/notify/vault）| 心跳完全不可用 |
| Node.js 18+ | bin/inputs 的 .mjs 脚本 | 心跳不可用 |
| DSH + web profile | 宿主环境；**`web_search` 工具（标准接口）供浏览流闲逛** | 项目本体；缺 web_search 则闲逛降级为无 |
| DSH + web profile | 宿主环境 | 项目本体 |
| 第三方 profile 插件 | 见 profile bundles | 仅 UI 增强，非核心 |

---

## 7. 数据设计

### 目录布局（物理隔离承诺）

```
<dataHome>（默认 <仓库根>/../kohaku-data，可用 KOHAKU_HOME 覆盖）← 唯一可写区
├── ledger.md               账本（人肉可读，对话内登记入口）
├── seeds.json              素材池（TTL/计数/容量元数据）
├── screen.json / screen.jpg  屏幕脉搏快照（DPAPI 密文，只留最新）
├── envpulse.json           环境温度计快照
├── watch_state.json        浏览流状态（加密）
├── logs/
│   ├── heartbeat.jsonl     心跳决策留痕（30 天 retention）
│   └── active_chat_log.md  主动消息历史
└── backups/ share/         人设卡备份 / 分享稿
其余整台电脑                  ← 只读。永不写入/移动/重命名
```

### 加密方案（v0.1 落地 ✅）

**DPAPI 整文件加密（CurrentUser 作用域）**——不自管主密钥，Windows 登录身份即钥匙：

- 覆盖文件：`seeds.json`、`sent.json`、`screen.*`、`watch_state.json`（KHBV1 头标识密文）；
- 保持明文：`ledger.md`（人肉可读是设计目标）、`heartbeat.jsonl`（透明度审计，
  且不含进程名/窗口标题等原始观测）；
- 解密静默无弹窗：登录会话内自主可用 → 心跳无人值守不受影响；换账户/换机器均不可解；
- 明文窗口：仅单次读写间的毫秒级临时文件，用后即焚；
- 一键焚毁：`bin/burn.mjs` 预演 + `--yes` 双段确认，随机覆写 x3 后删除；
- 取舍记录：原设计 AES-256-GCM 自管主密钥信封，因沙箱禁 Node 捕获子进程管道
  + 少一层密钥管理少一类事故，改为 DPAPI 直加密；
- 边界声明：防他人/他机/误同步，不防同账户恶意软件。

---

## 8. 版本与路线

### 版本简史

| 版本 | 里程碑 |
|------|--------|
| v0 | 心跳闭环：素材池 + 闸门 + 账本流 |
| v0.1 | DPAPI 加密壳 + 一键焚毁 |
| v0.3 | 感官三件套（时间流 / 温度计 / 定向浏览）|
| v0.4 | 屏幕脉冲 |
| v0.5 | 可移植性 + 脱敏，路径走 KOHAKU_HOME |
| v0.6 | 通知通道 + SOP 反刍修正 |
| v0.7 | 浏览流·自由闲逛 |
| v0.8 | 时间感知切官方 time-context（KV Cache 安全）|
| v0.9 | 忙闲判定重做（键鼠退出 + 窗口类别）|
| v0.9.1 | 浏览流通道修复 + 功能实现手册 |
| v0.9.2 | tamako 评审修复（实时窗口探查/抓取调试/三隐患）|
| v0.9.3 | diag 诊断体检单 |
| v0.9.4 | 浏览流触发点补全（SOP 收集清单 + CLI 默认入口）|
| v0.9.5 | 浏览流闲逛改官方 `web_search`（Python+Bing 退役）；调度咨询制 |

### 路线

| 项 | 说明 |
|----|------|
| **v0.10 自省愿望清单** | 每周一次自问三问题，只产出不自动改配置（防愿望自我污染）；内容与节奏以人类伙伴拍板为准 |
| 乙方案扫描补账 | 远期备选：定期扫描会话库补账本，需脱敏管道成文后才启动 |
| —（已放弃）| ~~QQ 出口 / dsh-std 正式接入 / 生态收录~~ 不再开发 |

---

## 9. 开放问题

- [ ] 反刍 prompt 与素材抽取标准的长尾调优
- [ ] 心跳会话与日常会话的关系：专用 or 复用？
- [ ] 自省愿望清单的内容与节奏（v0.10 前与人类伙伴对齐）

---

## 10. 开发守则

1. **需要人工解决的事直接叫人类伙伴**（登录、重启、授权、点按钮），不要反复自行尝试；
2. **重要变更先问再写**：设计文档修订、隐私安全相关决定、边界外操作——AI 提议、人类拍板；
3. 每次提交保持"心跳可跳"的最小可用状态；
4. 所有新能力先过宪章自检再合并；
5. 参数（频率/配比/阈值/TTL）以实际运行反馈为准，文档值仅为初值。