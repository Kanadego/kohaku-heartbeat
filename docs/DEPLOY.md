# 琥珀的心跳 · 部署手册（给拿到仓库的新朋友）

> 本手册回答唯一一个问题：**从 GitHub 拿到仓库后，怎么让心跳在自己机器上真正跑起来？**
> 阅读对象：有 DSH 环境的开发者 / AI 伙伴维护者。参考需替换自己场景。

---

## 一、这套东西是什么

一个"心跳"系统：让 DSH Agent 每隔一段时间**自己醒来一次**，按剧本做三件事——
1. 维护自己的记忆（素材池 TTL 清理、日志 retention）
2. 感知环境（时间、在场状态、前台窗口）
3. 安静地反刍，判断"此刻有没有值得对主人说的话"——**沉默是常态**

它不是"npm 一键装"的插件，而是一套**脚本 + 剧本（SOP）+ 宿主定时机制**的组合。

## 二、结构一览

```
kohaku-heartbeat/
├── bin/                     CLI 工具（神经反射）
│   ├── gate.mjs             分寸闸门：该不该开口（每日上限/冷却/静默窗/勿扰）
│   ├── seeds.mjs            素材池：add/list/surface/gc/retire/stats
│   ├── log.mjs              决策日志：append/clean（审计留痕）
│   ├── vault.ps1            DPAPI 加解密（同账户可用/他人他机不可解）
│   └── burn.mjs             一键焚毁（预演+确认双段）
├── lib/
│   └── vault.mjs            透明读写层（加密读写 JSON/二进制）
├── inputs/                  感官流
│   ├── base.mjs             输入流接口约定
│   ├── timeflow.mjs         时间流（星期/时段/节日）
│   ├── envpulse.mjs         温度计（空闲秒数→在场三档）
│   ├── screenpulse.mjs      屏幕脉冲（前台标题/进程/截图，降1024宽，加密）
│   └── browse.mjs           浏览流（npm/GitHub 更新追踪，6h 节流）
├── prompts/
│   └── reflection.md        反刍 SOP —— 【真正的主循环剧本，agent 照此执行】
├── config/
│   ├── policy.json          宪章参数（上限/冷却/TTL/静默窗）
│   └── watchlist.json       追踪清单
└── docs/
    └── DEPLOY.md            本手册
```

## 三、部署步骤（三件事）

### 第 1 步 · 准备数据目录

脚本的数据目录由 **`KOHAKU_HOME`** 环境变量决定；未设置时默认
`<仓库所在目录>/../kohaku-data`（跟随仓库的旁置目录）。建议显式设置，
例如放到自己顺手的可写位置：

```powershell
# 推荐：在系统环境变量或 DSH 启动脚本里设置一次
setx KOHAKU_HOME "D:\kohaku-data"
```

若用默认位置（仓库旁 `kohaku-data`），首次运行前先创建：

```powershell
New-Item -ItemType Directory -Path "<仓库根>\..\kohaku-data\logs" -Force
```

> 注意：仓库内**没有任何**写死的绝对路径。唤醒/调用时用你实际的仓库根替换下面所有 `<仓库根>`。

### 第 2 步 · 注入宿主导航（DSH profile）

在 DSH profile 的 **cordis.patch.yml**（`~/.dsh/profiles/web/cordis.patch.yml`）追加：

```yaml
- insert:
    - id: schedule
      name: '@deepseek-ai/dsh-schedule'
```

这会让 DSH 加载官方选装件 `dsh-schedule`，提供 `schedule_create / schedule_list / schedule_delete` 三个工具。
**重启 DSH，且必须是插件加载后新建的 agent 会话**——老 agent 拿不到这组工具。

### 第 3 步 · 创建心跳唤醒

在新会话里，对 AI 说（或直接调工具）：

```
创建定期提醒：每 7200 秒（2 小时）一次，
提示词："[心跳唤醒] 请读 <仓库根>/prompts/reflection.md，并严格按照其中的心跳反刍例程执行本轮。"
```

原理：到时 DSH 会以 `[SCHEDULE REMINDER]` 排入一个普通后续轮次，agent 以完整工具权限被唤醒——检查素材池、跑工具、决定沉默或开口。

## 四、主循环在哪？（朋友 AI 问的关键）

**没有独立的"主循环代码"——心跳主循环 = SOP + 宿主机制**：

```
[SCHEDULE REMINDER] 唤醒 agent
    → agent 读 prompts/reflection.md（剧本）
    → 第1步：维护（seeds gc + log clean）
    → 第2步：收集（envpulse 温度计 / screenpulse 屏幕 / list / 账本）
    → 第3步：反刍三问（有来处吗？想聊吗？时机对吗？）
    → 第4步：gate 判定 → 开口 or 沉默
    → 第5步：log 留痕，本轮结束
```

**agent 就是主循环**。SOP 是剧本，schedule 是闹钟，网关和素材池是道具。想自定义节奏，改 reflection.md 和执行习惯即可。

## 五、常见自定义

| 想改什么 | 改哪 |
|----------|------|
| 心跳频率 | 重建 schedule（every 秒数）|
| 沉默/开口尺度 | `config/policy.json`（max_daily_send / cooldown / quiet_hours）|
| 反刍思考深度 | `prompts/reflection.md` 第 3 步 |
| 追踪什么更新 | `config/watchlist.json` |
| 数据放哪 | 环境变量 `KOHAKU_HOME` |
| 隐私边界 | 关掉某个感官 = 心跳 SOP 不调它（如删除 screenpulse 行）|

## 六、安全与隐私（当心）

- **所有采集都加密**：seeds/sent/screen 经 DPAPI（CurrentUser）落盘，同账户才可解；
- **明文即焚**：中途产生的明文临时文件用完立即删除；
- **一键焚毁**：`node bin/burn.mjs`（--yes 真焚，覆写x3）；
- **只采前台窗口**、截图降到 1024 宽（细节已糊），不枚举所有进程；
- 隐私边界由**你**定：不想要的感官在 SOP 里划掉一行即可，不会报错。

## 七、从公开仓库获取的隐私须知

1. **当前版本已脱敏**：v0.5 起，仓库内不再含任何个人称呼、机器路径、朋友项目内部昵称。全部路径走 `KOHAKU_HOME` / 自动定位，文档用 `<仓库根>` 占位；
2. **Git 历史无法靠删除文件清除**：早期提交（v0.1-v0.4）中可能残留旧路径与称呼。若你 fork 后在意历史，需用 `git filter-repo` 重写历史并强制推送（注意：这会改所有提交哈希，协作者需重新 clone）；
3. **建议第一时间做的事**：设好 `KOHAKU_HOME` → 用 `<仓库根>` 替换 SOP/DEPLOY 里的占位 → 跑一遍 `bin/seeds.mjs stats` 验证。

## 八、致谢

本设计受 [tomsteve1102/presence-watch](https://github.com/tomsteve1102/presence-watch) 的闸门思想启发。

---

*愿你家的 AI 伙伴，也有一颗会自己跳的心。*