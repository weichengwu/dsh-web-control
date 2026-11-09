/**
 * dsh-web-control — the Cordis plugin entry point.
 *
 * Exports `name` / `inject` / `apply` like any DSH plugin, but talks to DSH only through a
 * strictly structural context: no DSH package is imported, so this file builds and loads
 * under a plain Node process as well.
 *
 *   ctx.connection.fetch.register({ path, methods, requestBody, fetch })  → the /api routes
 *   ctx.tools.register(definition)                                       → the agent tools
 */
import { ensureStateDir, loadConfig, logPath, stateDir } from './config.ts';
import { createDshWebControlRoutes } from './admin.ts';
import { currentState, start } from './process.ts';
import { webControlTools } from './tools.ts';
import type { DshWebControlRoute } from './types.ts';

export const PLUGIN_NAME = 'dsh-web-control';
export const name = PLUGIN_NAME;
export const version = '0.1.0';

/**
 * Only `connection` and `tools` are optional services used through optional injection
 * below; keeping `inject` empty means the plugin also loads in a headless composition
 * where neither exists (it then just does nothing).
 */
export const inject: string[] = [];

interface RouteRegistrar {
  register(route: DshWebControlRoute): () => unknown;
}

interface ToolRegistrar {
  register(tool: unknown): () => unknown;
}

/** Structural Cordis context: the subset this plugin touches, nothing vendored. */
export interface WebControlContext {
  readonly connection?: { readonly fetch?: RouteRegistrar };
  readonly tools?: ToolRegistrar;
  inject?(
    names: string[],
    callback: (ctx: WebControlContext) => (() => unknown) | undefined,
  ): unknown;
  effect?(callback: () => (() => unknown) | undefined, label?: string): unknown;
}

function disposeAll(disposers: (() => unknown)[]): () => Promise<void> {
  return async () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { await dispose(); } catch { /* a failing disposer must not block the others */ }
    }
  };
}

/**
 * Registers everything and returns the teardown effect. DSH accepts both an effect
 * ("Promise<disposer>") and an explicit cleanup, so exposing the returned function keeps
 * a test harness able to drive it directly.
 */
export function registerRoutes(ctx: WebControlContext): (() => unknown) | undefined {
  const connection = ctx.connection;
  const fetch = connection?.fetch;
  if (typeof fetch?.register !== 'function') return undefined;
  const disposers: (() => unknown)[] = [];
  try {
    for (const route of createDshWebControlRoutes()) disposers.push(fetch.register(route));
  } catch (error) {
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch { /* best effort */ }
    }
    throw error;
  }
  return disposeAll(disposers);
}

export function registerTools(ctx: WebControlContext): (() => unknown) | undefined {
  const tools = ctx.tools;
  if (typeof tools?.register !== 'function') return undefined;
  const disposers: (() => unknown)[] = [];
  try {
    for (const tool of webControlTools()) disposers.push(tools.register(tool));
  } catch (error) {
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch { /* best effort */ }
    }
    throw error;
  }
  return disposeAll(disposers);
}

/** Records a service-scoped disposer so the plugin's own teardown also releases it. */
function track(disposers: (() => unknown)[], dispose: (() => unknown) | undefined): (() => unknown) | undefined {
  if (dispose === undefined) return undefined;
  disposers.push(dispose);
  return dispose;
}

/**
 * Optional service wiring: `inject` when the context offers it (Cordis loads the plugin
 * even when the service is absent, then calls back once it shows up), otherwise the
 * direct property when a composition already supplies it.
 */
function wire(ctx: WebControlContext): (() => unknown) | undefined {
  const disposers: (() => unknown)[] = [];
  if (typeof ctx.inject === 'function') {
    // A throwing service callback would abort startup, so each wiring is isolated.
    const guarded = (register: (scoped: WebControlContext) => (() => unknown) | undefined) => (scoped: WebControlContext) => {
      try {
        return track(disposers, register(scoped));
      } catch (error) {
        process.emitWarning(`dsh-web-control: 注册失败：${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    };
    ctx.inject(['connection'], guarded(registerRoutes));
    ctx.inject(['tools'], guarded(registerTools));
    return () => { for (const dispose of disposers.splice(0)) dispose(); };
  }
  const routesDispose = registerRoutes(ctx);
  if (routesDispose !== undefined) disposers.push(routesDispose);
  const toolsDispose = registerTools(ctx);
  if (toolsDispose !== undefined) disposers.push(toolsDispose);
  return disposers.length === 0 ? undefined : disposeAll(disposers);
}

/** First-run convenience: create the state directory, and honour `autoStart`. */
async function bootstrap(): Promise<void> {
  await ensureStateDir();
  const config = await loadConfig();
  if (!config.autoStart) return;
  const state = await currentState();
  if (state.running) return;
  // Failures are expected here (no address, port taken) and must not block plugin load:
  // the settings page reports them with full context when the user presses Start.
  try {
    await start({});
  } catch (error) {
    process.emitWarning(`dsh-web-control: 自动启动失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Cordis entry: returns a disposer, exactly like the dsh-anywhere companion plugin. */
export async function apply(ctx: WebControlContext, _config?: unknown): Promise<() => Promise<void>> {
  const teardown = wire(ctx);
  // Never let first-run bootstrap failure prevent the plugin from loading; warn and continue.
  try {
    await bootstrap();
  } catch (error) {
    process.emitWarning(`dsh-web-control: 初始化失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return async () => {
    if (teardown !== undefined) await teardown();
  };
}

/** Paths the plugin owns, handy for logs and docs. */
export const paths = { stateDir, logPath };

export default { name, inject, apply };
