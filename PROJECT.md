# Codex Taskboard 复刻

## 目标

在本机提供一个独立于任何对话的 Codex 全局任务工作层，用项目、任务状态和活动记录承载跨对话上下文。看板常驻 Codex 全局侧栏；对话只是任务被执行时按需创建或关联的下游入口。当前实现以视频对应的开源项目 `chuspeeism/dashi-taskboard` 为功能基线，并保留其 Apache-2.0 许可。

## 核心操作路径

`Codex 全局侧栏 Taskboard` → `打开独立任务页` → `创建或更新任务` → `Taskboard HTTP API 写入 SQLite` → `Codex Skill / taskctl 领取并更新任务` → `SSE / WebSocket 刷新看板` → `卡片状态、评论和执行进度可见` → `需要执行时才在新对话打开或关联既有对话`

开启项目级“自动认领待办”后，`todo` 是已授权执行队列：后台策略在队列为空时暂停调度实例但保留用户开关；新 `todo` 出现后重新激活；每轮按看板顺序处理全部可执行任务，逐项进入 `in_progress`，完成验证后进入 `in_review`，只由用户验收进入 `done`。

关键实现：

- Codex 全局入口与独立工作区挂载：`inject/codex-taskboard.user.js`
- 跨项目任务页面：`web/src/App.tsx`
- 看板列与任务卡：`web/src/components/BoardColumn.tsx`、`web/src/components/TaskCard.tsx`
- 任务详情与编辑：`web/src/components/TaskDetail.tsx`、`web/src/components/TaskEditor.tsx`
- 本地服务与 API：`server/index.mjs`、`server/app.mjs`
- SQLite 持久化：`server/database.mjs`
- Codex CLI 与 Skill：`cli/taskctl.mjs`、`skills/manage-taskboard/`
- Codex 启动、注入与任务交接：`scripts/codex-injector.mjs`

## 当前状态

- 源码修改已在 Taskboard Launcher 的真实 Codex 表面运行；全局侧栏、独立看板、本地服务与注入器主路径可用。
- SQLite 可持久化看板状态、执行目标和任务绑定，并能在服务重启后恢复。
- 自动认领策略为 `Running`，每 5 分钟检查一次，使用 `gpt-5.6-sol` 与 `max` 推理强度；空队列仅暂停当轮执行，不会关闭用户开关。
- 任务进入 `todo` 前必须选择已保存的 Codex 项目。策略持久化精确项目身份，并按每个任务的 `executionTarget` 路由到对应项目。
- 两个分别指向不同已保存项目的真实任务均被自动认领、创建独立 Codex 任务并写入完整绑定；`todo` 队列已清空。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run check
npm start
npm run codex
```

本地服务默认地址：`http://127.0.0.1:47823`。

## 验证门

1. `npm run build` 成功。
2. 完全退出普通 Codex 后，由已安装的 `Codex Taskboard.app` 启动官方 Codex；全局侧栏出现固定 `Taskboard` 入口。
3. 打开 `Taskboard` 后，主工作区不显示任何对话 composer。
4. 全局任务页可打开任务详情；手动模式下只有显式触发 `Open in new conversation` 才进入对话交接，自动认领模式由后台策略创建或复用执行会话。
5. 本地服务可创建项目和任务，并把任务跨状态移动。
6. 看板刷新和服务重启后仍能从 SQLite 恢复任务状态。
7. 页面在桌面与窄屏下无关键溢出、遮挡或截断。

## 本次验证结果

- 当前主 Codex：全局侧栏 `Taskboard` 入口、独立看板、Automation 设置与任务状态均已在真实安装 App 中完成现场一致性验证。
- 自动认领真实闭环：策略从 `todo` 领取两个目标项目不同的任务，分别写入完整 Codex 项目、主机、工作区和新任务绑定，状态进入 `in_progress`；没有把任务错误投递到控制项目。
- 数据持久化：项目目录、任务的 `executionTarget` 和 conversation binding 已通过服务端与 SQLite 主路径写入。
- 现场视觉证据保留在本机交付目录，不纳入公开仓库。
- 聚焦 Node 测试：119 通过、0 失败；覆盖 CLI、服务端与 SQLite、Cloud companion、注入器、自动认领策略和全局项目路由。
- TaskEditor 状态与草稿恢复回归页：通过 Codex 内置浏览器验证提交 payload。
- TypeScript 类型检查：通过。
- 生产 Web 构建：通过；仅保留现有大 chunk 性能提示。
- 生产依赖审计：上游锁定的 `js-yaml@4.1.1` 当前报告 1 个 high severity 已知漏洞；依赖升级不混入本功能 PR。
- PR CI 与代码审查结果在 PR 创建后记录。
- 未执行：合并到 `main`、发布新版本、Cloudflare 部署。

## 交付目录

- 源码：当前目录
- Web 构建：`dist/`
- 本地数据：`.data/taskboard.sqlite`（运行后生成，已被 Git 忽略）
- 视觉验证材料：本机 `output/`（不纳入公开仓库）
