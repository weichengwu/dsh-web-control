/**
 * Public type surface for dsh-web-control, exactly as agreed in CONTRACT.md.
 * Nothing here imports DSH internals: the host half is plain Node.
 */

/** Persisted user settings, stored in ~/.dsh-web-control/config.json. */
export interface Config {
  /** IPv4 literal to bind to, or null to auto-detect on start. */
  bindHost: string | null;
  /** TCP port the dsh web instance listens on. */
  port: number;
  /** Start the instance automatically on the first plugin request. */
  autoStart: boolean;
}

/** Runtime state of the managed dsh web child process, stored in instance.json. */
export interface InstanceState {
  pid: number | null;
  running: boolean;
  /** Full access URL including the one-use token, once the instance is ready. */
  url: string | null;
  bindHost: string | null;
  port: number | null;
  /** Epoch milliseconds. */
  startedAt: number | null;
  logFile: string;
}

/** One address the user can bind to. */
export interface Candidate {
  label: string;
  host: string;
  kind: 'tailscale' | 'lan' | 'loopback';
}

/** GET/POST /status, /start, /stop, /restart. */
export interface StatusResponse extends InstanceState {
  candidates: Candidate[];
  /** The address a start would use right now (configured or auto-detected). */
  effectiveHost: string | null;
  config: Config;
  warnings: string[];
}

/** GET/POST /config. */
export interface ConfigResponse {
  config: Config;
  candidates: Candidate[];
}

/** Uniform error envelope: `{ error: { code, message } }`. */
export interface ErrorResponse {
  error: { code: string; message: string };
}

/** Result of the `dsh_web_control` tool. */
export interface ControlResult {
  running: boolean;
  url: string | null;
  bindHost: string | null;
  port: number | null;
  message: string;
}

/** Result of the `dsh_web_config` tool. */
export interface ConfigToolResult {
  config: Config;
  candidates: Candidate[];
}

/** A single route registered on DSH's shared authenticated /api channel. */
export interface DshWebControlRoute {
  readonly path: string;
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[];
  readonly requestBody: 'buffered' | 'streaming';
  readonly fetch: (request: Request) => Promise<Response>;
}

/** Machine-readable failure. `status` maps onto the HTTP status the route answers with. */
export class DshWebControlError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = 'DshWebControlError';
    this.code = code;
    this.status = status;
  }
}

export const DEFAULT_PORT = 3080;

export const DEFAULT_CONFIG: Config = Object.freeze({ bindHost: null, port: DEFAULT_PORT, autoStart: false }) as Config;
