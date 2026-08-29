import path from "node:path";
import { fileURLToPath } from "node:url";

const taskctlCliPath = fileURLToPath(new URL("../cli/taskctl.mjs", import.meta.url));

const AUTOMATION_OPERATIONS = new Set(["ensure-active", "pause", "list", "apply-policy"]);
const INTERVAL_MINUTES = new Set([5, 10, 15, 30, 60]);
const HOST_REQUEST_FIELDS = new Set([
  "id",
  "action",
  "requestId",
  "operation",
  "taskboardProjectId",
  "codexProjectId",
  "codexProjectKind",
  "codexHostId",
  "projectName",
  "workspacePath",
  "remoteProjects",
  "codexProjects",
  "skillPath",
  "automationId",
  "enabledByUser",
  "quotaAware",
  "intervalMinutes",
  "model",
  "reasoningEffort",
]);

export function parseTaskboardAutomationHostRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((field) => !HOST_REQUEST_FIELDS.has(field))) return null;
  if (value.action !== "automation") return null;
  if (!validIdentifier(value.id, 80) || !validIdentifier(value.requestId, 100)) return null;
  if (!AUTOMATION_OPERATIONS.has(value.operation)) return null;
  if (!validProjectId(value.taskboardProjectId)) return null;
  if (!validText(value.codexProjectId, 256) || !validText(value.projectName, 200)) return null;
  const codexProjectKind = value.codexProjectKind ?? "local";
  const codexHostId = value.codexHostId ?? "local";
  if (codexProjectKind !== "local" && codexProjectKind !== "remote") return null;
  if (!validText(codexHostId, 256)) return null;
  if (codexProjectKind === "local" && codexHostId !== "local") return null;
  if (codexProjectKind === "remote" && codexHostId === "local") return null;
  if (!validAbsolutePath(value.workspacePath) || !validAbsolutePath(value.skillPath)) return null;
  const remoteProjects = value.remoteProjects === undefined ? [] : value.remoteProjects;
  if (
    !Array.isArray(remoteProjects)
    || remoteProjects.some((project) => (
      !project
      || typeof project !== "object"
      || Array.isArray(project)
      || Object.keys(project).some((field) => ![
        "codexProjectId",
        "codexProjectKind",
        "codexHostId",
        "workspacePath",
      ].includes(field))
      || !validText(project.codexProjectId, 256)
      || project.codexProjectKind !== "remote"
      || project.codexHostId !== codexHostId
      || !validAbsolutePath(project.workspacePath)
    ))
    || (codexProjectKind === "local" && remoteProjects.length > 0)
  ) return null;
  const codexProjects = value.codexProjects === undefined ? [] : value.codexProjects;
  if (
    !Array.isArray(codexProjects)
    || codexProjects.some((project) => (
      !project
      || typeof project !== "object"
      || Array.isArray(project)
      || Object.keys(project).some((field) => ![
        "codexProjectId",
        "codexProjectKind",
        "codexHostId",
        "workspacePath",
      ].includes(field))
      || !validText(project.codexProjectId, 256)
      || (project.codexProjectKind !== "local" && project.codexProjectKind !== "remote")
      || !validText(project.codexHostId, 256)
      || (project.codexProjectKind === "local" && project.codexHostId !== "local")
      || (project.codexProjectKind === "remote" && project.codexHostId === "local")
      || !validAbsolutePath(project.workspacePath)
    ))
  ) return null;
  if (!INTERVAL_MINUTES.has(value.intervalMinutes)) return null;
  if (!validText(value.model, 256) || !validText(value.reasoningEffort, 100)) return null;
  if (value.automationId !== undefined && !validText(value.automationId, 256)) return null;
  if (typeof value.enabledByUser !== "boolean" || typeof value.quotaAware !== "boolean") return null;

  return {
    id: value.id,
    action: "automation",
    requestId: value.requestId,
    operation: value.operation,
    taskboardProjectId: value.taskboardProjectId,
    codexProjectId: value.codexProjectId,
    codexProjectKind,
    codexHostId,
    projectName: value.projectName,
    workspacePath: value.workspacePath,
    ...(value.remoteProjects === undefined ? {} : { remoteProjects }),
    ...(value.codexProjects === undefined ? {} : { codexProjects }),
    skillPath: value.skillPath,
    ...(value.automationId === undefined ? {} : { automationId: value.automationId }),
    enabledByUser: value.enabledByUser,
    quotaAware: value.quotaAware,
    intervalMinutes: value.intervalMinutes,
    model: value.model,
    reasoningEffort: value.reasoningEffort,
  };
}

export function buildTaskboardAutomationName(request) {
  return `Taskboard 自动认领 · ${request.taskboardProjectId}`;
}

