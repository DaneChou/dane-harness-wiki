import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildTaskboardAutomationName,
  buildTaskboardAutomationPrompt,
  buildTaskboardAutomationSpec,
  parseTaskboardAutomationHostRequest,
  reconcileTaskboardAutomation,
  taskboardAutomationHasPendingWork,
  taskboardAutomationPolicyOperation,
} from "../shared/taskboard-automation.mjs";

const baseRequest = {
  id: "host-request-1",
  action: "automation",
  requestId: "iframe-request-1",
  operation: "ensure-active",
  taskboardProjectId: "ppt-skill",
  codexProjectId: "codex-project-123",
  codexProjectKind: "local",
  codexHostId: "local",
  projectName: "PPT Skill",
  workspacePath: "/Users/example/Documents/ppt-skill",
  skillPath: "/Users/example/taskboard/skills/manage-taskboard/SKILL.md",
  enabledByUser: true,
  quotaAware: false,
  intervalMinutes: 5,
  model: "gpt-5.5",
  reasoningEffort: "high",
};

const remoteRequest = {
  ...baseRequest,
  codexProjectId: "remote-project-123",
  codexProjectKind: "remote",
  codexHostId: "remote-ssh-discovered:merlin-agent",
  projectName: "Playground",
  workspacePath: "/mlx_devbox/users/example/playground",
  remoteProjects: [
    {
      codexProjectId: "remote-project-123",
      codexProjectKind: "remote",
      codexHostId: "remote-ssh-discovered:merlin-agent",
      workspacePath: "/mlx_devbox/users/example/playground",
    },
    {
      codexProjectId: "remote-worktree-456",
      codexProjectKind: "remote",
      codexHostId: "remote-ssh-discovered:merlin-agent",
      workspacePath: "/mlx_devbox/users/example/playground-worktree",
    },
  ],
};

const globalInboxRequest = {
  ...baseRequest,
  projectName: "Global Inbox",
  codexProjects: [
    {
      codexProjectId: "codex-project-123",
      codexProjectKind: "local",
      codexHostId: "local",
      workspacePath: "/Users/example/Documents/ppt-skill",
    },
    {
      codexProjectId: "remote-project-123",
      codexProjectKind: "remote",
      codexHostId: "remote-ssh-discovered:merlin-agent",
      workspacePath: "/mlx_devbox/users/example/playground",
    },
  ],
};

test("the automation host request accepts catalog-provided project automation options", () => {
  assert.deepEqual(parseTaskboardAutomationHostRequest(baseRequest), baseRequest);
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, operation: "delete" }),
    null,
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, method: "automation-delete" }),
    null,
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, prompt: "arbitrary" }),
    null,
  );
  assert.deepEqual(
    parseTaskboardAutomationHostRequest({ ...baseRequest, intervalMinutes: 10 }),
    { ...baseRequest, intervalMinutes: 10 },
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, intervalMinutes: 7 }),
    null,
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({
      ...baseRequest,
      model: "gpt-5.6-sol",
      reasoningEffort: "ultra",
    })?.reasoningEffort,
    "ultra",
  );
  assert.deepEqual(
    parseTaskboardAutomationHostRequest({
      ...baseRequest,
      model: "gemini-3.1-pro-preview",
      reasoningEffort: "xhigh",
    }),
    {
      ...baseRequest,
      model: "gemini-3.1-pro-preview",
      reasoningEffort: "xhigh",
    },
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, reasoningEffort: "xhigh" })?.reasoningEffort,
    "xhigh",
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, workspacePath: "relative/path" }),
    null,
  );
  assert.deepEqual(parseTaskboardAutomationHostRequest(remoteRequest), remoteRequest);
  assert.deepEqual(parseTaskboardAutomationHostRequest(globalInboxRequest), globalInboxRequest);
  assert.equal(parseTaskboardAutomationHostRequest({
    ...globalInboxRequest,
    codexProjects: [{
      ...globalInboxRequest.codexProjects[0],
      codexHostId: "remote-host",
    }],
  }), null);
  const windowsRemoteRequest = {
    ...remoteRequest,
    workspacePath: String.raw`C:\Users\admin\Documents\dashi-taskboard`,
    remoteProjects: [{
      codexProjectId: "remote-project-123",
      codexProjectKind: "remote",
      codexHostId: "remote-ssh-discovered:merlin-agent",
      workspacePath: String.raw`C:\Users\admin\Documents\dashi-taskboard`,
    }],
  };
  assert.deepEqual(
    parseTaskboardAutomationHostRequest(windowsRemoteRequest),
    windowsRemoteRequest,
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...remoteRequest, codexHostId: "local" }),
    null,
  );
  assert.equal(
    parseTaskboardAutomationHostRequest({ ...baseRequest, codexHostId: "remote-host" }),
    null,
  );
});

