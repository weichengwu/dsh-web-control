/**
 * HTTP routes for the "设置 → Web 访问" settings page (CONTRACT.md, "HTTP 路由契约").
 *
 * Everything hangs off /api/dsh-web-control and answers JSON. DSH's own browser auth
 * already protects these routes; they never leave the local DSH process.
 */
import { configSnapshot, readLog, restart, start, status, stop } from './process.ts';
import { patchConfig } from './config.ts';
import { CONFIG_PATH, LOG_PATH, STATE_DIR } from './constants.ts';
import type { DshWebControlError, DshWebControlRoute } from './types.ts';

export const API_PREFIX = '/api/dsh-web-control';

function json(statusCode: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function failure(statusCode: number, code: string, message: string): Response {
  return json(statusCode, { error: { code, message } });
}

function isDshWebControlError(error: unknown): error is DshWebControlError {
  return error instanceof Error && error.name === 'DshWebControlError' && typeof (error as unknown as { code?: unknown }).code === 'string';
}

/** Turns any thrown value into the contract error envelope with a sensible status. */
function toFailure(error: unknown): Response {
  if (error instanceof RequestError) return failure(error.status, error.code, error.message);
  if (isDshWebControlError(error)) return failure(error.status, error.code, error.message);
  const message = error instanceof Error ? error.message : String(error);
  return failure(500, 'internal_error', message);
}

/** A caller-input failure with the contract's status and code. */
class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
  }
}

/** POST bodies are optional: an empty body means "use the stored config". */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return {};
  }
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError(400, 'invalid_request', '请求体不是合法 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RequestError(400, 'invalid_request', '请求体必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

/** `{ host?, port? }` from a POST body; presence means "override for this run" (and is persisted). */
function overrides(body: Record<string, unknown>): { host?: string; port?: number } {
  const options: { host?: string; port?: number } = {};
  if (body.host !== undefined && body.host !== null) options.host = String(body.host);
  if (body.port !== undefined && body.port !== null) options.port = body.port as number;
  return options;
}

/** Registry of every route, matching CONTRACT.md row for row. */
export function createDshWebControlRoutes(): DshWebControlRoute[] {
  /** Persists any host/port override, then runs `action`. An override is remembered, so a later autoStart reproduces what the user asked for. */
  const withOverrides = async (request: Request, action: (options: { host?: string; port?: number }) => Promise<unknown>): Promise<Response> => {
    let body: Record<string, unknown>;
    try {
      body = await readBody(request);
    } catch (error) {
      return toFailure(error);
    }
    try {
      const patch: Record<string, unknown> = {};
      if (body.host !== undefined) patch.bindHost = body.host;
      if (body.port !== undefined) patch.port = body.port;
      if (Object.keys(patch).length > 0) await patchConfig(patch);
      return json(200, await action(overrides(body)));
    } catch (error) {
      return toFailure(error);
    }
  };

  const statusRoute = async (): Promise<Response> => {
    try {
      return json(200, await status());
    } catch (error) {
      return toFailure(error);
    }
  };

  const startRoute = (request: Request): Promise<Response> => withOverrides(request, options => start(options));

  const stopRoute = async (_request: Request): Promise<Response> => {
    try {
      return json(200, await stop());
    } catch (error) {
      return toFailure(error);
    }
  };

  const restartRoute = (request: Request): Promise<Response> => withOverrides(request, options => restart(options));

  const logRoute = async (request: Request): Promise<Response> => {
    try {
      const raw = new URL(request.url).searchParams.get('lines');
      const parsed = raw === null || raw.trim() === '' ? 200 : Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_000) {
        return failure(400, 'invalid_request', 'lines 必须是 1-2000 之间的整数');
      }
      return json(200, { log: await readLog(parsed) });
    } catch (error) {
      return toFailure(error);
    }
  };

  const configGet = async (): Promise<Response> => {
    try {
      return json(200, await configSnapshot());
    } catch (error) {
      return toFailure(error);
    }
  };

  const configPost = async (request: Request): Promise<Response> => {
    try {
      const body = await readBody(request);
      await patchConfig(body);
      return json(200, await configSnapshot());
    } catch (error) {
      return toFailure(error);
    }
  };

  const candidatesRoute = async (): Promise<Response> => {
    try {
      const snapshot = await configSnapshot();
      return json(200, { candidates: snapshot.candidates });
    } catch (error) {
      return toFailure(error);
    }
  };

  // Diagnostics for the settings page footer; not part of the contract table but harmless.
  const infoRoute = async (): Promise<Response> =>
    json(200, { stateDir: STATE_DIR, configPath: CONFIG_PATH, logPath: LOG_PATH });

  return [
    { path: `${API_PREFIX}/status`, methods: ['GET'], requestBody: 'buffered', fetch: statusRoute },
    { path: `${API_PREFIX}/start`, methods: ['POST'], requestBody: 'buffered', fetch: startRoute },
    { path: `${API_PREFIX}/stop`, methods: ['POST'], requestBody: 'buffered', fetch: stopRoute },
    { path: `${API_PREFIX}/restart`, methods: ['POST'], requestBody: 'buffered', fetch: restartRoute },
    { path: `${API_PREFIX}/log`, methods: ['GET'], requestBody: 'buffered', fetch: logRoute },
    { path: `${API_PREFIX}/config`, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: (request) => (request.method === 'POST' ? configPost(request) : configGet()) },
    { path: `${API_PREFIX}/candidates`, methods: ['GET'], requestBody: 'buffered', fetch: candidatesRoute },
    { path: `${API_PREFIX}/info`, methods: ['GET'], requestBody: 'buffered', fetch: infoRoute },
  ];
}
