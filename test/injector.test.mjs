import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../scripts/codex-injector.mjs", import.meta.url), "utf8");
const injectedSource = await readFile(
  new URL("../inject/codex-taskboard.user.js", import.meta.url),
  "utf8",
);
const runtimeSource = await readFile(
  new URL("../scripts/codex-injector-runtime.mjs", import.meta.url),
  "utf8",
);
const supervisorSource = await readFile(
  new URL("../scripts/taskboard-supervisor.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("the resident injector authenticates its launcher-managed Taskboard service", () => {
  assert.match(supervisorSource, /function createTaskboardSupervisor/);
  assert.match(source, /CODEX_TASKBOARD_INSTANCE_TOKEN/);
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /x-codex-taskboard-challenge/);
  assert.match(source, /proof/);
  assert.match(source, /taskboardInstanceSecret/);
  assert.match(source, /Page\.setDocumentContent/);
  assert.match(runtimeSource, /request\.action === "load-frame"/);
  assert.match(supervisorSource, /ensureInFlight/);
  assert.match(supervisorSource, /await terminateManagedChild\(managedChild\)/);
  assert.match(source, /await supervisor\.ensure\(\)/);
  assert.match(source, /it will be restarted automatically/);
  assert.match(source, /AbortSignal\.timeout\(1_500\)/);
  assert.match(source, /__CODEX_TASKBOARD_FRAME_CAPABILITY__/);
  assert.match(runtimeSource, /request\.frameCapability/);
});