test("the global inbox prompt routes every todo by its persisted execution target", () => {
  const prompt = buildTaskboardAutomationPrompt(globalInboxRequest);
  assert.match(prompt, /全局收件箱控制器/);
  assert.match(prompt, /issue\.executionTarget/);
  assert.match(prompt, /四字段完全相同/);
  assert.match(prompt, /不得按标题、描述、项目名或路径相似度猜测/);
  assert.match(prompt, /先完成整批读取再派发/);
  assert.match(prompt, /attachment list --task/);
  assert.match(prompt, /每条评论运行不带 --after 的 attachment list --comment COMMENT_ID[^]*每条评论附件的完整快照与独立 nextCursor/);
  assert.match(prompt, /权威全量需求快照固定包含[^]*完整 issue get 返回的当前任务快照[^]*developmentContext[^]*executionTarget[^]*全部用户评论[^]*全部 task attachments[^]*全部逐评论 attachments[^]*currentSnapshotToken/);
  assert.match(prompt, /currentSnapshotToken[^]*键及顺序严格为[^]*issueVersion[^]*userComments[^]*taskAttachments[^]*commentAttachments[^]*token 只能包含这四项，不得加入任何其他任务字段、nextCursor 或控制器状态[^]*nextCursor 只用于增量读取，不进入 token/);
  assert.match(prompt, /批量快照完成前不得创建会话/);
  assert.match(prompt, /共享功能链、可能修改的文件/);
  assert.match(prompt, /不得固定一题一会话/);
  assert.match(prompt, /issue move --status in_progress --if-version/);
  assert.match(prompt, /Codex create_thread/);
  assert.match(prompt, /每个仍有已认领任务的执行组只调用一次 Codex create_thread/);
  assert.match(prompt, /actualTarget\.codexProjectId/);
  assert.match(prompt, /environment:\{type:"worktree"\}/);
  assert.match(prompt, /model="gpt-5\.5"/);
  assert.match(prompt, /thinking="high"/);
  assert.match(prompt, /精确 head SHA/);
  assert.match(prompt, /PR、CI、审查决定\/结果/);
  assert.match(prompt, /wait_threads/);
  assert.match(prompt, /--status in_progress --archived false --json/);
  assert.match(prompt, /resumableInProgress/);
  assert.match(prompt, /下一次定时运行必须再次进入同一恢复路径/);
  assert.match(prompt, /resumableInProgress[^]*本次定时运行第一次 wait_threads 前[^]*权威全量需求快照[^]*完整 issue get 当前任务快照[^]*developmentContext[^]*executionTarget[^]*currentSnapshotToken[^]*最新 developmentContext[^]*无法采用最新 developmentContext 时不得回传该 token[^]*send 成功后才使用 wait_threads/);
  assert.match(prompt, /version 仍等于 ownedVersion/);
  assert.match(prompt, /status 仍严格等于 in_progress/);
  assert.match(prompt, /archivedAt 仍为 null/);
  assert.match(prompt, /完整 binding 与保存值完全相同/);
  assert.match(prompt, /executionTarget 与保存 binding 的四字段 identity 完全相同/);
  assert.match(prompt, /不采用更新后的 version 重试/);
  assert.match(prompt, /每次 wait_threads 返回后[^]*任何新的 send_message_to_thread 或 follow-up 前[^]*若该会话已没有仍由本控制器拥有的任务，不发送 follow-up/);
  assert.match(prompt, /post-wait 复核[^]*comment list ISSUE_ID --after COMMENT_CURSOR[^]*attachment list --task ISSUE_ID --after TASK_ATTACHMENT_CURSOR[^]*attachment list --comment COMMENT_ID --after COMMENT_ATTACHMENT_CURSOR[^]*不得接受基于旧快照[^]*handoff[^]*移到 in_review/);
  assert.match(prompt, /增量读取后[^]*不带 --after 的 comment list ISSUE_ID[^]*不带 --after 的 attachment list --task ISSUE_ID[^]*当前完整评论集[^]*评论 ID、任务附件 ID、每条评论附件 ID 的完整集合[^]*任何已保存 ID 消失都视为删除或撤回[^]*删除清单和新 token 发送给原 thread/);
  assert.match(prompt, /重新生成 currentSnapshotToken[^]*权威全量需求快照[^]*下一次 handoff 原样回传新 token[^]*不得接受基于旧快照或旧 token 的 handoff/);
  assert.match(prompt, /threadId 和 threadBinding 仍为空/);
  assert.match(prompt, /任一条件变化时，只通知新会话排除该任务，禁止写看板/);
  assert.match(prompt, /完整、直接验证通过且所需审查完成后[\s\S]*移到 in_review/);
  assert.match(prompt, /handoff 原样回传本轮最新 currentSnapshotToken[^]*token 缺失或不一致[^]*重发权威全量需求快照[^]*继续 wait_threads/);
  assert.match(prompt, /catalog 暂时找不到该项目不代表绑定失效/);
  assert.match(prompt, /必须保留原 binding，绝不能使用 --clear-binding-thread/);
  assert.match(prompt, /NOT_FOUND 或 CLOSED[^]*comment add --thread-id[^]*正文逐项记录终态以及旧 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath[^]*comment add 不传任何 --binding-\* 参数[^]*issue move --status todo[^]*--clear-binding-thread[^]*只重新 issue get 一次[^]*正常未绑定新执行组和 create_thread 路径/);
  assert.match(prompt, /timeout、网络失败、catalog 缺项或主机暂时不可达时保留 binding/);
  assert.match(prompt, /未绑定任务[\s\S]*--clear-binding-thread/);
  assert.match(prompt, /移到 in_review/);
  assert.match(prompt, /不得合并、发布或标记 done/);
});

