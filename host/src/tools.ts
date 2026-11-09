/**
 * Model-facing tools (CONTRACT.md, "工具契约").
 *
 * Both are plain DSH tool definitions — the shape `ctx.tools.register` takes
 * (see dsh-anywhere/host/src/ui-modules.ts) — and neither imports DSH internals.
 */
import { configSnapshot, restart, start, status, stop } from './process.ts';
import { patchConfig } from './config.ts';
import type { Candidate, Config, ConfigToolResult, ControlResult } from './types.ts';

type Action = 'status' | 'start' | 'stop' | 'restart' | 'url';

const ACTIONS: readonly Action[] = ['status', 'start', 'stop', 'restart', 'url'];

function summarize(state: { running: boolean; url: string | null; bindHost: string | null; port: number | null }, message: string): ControlResult {
  return { running: state.running, url: state.url, bindHost: state.bindHost, port: state.port, message };
}

function describe(state: { running: boolean; url: string | null; bindHost: string | null; port: number | null }): string {
  if (!state.running) return 'dsh web 未运行。';
  const where = `${state.bindHost ?? '?'}:${String(state.port)}`;
  return `dsh web 运行中，监听 ${where}。${state.url ? `访问地址：${state.url}` : '就绪地址暂不可用，请查看日志。'}`;
}

/** `dsh_web_control`: status / start / stop / restart / url. */
export function webControlTool() {
  return {
    name: 'dsh_web_control',
    description: '管理本机的 dsh web 实例（可被局域网 / Tailscale 访问）。'
      + ' action=status 查看状态；start 启动并返回带 token 的完整访问地址；stop 停止；restart 重启；url 只取当前完整地址。'
      + ' 可选 host（具体 IPv4 字面量，如 100.64.0.10 或 192.168.1.100，不能是 0.0.0.0）和 port 覆盖本次启动。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: '要执行的操作。' },
        host: { type: 'string', description: '绑定地址，具体 IPv4 字面量；省略则使用已保存配置或自动探测。' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: '端口；省略则使用已保存配置（默认 3080）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['running', 'url', 'bindHost', 'port', 'message'],
        properties: {
          running: { type: 'boolean' },
          url: { type: 'string', description: '当前访问地址；未运行时为空字符串。' },
          bindHost: { type: 'string', description: '绑定地址；未绑定时为空字符串。' },
          port: { type: 'integer', description: '端口；未运行时为 0。' },
          message: { type: 'string' },
        },
      },
      render: (_args: unknown, value: ControlResult) => [{ type: 'text' as const, text: value.message }],
    },
    timeoutMs: 120_000,
    async execute(args: { action?: unknown; host?: unknown; port?: unknown }): Promise<ControlResult> {
      const action = typeof args.action === 'string' ? (args.action as Action) : undefined;
      if (action === undefined || !ACTIONS.includes(action)) {
        throw new Error(`dsh_web_control 需要 action，取值：${ACTIONS.join(' | ')}`);
      }
      const options: { host?: string; port?: number } = {};
      if (args.host !== undefined && args.host !== null) {
        if (typeof args.host !== 'string') throw new Error('dsh_web_control 的 host 必须是字符串（IPv4 字面量）');
        options.host = args.host;
      }
      if (args.port !== undefined && args.port !== null) {
        if (typeof args.port !== 'number') throw new Error('dsh_web_control 的 port 必须是整数');
        options.port = args.port;
      }
      switch (action) {
        case 'status': {
          const state = await status();
          return summarize(state, state.running ? describe(state) : `${describe(state)}${state.warnings.length > 0 ? `（${state.warnings.join(' ')}）` : ''}`);
        }
        case 'start': {
          const state = await start(options);
          return summarize(state, `已启动。${describe(state)}`);
        }
        case 'stop': {
          const state = await stop();
          return summarize(state, 'dsh web 已停止。');
        }
        case 'restart': {
          const state = await restart(options);
          return summarize(state, `已重启。${describe(state)}`);
        }
        case 'url': {
          const state = await status();
          return summarize(state, state.running && state.url ? `当前访问地址：${state.url}` : 'dsh web 未运行，没有访问地址。');
        }
      }
    },
  };
}

/**
 * Shapes the config snapshot for the tool's declared output schema.
 *
 * The schema cannot express `string | null` (DSH rejects type arrays), so a null bindHost
 * is reported as the empty string with an explicit flag instead of being silently dropped.
 */
function toResult(snapshot: { config: Config; candidates: Candidate[] }): ConfigToolResult & { autoBind: boolean } {
  const { config, candidates } = snapshot;
  return {
    config: { ...config, bindHost: config.bindHost ?? '' },
    candidates,
    autoBind: config.bindHost === null,
  };
}

/** `dsh_web_config`: read or patch the persisted config. No args = read. */
export function webConfigTool() {
  return {
    name: 'dsh_web_config',
    description: '读取或修改 dsh-web-control 的持久化配置（~/.dsh-web-control/config.json）：'
      + 'bindHost（IPv4 字面量或 null=自动探测）、port（1-65535，默认 3080）、autoStart（首次访问插件时是否自动启动）。'
      + ' 不传任何参数即为读取。返回当前配置与可用地址候选。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bindHost: { type: 'string', description: '绑定地址，必须是具体 IPv4 字面量；传 "auto" 表示恢复自动探测。' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: '端口。' },
        autoStart: { type: 'boolean', description: '首次访问插件时自动启动。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['config', 'candidates', 'autoBind'],
        properties: {
          config: {
            type: 'object',
            additionalProperties: false,
            required: ['bindHost', 'port', 'autoStart'],
            properties: {
              bindHost: { type: 'string', description: '绑定地址；自动探测时为空字符串。' },
              port: { type: 'integer' },
              autoStart: { type: 'boolean' },
            },
          },
          autoBind: { type: 'boolean', description: 'true 表示 bindHost 走自动探测。' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'host', 'kind'],
              properties: { label: { type: 'string' }, host: { type: 'string' }, kind: { type: 'string', enum: ['tailscale', 'lan', 'loopback'] } },
            },
          },
        },
      },
      render: (_args: unknown, value: ConfigToolResult) => [
        { type: 'text' as const, text: `bindHost=${value.config.bindHost || '自动'} port=${value.config.port} autoStart=${String(value.config.autoStart)}；候选地址：${value.candidates.map(item => `${item.host}(${item.kind})`).join('、')}` },
      ],
    },
    timeoutMs: 30_000,
    async execute(args: { bindHost?: unknown; port?: unknown; autoStart?: unknown }): Promise<ConfigToolResult> {
      const patch: Partial<Record<keyof Config, unknown>> = {};
      if (args.bindHost !== undefined) patch.bindHost = args.bindHost === 'auto' ? null : args.bindHost;
      if (args.port !== undefined) patch.port = args.port;
      if (args.autoStart !== undefined) patch.autoStart = args.autoStart;
      if (Object.keys(patch).length > 0) await patchConfig(patch);
      return toResult(await configSnapshot());
    },
  };
}

/** Both tools, ready for `ctx.tools.register(...)` (the config tool keeps its own return type). */
export function webControlTools() {
  return [webControlTool(), webConfigTool()];
}