test("the CDP bridge accepts service ensure and native task conversation start actions", () => {
  assert.match(source, /const hostBindingName = "__codexTaskboardHostV1"/);
  assert.match(runtimeSource, /request\.action === "ensure"/);
  assert.match(runtimeSource, /request\.action === "start-task-conversation"/);
  assert.match(runtimeSource, /request\.action === "open-external"/);
  assert.match(runtimeSource, /request\.taskId/);
  assert.match(runtimeSource, /request\.previousThreadId\.length <= 240/);
  assert.match(runtimeSource, /request\.codexHostId\.length <= 240/);
  assert.match(runtimeSource, /request\.targetRoot\.length <= 4_096/);
  assert.match(runtimeSource, /payload\.length > 4_194_304/);
  assert.match(runtimeSource, /request\.instruction\.length <= 4_000_000/);
  assert.match(runtimeSource, /request\.title\.length <= 240/);
  assert.match(source, /async function startTaskConversationViaCdp/);
  assert.match(source, /data-composer-placement="home"/);
  assert.match(source, /\(editor\.innerText \|\| ""\) !== \$\{JSON\.stringify\(instruction\)\}/);
  assert.doesNotMatch(source, /cdp\.send\("Input\.insertText", \{ text: instruction \}\)/);
  assert.match(
    source,
    /cdp\.send\("Input\.dispatchKeyEvent", \{\s*type: "keyDown",\s*key: "Enter"/,
  );
  assert.match(
    source,
    /cdp\.send\("Input\.dispatchKeyEvent", \{\s*type: "keyUp",\s*key: "Enter"/,
  );
  assert.match(source, /submitted = true/);
  assert.match(source, /if \(!submitted\) throw new Error/);
  assert.match(source, /const threadId = typeof started\.result\.value === "string"/);
  assert.match(source, /threadId && threadId !== previousThreadId/);
  assert.match(source, /discoveredThreadId = threadId/);
  assert.match(source, /error\.threadId = discoveredThreadId/);
  assert.match(source, /function requestCodexAppServerViaCdp/);
  assert.match(source, /type: "mcp-request"/);
  assert.match(source, /hostId: \$\{JSON\.stringify\(hostId\)\}/);
  assert.match(source, /"thread\/read"/);
  assert.match(source, /normalizeWorkspaceRoot\(result\.thread\.cwd\) === normalizedTargetRoot/);
  assert.match(source, /"thread\/name\/set"/);
  assert.match(source, /result\.thread\.name === title/);
  assert.match(source, /const taskConversationOperations = new Map\(\)/);
  assert.match(source, /taskConversationOperations\.get\(request\.taskId\)/);
  assert.match(source, /const taskConversationAppServerTimeoutMs = 30_000/);
  assert.doesNotMatch(source, /window\.postMessage\(\{ type: "rename-thread" \}/);
  assert.match(source, /return \{ threadId, title \}/);
  assert.match(source, /Runtime\.bindingCalled/);
  assert.match(source, /Page\.createIsolatedWorld/);
  assert.match(source, /Runtime\.addBinding", \{\s*name: hostBindingName,\s*executionContextId:/);
  assert.match(source, /params\.executionContextId !== activeContextId/);
  assert.match(runtimeSource, /params\.executionContextId/);
  assert.match(runtimeSource, /threadId: error\.threadId/);
  assert.match(source, /hostResponseMessage/);
  assert.match(source, /if \(keepAlive\) await hostBridge\.install\(\)/);
  assert.match(source, /hostBridge\.publishHeartbeat/);
  assert.match(source, /withoutTaskboardLauncherEnvironment\(process\.env\)/);
});

test("the CDP bridge exposes only the fixed Taskboard automation operations", () => {
  assert.match(source, /parseTaskboardAutomationHostRequest/);
  assert.match(source, /reconcileTaskboardAutomation/);
  assert.match(runtimeSource, /request\.action === "automation"/);
  assert.match(source, /function requestCodexAutomationViaCdp/);
  assert.match(source, /new Set\(\[\s*"list-automations",\s*"automation-create",\s*"automation-update",\s*\]\)/);
  assert.match(source, /bridge\.sendMessageFromView\(\{\s*type: "fetch",\s*requestId,/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /vscode:\/\/codex\/\$\{method\}/);
  assert.match(source, /body: JSON\.stringify\(params\)/);
  assert.match(source, /message\.type !== "fetch-response"/);
  assert.match(source, /message\.responseType/);
  assert.match(source, /message\.status/);
  assert.match(source, /message\.bodyJsonString/);
  assert.doesNotMatch(source, /automation-delete/);
  assert.doesNotMatch(source, /automations\.toml/);
});

test("passive automation policy keeps the user opt-in while the queue is idle", () => {
  assert.match(source, /taskboardAutomationPolicyOperation/);
  assert.match(source, /status=in_progress&archived=false/);
  assert.match(source, /taskboardAutomationHasPendingWork/);
  assert.match(source, /previousQuotaState: current\.quota\?\.state/);
  assert.match(source, /enqueueQuotaPolicyMutation\(record, rpc, \{ explicit: true \}\)/);
  assert.doesNotMatch(source, /current\.request = \{ \.\.\.current\.request, enabledByUser: false \}/);
  assert.match(source, /scheduleQuotaPolicyCheck\(current, result\)/);
  assert.match(source, /record\.quota \? \{ quota: record\.quota \} : \{\}/);
});

test("catalog-backed remote projects use the shared routed automation", async () => {
  const helperStart = source.indexOf("function usesLegacyRemoteAutomation");
  const helperEnd = source.indexOf("\n}\n\nfunction remoteAutomationItem", helperStart) + 2;
  const usesLegacyRemoteAutomation = vm.runInNewContext(
    `(${source.slice(helperStart, helperEnd)})`,
  );
  assert.equal(usesLegacyRemoteAutomation({ codexProjectKind: "remote" }), true);
  assert.equal(usesLegacyRemoteAutomation({
    codexProjectKind: "remote",
    codexProjects: [],
  }), false);

  const applySource = source.slice(
    source.indexOf("async function applyTaskboardAutomationPolicy"),
    source.indexOf("function storedAutomationPolicy"),
  );
  const reconciled = [];
  const applyTaskboardAutomationPolicy = vm.runInNewContext(`(${applySource})`, {
    fetch: async () => ({
      ok: true,
      json: async () => ({ tasks: [] }),
    }),
    taskboardBaseUrl: "http://127.0.0.1:47823",
    taskboardAutomationHasPendingWork: () => false,
    readCodexQuotaStatus: async () => null,
    usesLegacyRemoteAutomation,
    reconcileTaskboardAutomation: async (request) => {
      reconciled.push(request);
      return { item: { id: "shared-automation", status: "PAUSED" }, items: [] };
    },
    taskboardAutomationPolicyOperation: () => "pause",
    remoteAutomationItem: () => {
      throw new Error("catalog-backed remote projects must not use the legacy dispatcher");
    },
  });
  const request = {
    taskboardProjectId: "taskboard-project",
    codexProjectId: "remote-controller",
    codexProjectKind: "remote",
    codexHostId: "ssh-host",
    codexProjects: [],
    enabledByUser: true,
    quotaAware: false,
  };
  const result = await applyTaskboardAutomationPolicy(request, () => {});
  assert.equal(result.item.id, "shared-automation");
  assert.deepEqual(
    reconciled.map((candidate) => candidate.operation),
    ["list", "pause"],
  );
});

test("catalog-backed remote policy timers do not invoke the legacy dispatcher", async () => {
  const helperStart = source.indexOf("function usesLegacyRemoteAutomation");
  const helperEnd = source.indexOf("\n}\n\nfunction remoteAutomationItem", helperStart) + 2;
  const usesLegacyRemoteAutomation = vm.runInNewContext(
    `(${source.slice(helperStart, helperEnd)})`,
  );
  const scheduleSource = source.slice(
    source.indexOf("function scheduleQuotaPolicyCheck"),
    source.indexOf("function enqueueQuotaPolicyMutation"),
  );
  let scheduled;
  let syntheticRuns = 0;
  let policyChecks = 0;
  const request = {
    taskboardProjectId: "taskboard-project",
    codexProjectKind: "remote",
    codexProjects: [],
    enabledByUser: true,
  };
  const record = { request, version: 1 };
  const scheduleQuotaPolicyCheck = vm.runInNewContext(`(${scheduleSource})`, {
    quotaPolicyTimers: new Map(),
    quotaPolicyRecords: new Map([[request.taskboardProjectId, record]]),
    usesLegacyRemoteAutomation,
    setTimeout: (callback) => {
      scheduled = callback;
      return { unref() {} };
    },
    clearTimeout: () => {},
    runRemoteTaskboardAutomation: async () => { syntheticRuns += 1; },
    enqueueCurrentQuotaPolicy: async () => { policyChecks += 1; },
    console,
    Date,
    Math,
  });
  scheduleQuotaPolicyCheck(record, {
    item: { status: "ACTIVE", nextRunAt: Date.now() + 60_000 },
  });
  await scheduled();
  assert.equal(syntheticRuns, 0);
  assert.equal(policyChecks, 1);

  const listHandler = source.slice(
    source.indexOf("runAutomation: (request) =>"),
    source.indexOf("startConversation: (request) =>"),
  );
  assert.match(listHandler, /usesLegacyRemoteAutomation\(request\)/);
});

test("persisted automation policies retain project identity without inventing a legacy catalog", () => {
  const storedPolicySource = source.slice(
    source.indexOf("function storedAutomationPolicy"),
    source.indexOf("function restoredAutomationPolicy"),
  );
  const storedAutomationPolicy = vm.runInNewContext(`(${storedPolicySource})`);
  const legacyRequest = {
    taskboardProjectId: "taskboard-project",
    codexProjectId: "controller-project",
    codexProjectKind: "local",
    codexHostId: "local",
    projectName: "Controller",
    workspacePath: "/controller",
    skillPath: "/skill/SKILL.md",
    enabledByUser: true,
    quotaAware: true,
    intervalMinutes: 5,
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
  };
  const legacyPolicy = storedAutomationPolicy(legacyRequest);
  const catalogPolicy = storedAutomationPolicy({ ...legacyRequest, codexProjects: [] });

  assert.equal(Object.hasOwn(legacyPolicy, "codexProjects"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(catalogPolicy.codexProjects)), []);
  assert.match(storedPolicySource, /codexProjectKind: request\.codexProjectKind/);
  assert.match(storedPolicySource, /codexHostId: request\.codexHostId/);
  assert.match(storedPolicySource, /remoteProjects: request\.remoteProjects/);
  assert.match(storedPolicySource, /codexProjects: request\.codexProjects/);
});

test("the injected automation bridge forwards the complete Codex project catalog", () => {
  const hostPayloadSource = injectedSource.slice(
    injectedSource.indexOf("function buildAutomationHostPayload"),
    injectedSource.indexOf("async function handleAutomationRequest"),
  );
  assert.notEqual(hostPayloadSource.length, 0);
  assert.match(hostPayloadSource, /codexProjects: payload\.codexProjects/);
});

test("automation list rebuilds a stored policy on the incoming project identity", async () => {
  const reconcileSource = source.slice(
    source.indexOf("async function reconcileStoredAutomationPolicy"),
    source.indexOf("async function enqueueCurrentQuotaPolicy"),
  );
  const storedRequest = {
    taskboardProjectId: "taskboard-project",
    codexProjectId: "old-project",
    codexProjectKind: "local",
    codexHostId: "local",
    projectName: "Old project",
    workspacePath: "/old/project",
    skillPath: "/old/skill/SKILL.md",
    automationId: "automation-1",
    enabledByUser: true,
    quotaAware: true,
    intervalMinutes: 15,
    model: "gpt-5.5",
    reasoningEffort: "high",
  };
  const incomingRequest = {
    ...storedRequest,
    codexProjectId: "remote-project",
    codexProjectKind: "remote",
    codexHostId: "remote-host",
    projectName: "Remote project",
    workspacePath: "/remote/project",
    remoteProjects: [{
      codexProjectId: "remote-worktree",
      codexProjectKind: "remote",
      codexHostId: "remote-host",
      workspacePath: "/remote/project-worktree",
    }],
    codexProjects: [{
      codexProjectId: "remote-project",
      codexProjectKind: "remote",
      codexHostId: "remote-host",
      workspacePath: "/remote/project",
    }],
    skillPath: "/new/skill/SKILL.md",
    enabledByUser: false,
    quotaAware: false,
    intervalMinutes: 5,
    model: "gpt-5.6-sol",
    reasoningEffort: "ultra",
  };
  let appliedRequest;
  const reconcileStoredAutomationPolicy = vm.runInNewContext(`(${reconcileSource})`, {
    ensureQuotaPoliciesLoaded: async () => {},
    quotaPolicyRecords: new Map([[
      storedRequest.taskboardProjectId,
      { request: storedRequest },
    ]]),
    updateAndApplyQuotaPolicy: async (request) => {
      appliedRequest = request;
      return { policy: request };
    },
    enqueueQuotaPolicyMutation: () => {
      throw new Error("stored target must not continue");
    },
    storedAutomationPolicy: (request) => request,
  });

  const result = await reconcileStoredAutomationPolicy(incomingRequest, () => {});
  assert.deepEqual(
    JSON.parse(JSON.stringify(appliedRequest)),
    {
      ...incomingRequest,
      automationId: "automation-1",
      enabledByUser: true,
      quotaAware: true,
      intervalMinutes: 15,
      model: "gpt-5.5",
      reasoningEffort: "high",
    },
  );
  assert.equal(result.policy, appliedRequest);
  assert.match(source, /reconcileStoredAutomationPolicy\(\s*request,\s*rpc/);
  assert.match(source, /policy: storedAutomationPolicy\(current\.request\)/);
});

test("automation list migrates a legacy policy when the project catalog first arrives", async () => {
  const reconcileSource = source.slice(
    source.indexOf("async function reconcileStoredAutomationPolicy"),
    source.indexOf("async function enqueueCurrentQuotaPolicy"),
  );
  const storedRequest = {
    taskboardProjectId: "taskboard-project",
    codexProjectId: "controller-project",
    codexProjectKind: "local",
    codexHostId: "local",
    projectName: "Controller",
    workspacePath: "/controller",
    remoteProjects: [],
    skillPath: "/skill/SKILL.md",
    automationId: "automation-1",
    enabledByUser: true,
    quotaAware: true,
    intervalMinutes: 5,
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
  };
  const incomingRequest = { ...storedRequest, codexProjects: [] };
  let appliedRequest;
  const reconcileStoredAutomationPolicy = vm.runInNewContext(`(${reconcileSource})`, {
    ensureQuotaPoliciesLoaded: async () => {},
    quotaPolicyRecords: new Map([[
      storedRequest.taskboardProjectId,
      { request: storedRequest },
    ]]),
    updateAndApplyQuotaPolicy: async (request) => {
      appliedRequest = request;
      return { policy: request };
    },
    enqueueQuotaPolicyMutation: () => {
      throw new Error("legacy policy must be migrated");
    },
    storedAutomationPolicy: (request) => request,
  });

  await reconcileStoredAutomationPolicy(incomingRequest, () => {});
  assert.deepEqual(
    JSON.parse(JSON.stringify(appliedRequest)),
    incomingRequest,
  );
});

test("injector restore pauses enabled legacy policies until a project catalog arrives", async () => {
  const restoreSource = source.slice(
    source.indexOf("async function restoreQuotaPolicies"),
    source.indexOf("async function startTaskConversationViaCdp"),
  );
  const cdp = {};
  const legacyRequest = {
    taskboardProjectId: "legacy-project",
    enabledByUser: true,
  };
  const currentRequest = {
    taskboardProjectId: "current-project",
    enabledByUser: true,
    codexProjects: [],
  };
  const paused = [];
  const enqueued = [];
  const restoreQuotaPolicies = vm.runInNewContext(`(${restoreSource})`, {
    registerQuotaPolicyCdp: () => {},
    restoredQuotaPolicyCdps: new Set(),
    quotaPolicyRestorePromises: new Map(),
    ensureQuotaPoliciesLoaded: async () => {},
    quotaPolicyRecords: new Map([
      [legacyRequest.taskboardProjectId, { request: legacyRequest }],
      [currentRequest.taskboardProjectId, { request: currentRequest }],
    ]),
    requestCodexAutomationViaCdp: () => {},
    reconcileTaskboardAutomation: async (request) => {
      paused.push(request);
      return { error: "not-found" };
    },
    enqueueCurrentQuotaPolicy: async (projectId) => {
      enqueued.push(projectId);
    },
  });

  await restoreQuotaPolicies(cdp);
  assert.deepEqual(JSON.parse(JSON.stringify(paused)), [{
    ...legacyRequest,
    operation: "pause",
  }]);
  assert.deepEqual(enqueued, ["current-project"]);
  assert.equal(legacyRequest.enabledByUser, true);
  assert.equal(Object.hasOwn(legacyRequest, "codexProjects"), false);
});

test("the package injection command remains resident for tab-triggered recovery", () => {
  assert.match(packageJson.scripts["codex:inject"], /--watch/);
  assert.match(packageJson.scripts["codex:daemon"], /--daemon --open/);
  assert.match(source, /function startResidentInjector/);
  assert.match(source, /const defaultCodexDebuggingPort = 9229/);
  assert.match(source, /port: defaultCodexDebuggingPort/);
  assert.match(source, /--startup-token/);
  assert.match(source, /__codexTaskboardHostStartupTokenV1/);
});

test("attach reconciles the renderer against a hashed current injection source", () => {
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /__CODEX_TASKBOARD_SOURCE_HASH__/);
  assert.match(source, /sourceHash: window\.__codexTaskboardInjection__\?\.sourceHash \|\| null/);
  assert.match(source, /const injectionScriptIdentifierName = "__CODEX_TASKBOARD_SCRIPT_IDENTIFIER__"/);
  assert.match(source, /scriptIdentifier: window\[\$\{JSON\.stringify\(injectionScriptIdentifierName\)\}\] \|\| null/);
  assert.match(source, /Page\.removeScriptToEvaluateOnNewDocument/);
  assert.match(source, /Page\.addScriptToEvaluateOnNewDocument/);
  assert.match(source, /reconcileInjectionRuntime/);
  assert.match(source, /expectedSourceHash/);
});

test("the injector ignores auxiliary Codex windows", () => {
  assert.match(source, /!target\.url\?\.includes\("initialRoute=%2Fglobal-dictation"\)/);
});

test("a completed web build refreshes an already-open Codex iframe", () => {
  assert.match(packageJson.scripts.build, /--refresh-if-running/);
  assert.match(packageJson.scripts["codex:refresh"], /--refresh/);
  assert.match(source, /async function refreshTaskboardFrames/);
  assert.match(source, /function codexDebuggingPorts/);
  assert.match(source, /--remote-debugging-port=/);
  assert.match(source, /taskboard\.reloadFrame\(\)/);
  assert.match(source, /__codex_taskboard_refresh/);
  assert.match(source, /await restartResidentInjectorForRefresh\(port\)/);
});

test("the injected iframe follows the configured local service port", () => {
  assert.match(source, /const taskboardBaseUrl = `\$\{taskboardOrigin\}\/\$\{encodeURIComponent\(taskboardInstanceToken\)\}`/);
  assert.match(source, /const taskboardPageUrl = `\$\{taskboardBaseUrl\}\/\?host=codex`/);
  assert.match(source, /window\.__CODEX_TASKBOARD_URL__ = \$\{JSON\.stringify\(taskboardPageUrl\)\}/);
});