test("pending work includes todo and only fully bound in-progress tasks", () => {
  const completeBinding = {
    threadId: "thread-1",
    codexProjectId: "project-1",
    codexProjectKind: "local",
    codexHostId: "local",
    workspacePath: "/work/project-1",
  };
  assert.equal(taskboardAutomationHasPendingWork([{}], []), true);
  assert.equal(taskboardAutomationHasPendingWork([], [{ threadBinding: completeBinding }]), true);
  assert.equal(taskboardAutomationHasPendingWork([], [{
    threadBinding: { ...completeBinding, workspacePath: "relative/path" },
  }]), false);
  assert.equal(taskboardAutomationHasPendingWork([], [{ threadBinding: null }]), false);
  assert.equal(taskboardAutomationHasPendingWork([], []), false);
});

test("the stable name and generated prompt are project-scoped and encode the claim protocol", () => {
  assert.equal(
    buildTaskboardAutomationName(baseRequest),
    "Taskboard 自动认领 · ppt-skill",
  );

  const prompt = buildTaskboardAutomationPrompt(baseRequest);
  assert.match(
    prompt,
    /\[\$manage-taskboard\]\(\/Users\/example\/taskboard\/skills\/manage-taskboard\/SKILL\.md\)/,
  );
  assert.match(prompt, /\[\$manage-taskboard\]\([^)]*\) e-taskboard /);
  assert.match(prompt, /PPT Skill/);
  assert.match(prompt, /每 5 分钟检查/);
  assert.match(prompt, /ppt-skill/);
  assert.match(prompt, /\/Users\/example\/Documents\/ppt-skill/);
  assert.match(prompt, /处理其中每一个依赖已完成的议题/);
  assert.match(prompt, /逐个处理本轮尚未尝试且符合依赖条件的 todo/);
  assert.match(prompt, /attemptedIssueIds/);
  assert.match(prompt, /单个议题被跳过、blocked、发生认领冲突或交给原绑定会话，都不应阻断后续候选/);
  assert.doesNotMatch(prompt, /每次仅处理一个符合依赖条件的 todo/);
  assert.match(prompt, /issue get/);
  assert.match(prompt, /comment list/);
  assert.match(prompt, /最新 version/);
  assert.match(prompt, /in_progress/);
  assert.match(prompt, /版本冲突.*跳过/);
  assert.match(prompt, /关键改动、验证结果、执行结果和剩余风险/);
  assert.match(prompt, /in_review/);
  assert.match(prompt, /已绑定.*branch.*worktree/);
  assert.match(prompt, /Codex list_threads/);
  assert.match(prompt, /list_threads（limit=50）/);
  assert.match(prompt, /pinnedThreads 与 threads/);
  assert.match(prompt, /projectId="codex-project-123"/);
  assert.match(prompt, /hostId="local"/);
  assert.match(prompt, /cwd="\/Users\/example\/Documents\/ppt-skill"/);
  assert.match(prompt, /legacy local 原位升级为完整 binding/);
  assert.match(prompt, /确认 stale 后[^]*重新 issue get[^]*comment add --thread-id[^]*comment add 不传任何 --binding-\* 参数[^]*issue move --status todo --clear-binding-thread --if-version/);
  assert.match(prompt, /--binding-thread-id "\$CODEX_THREAD_ID"/);
  assert.match(prompt, /认领后的每一次 issue move.*五个完整 binding 字段/);
  assert.match(prompt, /不要省略 binding，避免把完整绑定降级为 legacy local/);
  assert.doesNotMatch(prompt, /automation_update/);
  assert.match(prompt, /只暂停空队列的调度实例，保留用户已开启的自动认领策略并继续监测后续 todo/);
});

