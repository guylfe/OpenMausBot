import { CodexBindings, type CodexBindingsDeps } from "../codex-bindings.ts";
import type { ProviderRegistry } from "../harness/registry.ts";
import { createCodexBindingRoutes } from "../routes/codex-bindings.ts";

export function createCodexBindingsHost(deps: Omit<CodexBindingsDeps, "connect"> & { registry: ProviderRegistry; enabled: boolean }) {
  const bridge = new CodexBindings({ ...deps, connect: (instanceId) => {
    if (!deps.enabled) throw new Error("Existing Codex connections require a local workspace.");
    const connect = deps.registry.get(instanceId)?.nativeCodex;
    if (!connect) throw new Error("This Codex instance does not support existing native conversations.");
    return connect();
  } });
  const routes = createCodexBindingRoutes({ bridge, enabled: deps.enabled, instances: () => deps.registry.instances()
    .filter((instance) => instance.enabled && instance.nativeCodex).map((instance) => ({ id: instance.instanceId, name: instance.displayName ?? instance.instanceId })) });
  return { bridge, routes };
}