export function buildTaskboardAutomationPrompt(request) {
  const taskctlCommand = buildTaskctlCommand(request);
  const remoteProject = request.codexProjectKind === "remote";
  const remoteProjects = request.remoteProjects ?? [];
  const codexProjects = request.codexProjects ?? [];
  const routedInbox = Object.hasOwn(request, "codexProjects");
  const executionInstructions = routedInbox
    ? [
        `本自动化是全局收件箱控制器；当前工作区只承载调度，不得用于猜测或替代任务目标。当前可用 Codex 项目的精确 identity 目录是 ${JSON.stringify(codexProjects)}。每条 todo 的首次路由必须使用 issue.executionTarget 中保存的 codexProjectId、codexProjectKind、codexHostId、workspacePath 四个字段；已进入 in_progress 的任务只使用其完整 threadBinding 恢复原会话。`,
        "先完成整批读取再派发：按 issue list 顺序对本轮每个 todo 和每个 resumableInProgress 运行 issue get、comment list 和 attachment list --task，读取完整 issue get 任务快照、全部评论、附件清单以及理解需求和分组所需的附件内容；再对 comment list 返回的每条评论运行不带 --after 的 attachment list --comment COMMENT_ID。分别保存完整 issue get 任务快照、任务评论、任务附件和每条评论附件的完整快照与独立 nextCursor。权威全量需求快照固定包含：完整 issue get 返回的当前任务快照（包括 identifier、title、description、status、priority、labels、startDate、dueDate、recurrence、relations、developmentContext、executionTarget 及其余返回字段）、全部用户评论、全部 task attachments、全部逐评论 attachments 和 currentSnapshotToken。为每个任务按固定紧凑 JSON 生成确定性的 currentSnapshotToken，键及顺序严格为 {\"issueVersion\":issue.version,\"userComments\":[按评论 ID 排序的 [ID,version]],\"taskAttachments\":[按 ID 排序的 ID],\"commentAttachments\":[按用户评论 ID 排序的 [评论 ID,[按附件 ID 排序的附件 ID]]]}；token 只能包含这四项，不得加入任何其他任务字段、nextCursor 或控制器状态。各 nextCursor 只用于增量读取，不进入 token，当前控制器自行写入的进度 comment 及其 cursor 变化也不进入 token。完整 issue get 任务快照的任何变化由 issue.version 体现，用户评论和附件的创建、修改或删除由 version 与完整 ID 集合体现。描述或最新评论明确要求等待、暂不执行或当前不应开始时，保持 todo 且不认领；已经进入 in_progress 的任务仍须保留在 resumableInProgress，由其保存会话继续等待或执行。批量快照完成前不得创建会话、读取项目代码或改变任何任务状态。",
        "先检查每个 todo 的 threadId 和 threadBinding，再解析 actualTarget。未绑定任务的 executionTarget 四字段必须完整，且必须与精确 identity 目录中的恰好一项四字段完全相同；缺失、零项或多项命中时，使用 comment add 记录“目标 Codex 项目未指定或当前不可用”，再用最新 version、--if-version 和 --clear-binding-thread 移到 blocked。已有完整 threadBinding 时，catalog 暂时找不到该项目不代表绑定失效；只核对保存 binding 与 executionTarget 四字段是否完全一致。若不一致，记录冲突并使用最新 version、--if-version 和五个完整 binding 参数移到 blocked，必须保留原 binding，绝不能使用 --clear-binding-thread。不得按标题、描述、项目名或路径相似度猜测。只保留 relations.blockedBy 为空或其中每个依赖的 status 都严格等于 done 的 todo 候选，未完成依赖只跳过当前任务。",
        "在任何派发前，按依赖、actualTarget 四字段、共享功能链、可能修改的文件、developmentContext 和共享运行资源划分执行组；同一项目内紧密相关且可能冲突的任务放进同一会话和同一 worktree，独立冲突域可并行。不得固定一题一会话，也不得把不同 actualTarget 的任务放入同组。已有 threadBinding 的任务各自回到保存的会话，不与新任务成组。",
        "若任务有 threadId 但没有完整 threadBinding，这是不可自动核验的 legacy local 绑定：使用 comment add 记录原因，再用首次读取的 version 和 --if-version、--binding-thread-id 保留原 threadId 将任务移动到 blocked。若已有完整 threadBinding，它的四字段项目 identity 必须与 actualTarget 完全一致；不一致时记录冲突并移到 blocked，不得覆盖绑定或另建会话。",
        "先恢复 resumableInProgress：逐项 issue get，只接管 status 仍严格等于 in_progress、archivedAt 为 null、threadBinding 五字段完整的任务。完整 binding 的四字段 identity 必须与当前 executionTarget 完全一致；不一致时记录冲突，再使用本次快照 version、--if-version 和五个完整 binding 参数移到 blocked，保留原 binding，不得联系旧会话。通过核对后保存 ownedVersion、完整 binding、executionTarget 和 currentSnapshotToken，再按 threadBinding.threadId 与 codexHostId 分组。每个任务在本次定时运行第一次 wait_threads 前，必须立即重做上述 version/status/archive/binding/target 所有权核对；通过后向保存的 threadId 与 codexHostId 发送本轮已经读取的权威全量需求快照，其中必须逐项发送完整 issue get 当前任务快照及其 developmentContext、executionTarget、全部用户评论、task attachments、逐评论 attachments 和 currentSnapshotToken，并明确本快照替换旧要求、未出现的旧字段、评论或附件视为已撤回。执行会话必须先将当前工作和实际 workspace/worktree 与最新 developmentContext 协调一致；无法采用最新 developmentContext 时不得回传该 token 作为已完成。协调完成后才可在下一次 complete handoff 逐任务原样回传 currentSnapshotToken。send 成功后才使用 wait_threads 等待原执行会话；不得重新认领、create_thread、覆盖或清除 binding。send 返回 NOT_FOUND/CLOSED 或临时失败时按后述终态与临时失败规则处理。catalog 暂时缺项不影响恢复。",
        "resumableInProgress 的原会话仍在执行、等待用户确认、等待 CI 或等待必要审查时，保留 in_progress，保存本轮新增的实质性进展后继续其他组；下一次定时运行必须再次进入同一恢复路径。只有工具明确返回 NOT_FOUND 或 CLOSED 时才可尝试移到 blocked。任何进度 comment 或状态写回前都重新 issue get，且仅当 version 仍等于 ownedVersion、status 仍严格等于 in_progress、archivedAt 仍为 null、完整 binding 与保存值完全相同、executionTarget 与保存 binding 的四字段 identity 完全相同时才可继续；任一条件变化就停止处理该任务，不写 comment、不改状态、不采用更新后的 version 重试。",
        "resumableInProgress 的原会话完成时，按与新执行组相同的交接标准核验结果，并要求每个任务的 handoff 原样回传本轮最新 currentSnapshotToken；token 缺失或不一致时只向同一 threadId 重发权威全量需求快照并继续 wait_threads，不得接受该 handoff。证据缺失或所需审查未完成时，只向同一 threadId 发送 follow-up 并继续 wait_threads。交接完整、token 一致、直接验证通过且所需审查完成后，再执行上述所有权复核；通过后写一条最终 comment，并以 ownedVersion、--if-version 和五个完整 binding 参数移到 in_review。不得另建会话、合并、发布或标记 done；409 时停止处理，不得读取新 version 覆盖。",
        "已有完整 threadBinding 且仍为 todo 时，只能向保存的 threadId 与 codexHostId 调用 send_message_to_thread，发送议题编号、标题、完整描述、全部评论、附件和最新返工要求。send 成功后重新 issue get，确认仍为未归档 todo 且 binding 未变，再使用返回的最新 version、--if-version 和完整 binding 移到 in_progress。只有工具明确返回 NOT_FOUND 或 CLOSED 才可认定旧会话终态失效：先重新 issue get，确认 version、未归档 todo、完整旧 binding 和 executionTarget 四字段仍与本轮保存值完全相同；再使用 comment add --thread-id \"$CODEX_THREAD_ID\"，在正文逐项记录终态以及旧 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath。comment add 不传任何 --binding-* 参数，也不改变 task version；随后用该次 issue get 的 version、--if-version、issue move --status todo 和 --clear-binding-thread 原子退休旧 task binding。成功后只重新 issue get 一次；仅当仍为未归档 todo、threadId 与 threadBinding 均为空、executionTarget 与保存 actualTarget 四字段完全相同，才重新读取完整 comment、task attachment 及逐评论 attachment 快照，并把该任务作为同一候选进入正常未绑定新执行组和 create_thread 路径。任一复核变化或 409 都停止处理，不得清除、重试或采用新 version。timeout、网络失败、catalog 缺项或主机暂时不可达时保留 binding 并跳过，不得清除或抢占。",
        "对每个新执行组逐项重新 issue get，确认快照后的 version、status、archivedAt、依赖、要求和 actualTarget 均未变化，再使用各自最新 version 执行 issue move --status in_progress --if-version 并传 --clear-binding-thread；每条任务独立保存 ownedVersion。发生 409 时只从本组移除该任务，不得用新 version 覆盖。认领成功后、执行代码前，每个任务只写一条初始 comment：记录认领、组内任务、分组理由、small/medium/high 风险、预定直接验证，以及“entry point -> action -> component/API/data change -> observable result”真实路径。",
        `每个仍有已认领任务的执行组只调用一次 Codex create_thread。先用 list_projects 按 actualTarget.codexProjectId 精确确认项目；Git 仓库使用 environment:{type:"worktree"}，非 Git 项目使用 environment:{type:"local"}。显式使用 model=${JSON.stringify(request.model)}、thinking=${JSON.stringify(request.reasoningEffort)}。指令必须包含组内每个议题的完整 issue get 当前任务快照、全部用户评论、task attachments、逐评论 attachments、currentSnapshotToken、developmentContext、actualTarget、分组决定和 E3 路径；要求同一执行会话从实现、直接验证、适用的 branch/worktree 与 PR、精确 head SHA、CI、风险分级代码审查到返工全程负责，并在每个任务 handoff 原样回传已应用的 currentSnapshotToken，同时返回改动文件、commit、直接验证、PR、CI、审查决定/结果和剩余限制；非代码任务明确标记不适用项。执行会话不得运行 taskctl、不得改看板状态、不得合并、发布或标记 done。`,
        "create_thread 必须返回可用 threadId 才算派发成功。失败时用一条最终 comment 记录具体错误，再对组内每条已认领任务使用自己的 ownedVersion、--if-version 和 --clear-binding-thread 移回 todo，其他组继续。成功后逐项重新 issue get；只有 version 仍等于 ownedVersion、status 仍严格等于 in_progress、archivedAt 仍为 null、threadId 和 threadBinding 仍为空、executionTarget 与该组 actualTarget 四字段完全相同时，才使用 ownedVersion、--if-version 和完整 binding 参数保持 in_progress，把同一 threadId 与 actualTarget 四字段持久化。任一条件变化时，只通知新会话排除该任务，禁止写看板、采用新 version 或重复派发。每次成功响应更新该任务的 ownedVersion。某条绑定保存失败时，记录 threadId 并把该条任务移到 blocked，再用 send_message_to_thread 通知执行会话排除该任务，禁止重复派发。",
        "独立执行组使用 wait_threads 并行等待，不并行操作同一个共享 Launcher、Codex 注入、原生宿主、更新器、签名或发布运行时。执行会话要求用户确认工作演示、需要外部输入或正在等待 CI/必要审查时，添加一条实质性进度 comment 并保持 in_progress；不要把正常验收或外部等待误记为 blocked，也不要因此停止其他组。只有明确无法继续的任务才记录原因并移动到 blocked。",
        "每次 wait_threads 返回后，在发送任何新的 send_message_to_thread 或 follow-up 前，先对该会话涉及的每条任务重新 issue get；只保留 version 仍等于各自 ownedVersion、status 仍严格等于 in_progress、archivedAt 仍为 null、完整 binding 与保存值完全相同、executionTarget 与保存 binding 的四字段 identity 完全相同的任务。任一条件变化就停止处理该任务，不得在 follow-up 中继续要求其工作，也不得采用更新后的 version；若该会话已没有仍由本控制器拥有的任务，不发送 follow-up。",
        "同一次 post-wait 复核还必须在发送 follow-up 或接受 complete handoff 前，使用批量快照保存的独立 nextCursor 运行 comment list ISSUE_ID --after COMMENT_CURSOR、attachment list --task ISSUE_ID --after TASK_ATTACHMENT_CURSOR，并对每条已知评论运行 attachment list --comment COMMENT_ID --after COMMENT_ATTACHMENT_CURSOR；对本次新出现的评论先运行不带 --after 的 attachment list --comment COMMENT_ID 并保存其独立 cursor。增量读取后还必须运行不带 --after 的 comment list ISSUE_ID、不带 --after 的 attachment list --task ISSUE_ID，并对当前完整评论集中的每条评论运行不带 --after 的 attachment list --comment COMMENT_ID；把当前评论 ID、任务附件 ID、每条评论附件 ID 的完整集合与已应用增量后的保存快照逐项比较。任何已保存 ID 消失都视为删除或撤回；父评论消失时连同其保存的附件 ID 一并记录。若发现新的、修改的或删除的用户评论、任务附件或评论附件，先通过上述所有权检查，再用完整读取结果替换对应快照与 cursor、重新生成 currentSnapshotToken，并把权威全量需求快照、完整增量或删除清单和新 token 发送给原 thread，要求下一次 handoff 原样回传新 token，然后继续 wait_threads；不得接受基于旧快照或旧 token 的 handoff、写最终 comment 或移到 in_review。当前控制器自己写入或删除的进度 comment 只更新快照与 cursor，不进入 token，也不作为新执行要求重复发送。",
        "执行会话完成时先核验交接：每个任务都必须原样回传控制器最后发送且当前仍有效的 currentSnapshotToken；代码任务还必须包含改动文件、commit、精确 head SHA、直接路径验证、PR、CI 状态、review complexity 决定、所需审查结果和剩余限制；非代码任务还必须包含产物、验证、结果和剩余限制。token 不一致、证据缺失或所需审查未完成时，只向同一 threadId 发送权威全量需求快照或 follow-up 并继续等待，不得另建会话或提前移动状态。",
        "只有交接完整、直接验证通过且所需审查完成后，才逐项重新 issue get；只有 version 仍等于 ownedVersion、status 仍严格等于 in_progress、archivedAt 仍为 null、完整 binding 与保存值完全相同、executionTarget 与保存 binding 的四字段 identity 完全相同时，才写一条最终 comment，记录其实际改动、验证、PR/CI/审查或不适用说明、精确 SHA 和限制，随后用该任务自己的 ownedVersion、--if-version 和完整保存 binding 移到 in_review。任一条件变化或发生 409 时停止处理该任务，不得采用更新后的 version 覆盖。不得合并、发布或标记 done，in_review 只表示已准备好由用户检查确认。",
        "每条任务维护独立的快照、ownedVersion 和 binding；每个执行组维护独立 threadId。所有 taskctl 读写只由当前控制器完成；单个任务的跳过、冲突、blocked、会话失败或等待不得阻断后续任务和独立执行组。Taskboard 服务不可用才结束整轮。",
      ]
    : remoteProject
    ? [
        `本自动化仅在本机作为任务面板控制器运行；实际开发必须派发到 Codex SSH 远程项目。导入项目的基础 identity 是 projectId=${JSON.stringify(request.codexProjectId)}、hostId=${JSON.stringify(request.codexHostId)}、workspacePath=${JSON.stringify(request.workspacePath)}；同一保存主机当前可用的精确远程项目映射是 ${JSON.stringify(remoteProjects)}。不要在当前本地自动化会话修改项目文件。`,
        "按 issue list 的返回顺序建立本轮 todo 候选队列，并处理其中每一个依赖已完成的议题：relations.blockedBy 为空，或其中每个依赖的 status 都严格等于 done。未完成依赖只跳过当前议题，不影响后续候选；若全部候选都被依赖阻塞，本轮结束，不创建或打开新的任务会话。",
        "逐个处理本轮尚未尝试且符合依赖条件的 todo：每个议题先用 issue get 读取最新内容，并用 comment list 读取全部评论。根据描述和最新评论判断是否允许开始；若其中写明等待、暂不执行或当前不应开始，跳过当前议题并继续下一个，不改状态。评论也包含已完成后被打回的返工要求。",
        "完成 issue get 和 comment list 后、移动状态前，必须再次运行 issue get，并复核 relations.blockedBy 仍为空或其中每个依赖的 status 都严格等于 done。若依赖条件不再满足，跳过当前议题并继续下一个，不改状态。",
        "先检查 issue get 的 projectId、version、status、archivedAt、threadId 和 threadBinding。完整 threadBinding 包含 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath，且它是该议题后续 send、wait 和状态写回的唯一目标；当前自动化的项目和主机只能作为未绑定议题的首次目标，不能替换已有绑定。若存在 threadId 但没有完整 threadBinding，这是只能由 UI 打开的 legacy local 绑定：使用 comment add 说明自动化无法确认项目和主机，再使用首次读取的 version 作为 --if-version、用 --binding-thread-id 保留原 threadId 将议题移动到 blocked；若冲突就跳过当前议题并继续下一个。不得 send、create 或覆盖该绑定。",
        `未绑定议题必须先从上述精确远程项目映射解析 actualTarget。若 developmentContext.type 是 worktree，只保留 codexProjectKind="remote"、codexHostId=${JSON.stringify(request.codexHostId)} 且 workspacePath 与 developmentContext.path 完全相同的项；必须恰好命中一项，并使用该项自己的 codexProjectId、codexHostId 和 workspacePath。零项或多项时使用 comment add 明确记录“目标 SSH worktree 未映射”，随后跳过当前议题并继续下一个，不认领、不 create、不写基础项目 binding。若没有 worktree，actualTarget 才是上述基础 identity，并且它必须存在于精确映射中。不得回退到基础 root、local、项目名、其他主机或同路径的其他主机。`,
        "确认允许开始后，只有未绑定且仍为未归档 todo 的议题才可在读取代码、下载附件、分析或实施前，由当前本地控制器使用刚读取的 version 移到 in_progress。已有完整 threadBinding 时，issue move 必须同时传 --binding-thread-id、--binding-codex-project-id、--binding-codex-project-kind、--binding-codex-host-id、--binding-workspace-path 的保存值，但在旧会话 send/stale 判断完成前不得把这个 todo 移到 in_progress；stale 清除步骤按后文显式使用 --clear-binding-thread。未绑定时必须传 --clear-binding-thread，避免把本地控制器 CODEX_THREAD_ID 写成任务绑定。写入成功后记录响应 task 的 version 为 ownedVersion、projectId 为 ownedProjectId，并记录本轮 binding；以后本轮每次 issue move 都必须显式传 --if-version ownedVersion，成功后再用响应 version 更新 ownedVersion。不得省略 --if-version 后让 taskctl 自动读取最新 version。写入成功前不得继续。所有认领、评论和状态写入只由当前本地控制器完成，不得要求远程会话运行 taskctl。",
        "若因 version 陈旧发生版本冲突，重新运行 issue get 和 comment list；仅当仍为可认领 todo、绑定身份未变化、未归档且描述和最新评论未变化时，用最新 version 重试一次。若已被认领、绑定、状态或要求已变、已归档或重试仍失败，跳过当前议题并继续下一个；服务不可用或永久 API 错误才结束整轮。不得抢占或循环重试。",
        "认领成功后，已有完整 threadBinding 时，只能使用其保存的 threadId 和 codexHostId 调用 Codex send_message_to_thread。send 成功后必须重新 issue get 一次，确认 projectId 未变、未归档、status 仍为 todo 且完整 threadBinding 与保存值完全相同；然后由当前本地控制器使用这次复核返回的最新 version、完整旧 binding 和 --if-version 执行 issue move --status in_progress，传入 --binding-thread-id、--binding-codex-project-id、--binding-codex-project-kind、--binding-codex-host-id、--binding-workspace-path，并记录响应 task.version 为 ownedVersion。认领成功后继续执行后文现有 Codex wait_threads、结果评论和 in_review 写回路径；若认领发生 409，跳过当前议题，不得重读新 version 覆盖。只有旧会话工具明确返回终态 NOT_FOUND 或 CLOSED 等会话不存在或已关闭结果时，才确认 stale。timeout、network failure 或 Codex host 暂时不可达都不是 stale：保留 binding，跳过当前议题并继续下一个，不得猜测、clear、create 或抢占。Taskboard service unavailable 时结束整轮。若任务已是 in_progress、活跃、已归档、状态或 binding 已变化，跳过当前议题并继续下一个，不得在当前自动化目标创建替代会话。只有未绑定议题才使用 Codex create_thread 创建远程任务，target 必须是 {type:\"project\",projectId:actualTarget.codexProjectId,environment:{type:\"local\"}}，首次 identity 必须使用 actualTarget 的 projectId、kind=\"remote\"、hostId 和 workspacePath。发送给远程会话的指令必须包含议题编号、标题、完整描述、全部评论和开发上下文，并说明远程会话不运行 taskctl，只需完成实现、验证并返回改动、结果和剩余风险。",
        "确认旧会话 stale 后，必须先重新 issue get，确认 projectId、version、未归档 todo、完整旧 binding 和 actualTarget 均与本轮保存值完全相同；再用 comment add --thread-id \"$CODEX_THREAD_ID\" 保存历史，并在正文逐项记录终态以及旧 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath。comment add 不传任何 --binding-* 参数，也不改变 task version。评论写入成功后，再使用该次 issue get 的 version 执行 issue move --status todo --clear-binding-thread --if-version；409 时跳过当前议题，Taskboard service unavailable 时结束整轮。然后只重新 issue get 一次；仅当 projectId 未变、未归档、status 仍为 todo、threadId 为空、threadBinding 为空且 actualTarget 未变时，才进入未绑定议题的现有认领和 create_thread 路径。",
        "仅当 send_message_to_thread 成功，或 create_thread 成功返回远程 threadId，才视为远程 worker 已确认。未绑定议题在 create_thread 失败时，使用 comment add 记录失败工具和错误；随后用 ownedVersion、显式 --if-version 和 --clear-binding-thread 将当前议题移回 todo，再继续下一个。若发生 409，说明其他控制端已修改任务，跳过当前议题且不得重读最新 version 后覆盖。此补偿只处理本轮当前已认领议题；不得扫描或接管其他 in_progress。",
        "新建远程任务成功后，使用 ownedVersion 和显式 --if-version 再次移动到 in_progress；必须用完整 binding 参数保存 create_thread 返回的 threadId，以及 actualTarget 的 projectId、kind=\"remote\"、hostId 和 workspacePath。成功后用响应 version 更新 ownedVersion 和本轮 binding。若请求响应丢失或结果不确定，只允许重新 issue get 一次；仅当 projectId 等于 ownedProjectId、未归档、状态仍为本轮 in_progress，且 threadBinding 为空或与本轮五字段 binding 完全相同时才可继续。读到相同 binding 视为前次保存成功；读到空 binding 时才可用本次核对后的 version 重试一次；读到不同 binding 或任一其他核对项变化时跳过当前议题，不得写回。若确定绑定写入失败，使用 comment add 记录失败和远程 threadId，再用 ownedVersion、显式 --if-version 和同一完整 binding 将议题移动到 blocked，然后继续下一个；409 时跳过当前议题且不得重复派发。",
        "使用 Codex wait_threads 等待远程会话时，目标必须使用任务保存的 threadBinding.threadId 和 threadBinding.codexHostId。wait_threads 失败、远程会话明确需要用户输入或无法继续时，使用 comment add 记录原因，再用 ownedVersion、显式 --if-version 和完整保存 binding 将议题移动到 blocked，然后继续下一个；409 时跳过当前议题。远程会话完成后，使用 comment add 写入改动、验证结果、执行结果和剩余风险，再用 ownedVersion、显式 --if-version 和完整保存 binding 将议题移动到 in_review，然后继续下一个。worker 确认后的每一次 issue move 都必须显式传完整远程 binding；不要把未完成工作标记为 in_review。",
      ]
    : [
        "按 issue list 的返回顺序建立本轮 todo 候选队列，并处理其中每一个依赖已完成的议题：relations.blockedBy 为空，或其中每个依赖的 status 都严格等于 done。未完成依赖只跳过当前议题，不影响后续候选；若全部候选都被依赖阻塞，本轮结束，不创建或打开新的任务会话。",
        "逐个处理本轮尚未尝试且符合依赖条件的 todo：每个议题先用 issue get 读取最新内容，并用 comment list 读取全部评论。根据描述和最新评论判断是否允许开始；若其中写明等待、暂不执行或当前不应开始，跳过当前议题并继续下一个，不改状态。评论也包含已完成后被打回的返工要求。",
        "完成 issue get 和 comment list 后、移动状态前，必须再次运行 issue get，并复核 relations.blockedBy 仍为空或其中每个依赖的 status 都严格等于 done。若依赖条件不再满足，跳过当前议题并继续下一个，不改状态。",
        `确认允许开始后，只有 threadId 和 threadBinding 都为空且仍为未归档 todo 的议题才可在读取代码、下载附件、分析或实施前认领。认领必须使用刚读取的 version 移到 in_progress，并显式传 --binding-thread-id "$CODEX_THREAD_ID"、--binding-codex-project-id ${JSON.stringify(request.codexProjectId)}、--binding-codex-project-kind "local"、--binding-codex-host-id ${JSON.stringify(request.codexHostId)}、--binding-workspace-path ${JSON.stringify(request.workspacePath)}，把当前自动化会话一次写成完整 binding；记录响应 task.version 为 ownedVersion。写入成功前不得继续。已有完整 binding 或 legacy local binding 的议题必须先按旧会话规则处理，不得先认领；不得认领已被其他会话绑定或其他 Agent 领取的议题。认领后的每一次 issue move 都必须显式传 ownedVersion 和这五个完整 binding 字段，成功后更新 ownedVersion。`,
        "若因 version 陈旧发生版本冲突，重新运行 issue get 和 comment list；仅当仍为可认领 todo、未绑定其他会话、未归档且描述和最新评论未变化时，用最新 version 重试一次。若已被认领、状态或要求已变、已归档或重试仍失败，跳过当前议题并继续下一个；服务不可用或永久 API 错误才结束整轮。不得抢占或循环重试。",
        `若首次 issue get 返回完整 threadBinding，议题已绑定原会话：不要在当前自动化会话认领；只能使用保存的 threadId 和 codexHostId 调用 Codex send_message_to_thread。send 成功时保留 binding，并继续下一个候选；只有工具明确返回终态 NOT_FOUND 或 CLOSED 等会话不存在或已关闭结果时才确认 stale。timeout、network failure、Codex host 暂时不可达或 Taskboard service unavailable 都保留 binding，跳过当前议题并继续下一个，不得猜测 stale。确认 stale 后，先重新 issue get，确认 version、未归档 todo、完整旧 binding 和 executionTarget 均与本轮保存值完全相同；再用 comment add --thread-id "$CODEX_THREAD_ID" 保存历史，并在正文逐项记录终态以及旧 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath。comment add 不传任何 --binding-* 参数，也不改变 task version；随后用该次 issue get 的 version 执行 issue move --status todo --clear-binding-thread --if-version。然后只重新 issue get 一次，仍为未归档 todo、threadId 与 threadBinding 都为空且 executionTarget 未变时，才在当前自动化会话处理。若任务已是 in_progress、活跃、已归档、状态或 binding 已变化，或发生 409，跳过当前议题并继续下一个，不得抢占。若返回 threadId 但没有完整 threadBinding，这是 legacy local 绑定：先调用 Codex list_threads（limit=50），合并 pinnedThreads 与 threads，并按完整 threadId 精确查找。只有恰好一项 kind="codex"、projectId=${JSON.stringify(request.codexProjectId)}、hostId=${JSON.stringify(request.codexHostId)}、cwd=${JSON.stringify(request.workspacePath)} 全部一致时，才把该项视为可核验旧会话；使用最新 issue version 执行 issue move --status todo --if-version，并显式传旧 threadId 及上述 projectId、kind="local"、hostId、workspacePath 五字段，将 legacy local 原位升级为完整 binding。升级成功后只向该旧 threadId 和 hostId 调用 send_message_to_thread，随后继续下一个候选，由旧会话按议题最新要求继续。若 list_threads 未找到、出现多项或任一字段不一致，不得迁移或发送；使用 comment add 记录实际不一致项，再用首次读取的 version 和 --if-version、--binding-thread-id 保留原 threadId 将议题移到 blocked，然后继续下一个。若升级发生 409，跳过当前议题，不得用新 version 覆盖。若没有 threadId，则按未绑定议题处理。`,
        "若议题已绑定 branch 或 worktree，必须在该议题绑定的开发上下文执行，避免并行 Agent 修改同一工作目录。",
        "执行完成并验证后，先用 comment add 记录关键改动、验证结果、执行结果和剩余风险，再使用 ownedVersion、显式 --if-version 和认领时保存的完整 binding 将议题移动到 in_review；成功后更新 ownedVersion，再继续下一个候选。不要省略 binding，避免把完整绑定降级为 legacy local；不要直接标记为 done。",
      ];
  const openingInstructions = routedInbox
    ? [
        `开始时分别运行 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status todo --archived false --json 和 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status in_progress --archived false --json。把全部 todo 作为 todoCandidates；把 in_progress 中 threadBinding 五字段完整的任务作为 resumableInProgress，不完整绑定的 in_progress 不得自动接管。只有两组都为空时才直接结束；Taskboard 主机侧只暂停没有 todoCandidates 且没有 resumableInProgress 的调度实例，保留用户已开启的自动认领策略并继续监测后续工作。`,
        "为本轮维护 attemptedIssueIds 和 resumedThreadIds。每个议题使用各自独立的 ownedVersion 和 binding，严禁跨议题复用。先恢复 resumableInProgress，同时继续处理独立 todoCandidates；单个议题被跳过、blocked、发生认领冲突、交给原绑定会话或继续等待，不应阻断后续候选和独立执行组。",
      ]
    : [
        `开始时先运行 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status todo --json。若没有 todo，直接结束；Taskboard 主机侧只暂停空队列的调度实例，保留用户已开启的自动认领策略并继续监测后续 todo，不要创建或打开新的任务会话。`,
        "为本轮维护 attemptedIssueIds。每个议题使用各自独立的 ownedVersion 和 binding，严禁跨议题复用。处理完当前候选队列后重新 issue list；继续处理新出现且本轮尚未尝试的可执行 todo，直到没有尚未尝试的可执行候选。单个议题被跳过、blocked、发生认领冲突或交给原绑定会话，都不应阻断后续候选。",
      ];
  const closingInstruction = routedInbox
    ? `本轮所有候选处理或交接后，再次分别运行 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status todo --archived false --json 和 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status in_progress --archived false --json。若没有尚未尝试的可执行 todo 且没有完整 threadBinding 的 in_progress，直接结束；Taskboard 主机侧只在这两类工作都为空时暂停调度实例。若仍有 resumableInProgress，下一次定时运行必须继续等待并完成其 in_review 写回；若仍有 todo 但都已在 attemptedIssueIds 中或当前不可执行，结束本轮，留待下一次自动检查。`
    : `本轮所有候选处理或交接后，再次运行 ${taskctlCommand} issue list --project ${request.taskboardProjectId} --status todo --json。若没有 todo，直接结束；Taskboard 主机侧只暂停空队列的调度实例并继续监测后续 todo，避免创建空会话。若仍有 todo 但都已在 attemptedIssueIds 中或当前不可执行，结束本轮，留待下一次自动检查。`;
  return [
    `[$manage-taskboard](${request.skillPath}) e-taskboard 每 ${request.intervalMinutes} 分钟检查任务面板中的「${request.projectName}」项目（项目 ID：${request.taskboardProjectId}，项目目录：${request.workspacePath}）。`,
    `本轮所有 taskctl 操作都使用完整命令前缀 ${taskctlCommand}，不要使用 PATH 中的 taskctl。`,
    ...openingInstructions,
    ...executionInstructions,
    closingInstruction,
  ].join("\n");
}