test("the remote automation prompt keeps taskctl local and delegates work to the SSH project", () => {
  const prompt = buildTaskboardAutomationPrompt(remoteRequest);
  assert.match(prompt, /仅在本机作为任务面板控制器运行/);
  assert.match(prompt, /remote-ssh-discovered:merlin-agent/);
  assert.match(prompt, /\/mlx_devbox\/users\/example\/playground/);
  assert.match(prompt, /remote-worktree-456/);
  assert.match(prompt, /\/mlx_devbox\/users\/example\/playground-worktree/);
  assert.match(prompt, /Codex create_thread/);
  assert.match(prompt, /projectId:actualTarget\.codexProjectId/);
  assert.match(prompt, /同一保存主机当前可用的精确远程项目映射/);
  assert.match(prompt, /developmentContext\.type 是 worktree[\s\S]*workspacePath 与 developmentContext\.path 完全相同/);
  assert.match(prompt, /零项或多项[\s\S]*目标 SSH worktree 未映射[\s\S]*不认领、不 create、不写基础项目 binding/);
  assert.match(prompt, /不得回退到基础 root、local、项目名、其他主机/);
  assert.match(prompt, /Codex wait_threads/);
  assert.match(prompt, /远程会话不运行 taskctl/);
  assert.match(prompt, /完整 threadBinding 包含 threadId、codexProjectId、codexProjectKind、codexHostId、workspacePath/);
  assert.match(prompt, /当前自动化的项目和主机只能作为未绑定议题的首次目标/);
  assert.match(prompt, /存在 threadId 但没有完整 threadBinding[\s\S]*legacy local[\s\S]*--if-version[\s\S]*不得 send、create 或覆盖该绑定/);
  assert.match(prompt, /所有认领、评论和状态写入只由当前本地控制器完成/);
  assert.match(prompt, /已有完整 threadBinding 时，只能使用其保存的 threadId 和 codexHostId 调用 Codex send_message_to_thread/);
  assert.match(prompt, /send 成功后必须重新 issue get 一次[\s\S]*status 仍为 todo[\s\S]*threadBinding 与保存值完全相同[\s\S]*issue move --status in_progress[\s\S]*记录响应 task\.version 为 ownedVersion/);
  assert.match(prompt, /认领成功后继续执行后文现有 Codex wait_threads、结果评论和 in_review 写回路径/);
  assert.match(prompt, /确认旧会话 stale 后[^]*重新 issue get[^]*comment add --thread-id[^]*comment add 不传任何 --binding-\* 参数[^]*issue move --status todo --clear-binding-thread --if-version/);
  assert.doesNotMatch(prompt, /要求原远程会话按本协议判断和认领/);
  assert.match(prompt, /未绑定时必须传 --clear-binding-thread/);
  assert.match(prompt, /记录响应 task 的 version 为 ownedVersion[\s\S]*每次 issue move 都必须显式传 --if-version ownedVersion/);
  assert.match(prompt, /create_thread 失败[\s\S]*ownedVersion[\s\S]*--if-version[\s\S]*--clear-binding-thread[\s\S]*移回 todo/);
  assert.match(prompt, /发生 409[\s\S]*跳过当前议题且不得重读最新 version 后覆盖/);
  assert.match(prompt, /响应丢失或结果不确定[\s\S]*projectId 等于 ownedProjectId[\s\S]*状态仍为本轮 in_progress[\s\S]*threadBinding 为空或与本轮五字段 binding 完全相同/);
  assert.match(prompt, /读到相同 binding 视为前次保存成功[\s\S]*读到不同 binding[\s\S]*跳过当前议题/);
  assert.match(prompt, /确定绑定写入失败[\s\S]*远程 threadId[\s\S]*移动到 blocked/);
  assert.match(prompt, /wait_threads 失败[\s\S]*完整保存 binding[\s\S]*移动到 blocked/);
  assert.match(prompt, /worker 确认后的每一次 issue move 都必须显式传完整远程 binding/);
  assert.match(prompt, /不得扫描或接管其他 in_progress/);
  assert.match(prompt, /移动到 in_review/);
});

