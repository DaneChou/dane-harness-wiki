export function withoutTaskboardLauncherEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => (
      name !== "CODEX_API_KEY" && !name.startsWith("CODEX_TASKBOARD_")
    )),
  );
}