export function taskboardAutomationHasPendingWork(todoTasks, inProgressTasks) {
  return todoTasks.length > 0 || inProgressTasks.some((task) => {
    const binding = task?.threadBinding;
    return binding
      && validText(binding.threadId, 256)
      && validText(binding.codexProjectId, 256)
      && (binding.codexProjectKind === "local" || binding.codexProjectKind === "remote")
      && validText(binding.codexHostId, 256)
      && validAbsolutePath(binding.workspacePath);
  });
}

function buildTaskctlCommand(request) {
  const command = `${shellQuote(process.execPath)} ${shellQuote(taskctlCliPath)}`;
  const runtimeFilePath = process.env.CODEX_TASKBOARD_RUNTIME_FILE;
  return runtimeFilePath
    ? `${command} --runtime-file ${shellQuote(runtimeFilePath)}`
    : command;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildTaskboardAutomationSpec(request) {
  return {
    kind: "cron",
    name: buildTaskboardAutomationName(request),
    prompt: buildTaskboardAutomationPrompt(request),
    projectId: request.codexProjectKind === "remote" ? null : request.codexProjectId,
    executionEnvironment: "local",
    localEnvironmentConfigPath: null,
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    rrule: `RRULE:FREQ=MINUTELY;INTERVAL=${request.intervalMinutes}`,
  };
}

export function taskboardAutomationPolicyOperation(request, {
  hasPendingWork,
  quotaState,
}) {
  if (!request.enabledByUser) return "pause";
  if (hasPendingWork === false) return "pause";
  if (request.quotaAware && quotaState !== "available") return "pause";
  return "ensure-active";
}

export async function reconcileTaskboardAutomation(request, rpc) {
  const listed = await rpc("list-automations", {});
  const items = Array.isArray(listed?.items) ? listed.items : [];
  const name = buildTaskboardAutomationName(request);
  const matchingItems = items.filter((item) => item?.name === name);

  if (request.operation === "list") {
    return { items: matchingItems.map(sanitizeAutomation).filter(Boolean) };
  }

  const existing = (
    request.automationId
      ? matchingItems.find((item) => item?.id === request.automationId)
      : null
  ) ?? matchingItems[0];
  const spec = buildTaskboardAutomationSpec(request);

  if (request.operation === "pause") {
    if (!existing) return { error: "not-found" };
    if (automationMatchesSpec(existing, spec, "PAUSED")) return { item: existing };
    return rpc("automation-update", { ...spec, id: existing.id, status: "PAUSED" });
  }

  if (request.operation !== "ensure-active") {
    throw new Error(`Unsupported automation operation: ${request.operation}`);
  }
  if (existing) {
    if (automationMatchesSpec(existing, spec, "ACTIVE")) return { item: existing };
    return rpc("automation-update", {
      ...spec,
      id: existing.id,
      status: "ACTIVE",
    });
  }
  return rpc("automation-create", spec);
}

function sanitizeAutomation(item) {
  if (
    !validText(item?.id, 256)
    || (item.status !== "ACTIVE" && item.status !== "PAUSED")
    || !validText(item.model, 256)
    || !validText(item.reasoningEffort, 100)
    || !validRrule(item.rrule)
  ) return null;
  return {
    id: item.id,
    status: item.status,
    model: item.model,
    reasoningEffort: item.reasoningEffort,
    rrule: item.rrule,
    ...(
      item.nextRunAt === null || Number.isFinite(item.nextRunAt)
        ? { nextRunAt: item.nextRunAt }
        : {}
    ),
  };
}

function validRrule(value) {
  return typeof value === "string"
    && /^RRULE:FREQ=MINUTELY;INTERVAL=(5|10|15|30|60)$/.test(value);
}

function automationMatchesSpec(item, spec, status) {
  return item?.status === status
    && Object.entries(spec).every(([field, value]) => (
      field === "projectId"
        ? (item.projectId ?? item.target?.projectId ?? null) === value
        : item[field] === value
    ));
}

function validIdentifier(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[a-z0-9-]+$/i.test(value);
}

function validProjectId(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[a-z0-9._-]+$/i.test(value);
}

function validText(value, maxLength) {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validAbsolutePath(value) {
  return validText(value, 2_048)
    && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}