test("the generated automation command uses the packaged CLI and an argv runtime file", () => {
  const previous = process.env.CODEX_TASKBOARD_RUNTIME_FILE;
  process.env.CODEX_TASKBOARD_RUNTIME_FILE = "/Users/example/Library/Application Support/Codex Taskboard/launcher-runtime.json";
  try {
    const prompt = buildTaskboardAutomationPrompt(baseRequest);
    const cliPath = fileURLToPath(new URL("../cli/taskctl.mjs", import.meta.url));
    assert.ok(prompt.includes(
      `'${process.execPath}' '${cliPath}' --runtime-file '${process.env.CODEX_TASKBOARD_RUNTIME_FILE}'`,
    ));
    assert.ok(!prompt.includes(path.resolve(path.dirname(baseRequest.skillPath), "../..", "cli/taskctl.mjs")));
    assert.doesNotMatch(prompt, /CODEX_TASKBOARD_RUNTIME_FILE=/);
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_TASKBOARD_RUNTIME_FILE;
    } else {
      process.env.CODEX_TASKBOARD_RUNTIME_FILE = previous;
    }
  }
});

test("the generated cron spec uses the selected whitelisted local Codex options", () => {
  assert.deepEqual(buildTaskboardAutomationSpec(baseRequest), {
    kind: "cron",
    name: "Taskboard 自动认领 · ppt-skill",
    prompt: buildTaskboardAutomationPrompt(baseRequest),
    projectId: "codex-project-123",
    executionEnvironment: "local",
    localEnvironmentConfigPath: null,
    model: "gpt-5.5",
    reasoningEffort: "high",
    rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5",
  });
  assert.deepEqual(buildTaskboardAutomationSpec({
    ...baseRequest,
    intervalMinutes: 30,
    model: "gpt-5.4",
    reasoningEffort: "medium",
  }), {
    ...buildTaskboardAutomationSpec(baseRequest),
    prompt: buildTaskboardAutomationPrompt({ ...baseRequest, intervalMinutes: 30 }),
    model: "gpt-5.4",
    reasoningEffort: "medium",
    rrule: "RRULE:FREQ=MINUTELY;INTERVAL=30",
  });
  assert.deepEqual(buildTaskboardAutomationSpec(remoteRequest), {
    kind: "cron",
    name: "Taskboard 自动认领 · ppt-skill",
    prompt: buildTaskboardAutomationPrompt(remoteRequest),
    projectId: null,
    executionEnvironment: "local",
    localEnvironmentConfigPath: null,
    model: "gpt-5.5",
    reasoningEffort: "high",
    rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5",
  });
});

test("enabled automation pauses only when todo and resumable work are both absent", () => {
  const passiveAvailable = {
    explicit: false,
    previousQuotaState: "available",
    quotaState: "available",
    currentStatus: "PAUSED",
  };
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: true },
      passiveAvailable,
    ),
    "ensure-active",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: true },
      { ...passiveAvailable, quotaState: "unknown" },
    ),
    "pause",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: true },
      { ...passiveAvailable, previousQuotaState: "blocked" },
    ),
    "ensure-active",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: true },
      { ...passiveAvailable, explicit: true },
    ),
    "ensure-active",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: false },
      { ...passiveAvailable, currentStatus: "ACTIVE" },
    ),
    "ensure-active",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: false },
      { ...passiveAvailable, currentStatus: "ACTIVE", hasPendingWork: false },
    ),
    "pause",
  );
  assert.equal(
    taskboardAutomationPolicyOperation(
      { ...baseRequest, quotaAware: false },
      { ...passiveAvailable, currentStatus: "PAUSED", hasPendingWork: true },
    ),
    "ensure-active",
  );
});

test("ensure-active updates a matching automation by id with a complete active spec", async () => {
  const existing = {
    id: "automation-1",
    status: "ACTIVE",
    kind: "cron",
    name: "Taskboard 自动认领 · ppt-skill",
    prompt: "old prompt",
    projectId: "old-project",
    executionEnvironment: "local",
    localEnvironmentConfigPath: null,
    model: "gpt-5.5",
    reasoningEffort: "medium",
    rrule: "FREQ=HOURLY",
    createdAt: "2026-07-25T00:00:00.000Z",
    internalRevision: 4,
  };
  const calls = [];
  const response = await reconcileTaskboardAutomation(
    { ...baseRequest, automationId: "automation-1" },
    async (method, params) => {
      calls.push({ method, params });
      if (method === "list-automations") return { items: [existing] };
      return { item: params };
    },
  );

  const spec = buildTaskboardAutomationSpec(baseRequest);
  assert.deepEqual(calls, [
    { method: "list-automations", params: {} },
    {
      method: "automation-update",
      params: {
        ...spec,
        id: "automation-1",
        status: "ACTIVE",
      },
    },
  ]);
  assert.deepEqual(response, {
    item: { ...spec, id: "automation-1", status: "ACTIVE" },
  });
});

test("ensure-active is idempotent when the listed automation already matches", async () => {
  const existing = {
    id: "automation-1",
    status: "ACTIVE",
    ...buildTaskboardAutomationSpec(baseRequest),
    createdAt: "2026-07-25T00:00:00.000Z",
  };
  const calls = [];
  const response = await reconcileTaskboardAutomation(
    { ...baseRequest, automationId: "automation-1" },
    async (method, params) => {
      calls.push({ method, params });
      return { items: [existing] };
    },
  );

  assert.deepEqual(calls, [{ method: "list-automations", params: {} }]);
  assert.deepEqual(response, { item: existing });
});

test("a foreign automation id never grants control outside the project", async () => {
  const foreign = {
    id: "foreign-automation",
    status: "ACTIVE",
    ...buildTaskboardAutomationSpec({
      ...baseRequest,
      taskboardProjectId: "another-project",
    }),
  };
  const ensureCalls = [];
  await reconcileTaskboardAutomation(
    { ...baseRequest, automationId: foreign.id },
    async (method, params) => {
      ensureCalls.push({ method, params });
      if (method === "list-automations") return { items: [foreign] };
      return { item: params };
    },
  );
  assert.deepEqual(ensureCalls, [
    { method: "list-automations", params: {} },
    { method: "automation-create", params: buildTaskboardAutomationSpec(baseRequest) },
  ]);

  const pauseCalls = [];
  const paused = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "pause", automationId: foreign.id },
    async (method, params) => {
      pauseCalls.push({ method, params });
      return { items: [foreign] };
    },
  );
  assert.deepEqual(pauseCalls, [{ method: "list-automations", params: {} }]);
  assert.deepEqual(paused, { error: "not-found" });
});

test("ensure-active falls back to the stable name and otherwise creates", async () => {
  const matching = {
    id: "automation-by-name",
    status: "PAUSED",
    ...buildTaskboardAutomationSpec(baseRequest),
  };
  const updateCalls = [];
  await reconcileTaskboardAutomation(baseRequest, async (method, params) => {
    updateCalls.push({ method, params });
    if (method === "list-automations") return { items: [matching] };
    return { item: params };
  });
  assert.equal(updateCalls[1].method, "automation-update");
  assert.equal(updateCalls[1].params.id, "automation-by-name");

  const createCalls = [];
  const created = await reconcileTaskboardAutomation(baseRequest, async (method, params) => {
    createCalls.push({ method, params });
    if (method === "list-automations") return { items: [] };
    return { item: { id: "created-1", status: "ACTIVE", ...params } };
  });
  assert.deepEqual(createCalls, [
    { method: "list-automations", params: {} },
    { method: "automation-create", params: buildTaskboardAutomationSpec(baseRequest) },
  ]);
  assert.equal(created.item.id, "created-1");
});

test("pause never creates and list returns only sanitized matching project automations", async () => {
  const matching = {
    id: "matching",
    status: "ACTIVE",
    ...buildTaskboardAutomationSpec(baseRequest),
    untrustedListField: "must not be echoed into an update",
  };
  const unrelated = {
    id: "unrelated",
    status: "ACTIVE",
    ...buildTaskboardAutomationSpec({
      ...baseRequest,
      taskboardProjectId: "another-project",
    }),
  };

  const pauseCalls = [];
  const paused = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "pause" },
    async (method, params) => {
      pauseCalls.push({ method, params });
      if (method === "list-automations") return { items: [unrelated, matching] };
      return { item: params };
    },
  );
  assert.deepEqual(pauseCalls, [
    { method: "list-automations", params: {} },
    {
      method: "automation-update",
      params: {
        ...buildTaskboardAutomationSpec(baseRequest),
        id: "matching",
        status: "PAUSED",
      },
    },
  ]);
  assert.deepEqual(paused, {
    item: {
      ...buildTaskboardAutomationSpec(baseRequest),
      id: "matching",
      status: "PAUSED",
    },
  });

  const notFoundCalls = [];
  const notFound = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "pause", taskboardProjectId: "missing" },
    async (method, params) => {
      notFoundCalls.push({ method, params });
      return { items: [matching, unrelated] };
    },
  );
  assert.deepEqual(notFoundCalls, [{ method: "list-automations", params: {} }]);
  assert.deepEqual(notFound, { error: "not-found" });

  const listed = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "list" },
    async () => ({ items: [unrelated, matching] }),
  );
  assert.deepEqual(listed, {
    items: [{
      id: "matching",
      status: "ACTIVE",
      model: "gpt-5.5",
      reasoningEffort: "high",
      rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5",
    }],
  });

  const catalogPair = {
    ...matching,
    id: "catalog-pair",
    model: "gemini-3.1-pro-preview",
    reasoningEffort: "xhigh",
  };
  const catalogListed = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "list" },
    async () => ({ items: [catalogPair] }),
  );
  assert.deepEqual(catalogListed, {
    items: [{
      id: "catalog-pair",
      status: "ACTIVE",
      model: "gemini-3.1-pro-preview",
      reasoningEffort: "xhigh",
      rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5",
    }],
  });
});

test("pause is idempotent for an already paused matching automation", async () => {
  const matching = {
    id: "matching",
    status: "PAUSED",
    ...buildTaskboardAutomationSpec(baseRequest),
  };
  const calls = [];
  const response = await reconcileTaskboardAutomation(
    { ...baseRequest, operation: "pause" },
    async (method, params) => {
      calls.push({ method, params });
      return { items: [matching] };
    },
  );
  assert.deepEqual(calls, [{ method: "list-automations", params: {} }]);
  assert.deepEqual(response, { item: matching });
});
