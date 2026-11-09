'use strict';
// dsh-web-control — 浏览器端「设置 → Web 访问」面板。
//
// 这是打成 CJS 的模块：React 必须通过 require('react') 从平台冻结表里取，
// 绝不能把 React 打包进来。导出 { name, inject, apply }，apply 里把面板注册到
// settings.section 槽上（见 CONTRACT.md「客户端 UI 契约」）。

const React = require('react');
const h = React.createElement;

const API = '/api/dsh-web-control';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// 单次请求上限：启动/重启要等子进程就绪（宿主侧最长 45 秒），所以给足 70 秒；
// 超时后仍会按「启动中」继续轮询状态，不会卡死按钮。
const REQUEST_TIMEOUT_MS = 70000;

async function request(path, init) {
  const options = init || {};
  const headers = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  Object.assign(headers, options.headers || {});
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(`${API}/${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
      ...options,
      headers,
    });
  } catch (cause) {
    if (cause && cause.name === 'AbortError') throw new Error('请求超时，稍后再试');
    throw new Error('无法连接到 DSH 宿主，请确认应用仍在运行');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body && body.error && body.error.message) || `请求失败（HTTP ${response.status}）`);
  }
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 启动/重启要等子进程就绪，期间用非阻塞轮询刷新状态。
async function settle(setStatus, delayMs) {
  for (let round = 0; round < 40; round += 1) {
    await sleep(round === 0 ? delayMs : 1000);
    try {
      setStatus(await request('status'));
      return;
    } catch {
      /* 宿主短暂不可达时忽略，继续重试 */
    }
  }
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

function formatDuration(startedAt, now) {
  if (typeof startedAt !== 'number' || !isFinite(startedAt)) return '—';
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function formatClock(startedAt) {
  if (typeof startedAt !== 'number' || !isFinite(startedAt)) return '';
  return new Date(startedAt).toLocaleString();
}

function candidateKindText(kind) {
  if (kind === 'tailscale') return 'Tailscale';
  if (kind === 'lan') return '局域网';
  if (kind === 'loopback') return '本机';
  return kind || '地址';
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function clampLines(value) {
  const n = Math.round(Number(value));
  if (!isFinite(n) || n <= 0) return 200;
  return Math.min(1000, Math.max(20, n));
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

// config.bindHost 为 null 表示「自动探测」；界面上直接展示探测结果，避免用户看到一个空值。
function describeEntry(bindHost, candidates) {
  if (bindHost) return bindHost;
  const list = candidates || [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    if (item.kind === 'tailscale' && item.host) return item.host;
  }
  return list[0] && list[0].host ? list[0].host : '自动';
}

// ---------------------------------------------------------------------------
// 样式（全部走 DSH 的 --dsw-alias-* 别名，深浅色主题自动跟随）
// ---------------------------------------------------------------------------

// DSH 主题色板里 --dsw-alias-border-l3 / -l4 在浅色主题下只有约 12%–16% 不透明度，
// 单独当描边太淡（深色主题下反而偏亮），所以统一用「主文字色 + 透明度」的 color-mix：
// 它跟着主题自动反转，深浅两边都是同样的视觉对比度。
const hairline = 'color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)';

const color = {
  primary: 'var(--dsw-alias-label-primary, #0f1115)',
  secondary: 'var(--dsw-alias-label-secondary, #61666b)',
  tertiary: 'var(--dsw-alias-label-tertiary, #81858c)',
  border: 'var(--dsw-alias-border-l4, rgba(127, 127, 127, 0.28))',
  borderStrong: 'var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.4))',
  hairline,
  // 控件描边 / 选中态描边 / 卡片描边：逐级加粗
  control: 'color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)',
  controlStrong: 'color-mix(in srgb, var(--dsw-alias-label-primary) 38%, transparent)',
  cardLine: 'color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent)',
  cardFill: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, transparent))',
  cardStroke: 'var(--dsw-alias-settings-card-stroke, transparent)',
  inputFill: 'var(--dsw-alias-bg-layer-1, transparent)',
  codeFill: 'var(--dsw-alias-markdown-code-block, transparent)',
  primaryFill: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary))',
  primaryLabel: 'var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-base))',
  error: 'var(--dsw-alias-state-error-primary, #ec1313)',
  success: 'var(--dsw-alias-state-success-primary, #22c55e)',
  idle: 'var(--dsw-alias-state-idle-primary, #adb2b8)',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  hover: 'var(--dsw-alias-interactive-bg-hover)',
  hoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger, transparent)',
  accent: 'var(--dsw-alias-label-primary)',
};

const mono = 'var(--dsw-font-mono, var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace))';

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '4px 0 8px',
    color: color.primary,
    fontSize: 13,
    lineHeight: '20px',
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 720,
  },
  card: {
    border: `0.5px solid ${color.cardStroke}`,
    borderRadius: 'var(--dsw-radius-md, 12px)',
    background: color.cardFill,
    padding: '12px 16px',
    boxSizing: 'border-box',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 24,
  },
  title: { fontSize: 13, fontWeight: 600, letterSpacing: 0.1, lineHeight: '20px' },
  caption: { color: color.tertiary, fontSize: 12, lineHeight: '18px' },
  secondary: { color: color.secondary, fontSize: 12, lineHeight: '18px' },
  divider: { borderTop: `0.5px solid ${color.hairline}`, margin: '10px 0' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
    gap: '10px 20px',
    marginTop: 10,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  fieldLabel: { color: color.tertiary, fontSize: 11, lineHeight: '16px' },
  fieldValue: {
    color: color.primary,
    fontSize: 13,
    lineHeight: '20px',
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  statusText: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, lineHeight: '20px' },
  dot: { width: 8, height: 8, borderRadius: 4, flex: 'none', display: 'inline-block' },
  button: {
    minHeight: 30,
    padding: '0 12px',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    border: `1px solid ${color.control}`,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    fontSize: 12.5,
    lineHeight: '18px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    whiteSpace: 'nowrap',
    flex: 'none',
  },
  buttonPrimary: {
    background: color.primaryFill,
    color: color.primaryLabel,
    borderColor: 'transparent',
    fontWeight: 600,
  },
  buttonDanger: { color: color.error },
  buttonDisabled: { opacity: 0.4, cursor: 'default' },
  buttonBusy: { cursor: 'progress' },
  input: {
    height: 30,
    width: 96,
    padding: '0 8px',
    boxSizing: 'border-box',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    border: `1px solid ${color.control}`,
    background: color.inputFill,
    color: 'inherit',
    font: 'inherit',
    fontSize: 13,
    lineHeight: '18px',
    fontVariantNumeric: 'tabular-nums',
    outline: 'none',
  },
  urlBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 8px 6px 12px',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    border: `0.5px solid ${color.hairline}`,
    background: color.inputFill,
  },
  urlText: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: mono,
    fontSize: 12,
    lineHeight: '18px',
    color: color.primary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    userSelect: 'all',
  },
  options: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6 },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 32,
    padding: '0 8px',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    cursor: 'pointer',
    border: '1px solid transparent',
    boxSizing: 'border-box',
  },
  optionActive: { borderColor: color.control, background: color.hover || 'transparent' },
  optionDisabled: { cursor: 'default', opacity: 0.55 },
  radio: {
    width: 14,
    height: 14,
    margin: 0,
    flex: 'none',
    accentColor: color.accent,
    cursor: 'inherit',
  },
  optionMain: { flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  optionLabel: { fontSize: 13, lineHeight: '20px', color: color.primary, whiteSpace: 'nowrap' },
  optionHost: { fontSize: 11, lineHeight: '16px', color: color.tertiary, fontFamily: mono, whiteSpace: 'nowrap' },
  // 小徽标：高度固定 20px，和 13px 文字同一光学中线对齐（不用 baseline，避免行高把整行撑歪）
  tag: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    height: 20,
    padding: '0 6px',
    boxSizing: 'border-box',
    borderRadius: 'var(--dsw-radius-xs, 4px)',
    border: `1px solid ${color.control}`,
    fontSize: 10.5,
    lineHeight: '18px',
    color: color.secondary,
    whiteSpace: 'nowrap',
  },
  tagAccent: {
    borderColor: 'transparent',
    background: color.hover || 'transparent',
    color: color.primary,
    fontWeight: 500,
  },
  errorBar: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    border: `1px solid color-mix(in srgb, ${color.error} 45%, transparent)`,
    background: color.hoverDanger,
    color: color.error,
    fontSize: 12,
    lineHeight: '18px',
  },
  errorMessage: { flex: '1 1 auto', minWidth: 0, color: color.primary, overflowWrap: 'anywhere' },
  warnLine: { color: color.tertiary, fontSize: 11, lineHeight: '16px', overflowWrap: 'anywhere' },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: color.error,
    font: 'inherit',
    fontSize: 11,
    lineHeight: '18px',
    padding: 0,
    cursor: 'pointer',
    flex: 'none',
  },
  log: {
    margin: '8px 0 0',
    padding: 10,
    maxHeight: 240,
    overflow: 'auto',
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    border: `0.5px solid ${color.hairline}`,
    background: color.codeFill,
    color: color.secondary,
    fontFamily: mono,
    fontSize: 11.5,
    lineHeight: '17px',
  },
  logText: { margin: 0, font: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  footer: { color: color.tertiary, fontSize: 11, lineHeight: '16px', padding: '0 2px' },
};

function merge() {
  let out = {};
  for (let i = 0; i < arguments.length; i += 1) {
    const part = arguments[i];
    if (part) Object.assign(out, part);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 小组件
// ---------------------------------------------------------------------------

function Button(props) {
  const disabled = !!props.disabled;
  return h(
    'button',
    {
      type: 'button',
      onClick: disabled ? undefined : props.onClick,
      disabled,
      title: props.title,
      style: merge(
        styles.button,
        props.variant === 'primary' ? styles.buttonPrimary : null,
        props.variant === 'danger' ? styles.buttonDanger : null,
        disabled ? styles.buttonDisabled : null,
        props.busy ? styles.buttonBusy : null,
      ),
    },
    props.busy && props.busyLabel ? props.busyLabel : props.children,
  );
}

function Field(props) {
  return h(
    'div',
    { style: styles.field },
    h('div', { style: styles.fieldLabel }, props.label),
    h('div', { style: props.wrap ? styles.fieldValue : null, title: props.title || undefined }, props.children),
  );
}

function StatusPill(props) {
  if (props.loading) {
    return h('span', { style: merge(styles.statusText, { color: color.tertiary }) }, '读取中…');
  }
  const running = !!props.running;
  const pending = props.pending;
  const text = pending ? pending : running ? '运行中' : '未运行';
  const ink = pending ? color.warn : running ? color.success : color.idle;
  return h(
    'span',
    { style: merge(styles.statusText, { color: color.primary }) },
    h('span', { style: merge(styles.dot, { background: ink }), 'aria-hidden': 'true' }),
    text,
  );
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

function Panel() {
  const [status, setStatus] = React.useState(undefined);
  const [loadError, setLoadError] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [now, setNow] = React.useState(Date.now());

  const [portText, setPortText] = React.useState('');
  const [saveNote, setSaveNote] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  const [autoStart, setAutoStart] = React.useState(false);
  const [logOpen, setLogOpen] = React.useState(false);
  const [logText, setLogText] = React.useState('');
  const [logError, setLogError] = React.useState('');
  const [logLoading, setLogLoading] = React.useState(false);
  const [customHost, setCustomHost] = React.useState('');
  const [customOpen, setCustomOpen] = React.useState(false);

  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 首次加载 + 只读页面可见时定时刷新状态（后台页面不轮询）。
  React.useEffect(() => {
    let cancelled = false;
    let timer = null;
    const tick = async () => {
      try {
        const next = await request('status');
        if (cancelled || !alive.current) return;
        setStatus(next);
        setLoadError('');
      } catch (cause) {
        if (cancelled || !alive.current) return;
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      }
      timer = setTimeout(tick, 5000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // 让「已运行 X 分钟」自己走字，不用等状态刷新。
  const runningNow = status && status.running;
  React.useEffect(() => {
    if (!runningNow) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningNow]);

  const config = (status && status.config) || { bindHost: null, port: 3080, autoStart: false };
  const candidates = (status && status.candidates) || [];

  // 服务端配置变化时同步输入框（用户没在编辑时）
  React.useEffect(() => {
    setPortText(String(config.port));
    setAutoStart(!!config.autoStart);
  }, [config.port, config.autoStart]);

  const refresh = React.useCallback(async () => {
    try {
      const next = await request('status');
      if (alive.current) {
        setStatus(next);
        setLoadError('');
      }
    } catch (cause) {
      if (alive.current) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const doAction = React.useCallback(
    async (kind) => {
      if (busy) return;
      const isRestart = kind === 'restart';
      if (isRestart && !window.confirm('重启会让当前访问地址的 token 失效，手机端需要重新扫码或打开新地址。继续？')) {
        return;
      }
      setBusy(kind);
      setActionError('');
      setSaveNote('');
      try {
        const next = await request(kind, { method: 'POST', body: JSON.stringify({}) });
        if (alive.current) setStatus(next);
        if (kind === 'start' || isRestart) settle(setStatus, 600);
        if (kind === 'stop' && alive.current) await refresh();
      } catch (cause) {
        if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause));
        await refresh();
      } finally {
        if (alive.current) setBusy('');
      }
    },
    [busy, refresh],
  );

  const saveConfig = React.useCallback(
    async (patch) => {
      if (busy) return false;
      setBusy('config');
      setActionError('');
      setSaveNote('');
      try {
        await request('config', { method: 'POST', body: JSON.stringify(patch) });
        await refresh();
        if (alive.current) setSaveNote('已保存');
        return true;
      } catch (cause) {
        if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        if (alive.current) setBusy('');
      }
    },
    [busy, refresh],
  );

  const pickHost = (host) => {
    if (busy || host === (config.bindHost || null)) return;
    saveConfig({ bindHost: host });
  };

  const savePort = () => {
    const port = Math.round(Number(portText));
    if (!isFinite(port) || port < 1 || port > 65535) {
      setActionError('端口必须是 1–65535 之间的整数');
      return;
    }
    if (port === config.port) {
      setPortText(String(config.port));
      return;
    }
    saveConfig({ port });
  };

  const toggleAutoStart = () => {
    if (busy) return;
    const next = !autoStart;
    setAutoStart(next);
    saveConfig({ autoStart: next });
  };

  const copyUrl = async () => {
    const url = status && status.url;
    if (!url) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const area = document.createElement('textarea');
        area.value = url;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        document.body.removeChild(area);
      } catch {
        ok = false;
      }
    }
    setCopied(ok);
    if (!ok) setActionError('复制失败，请手动选中地址复制');
    setTimeout(() => setCopied(false), 1500);
  };

  const loadLog = React.useCallback(async (lines) => {
    setLogLoading(true);
    setLogError('');
    try {
      const body = await request(`log?lines=${clampLines(lines)}`);
      if (alive.current) setLogText(typeof body.log === 'string' ? body.log : '');
    } catch (cause) {
      if (alive.current) setLogError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setLogLoading(false);
    }
  }, []);

  const toggleLog = () => {
    const next = !logOpen;
    setLogOpen(next);
    if (next) loadLog(200);
  };

  const running = !!(status && status.running);
  const pendingStart = busy === 'start' || busy === 'restart';
  const busyAny = busy !== '';
  const statusReady = status !== undefined;
  const url = status && status.url;
  const startedAt = status && status.startedAt;
  const effectiveHost = (status && status.effectiveHost) || (status && status.bindHost) || config.bindHost || '127.0.0.1';
  const effectivePort = (status && status.port) || config.port;
  const warnings = (status && status.warnings) || [];
  const error = actionError || loadError;

  // 候选列表：Tailscale → 局域网 → 本机，去重；并把「自动」（null）放在最前。
  const options = [{ host: null, label: '自动选择', kind: 'auto' }];
  const seen = {};
  for (let i = 0; i < candidates.length; i += 1) {
    const item = candidates[i] || {};
    if (!item.host || seen[item.host]) continue;
    seen[item.host] = true;
    options.push({ host: item.host, label: item.label, kind: item.kind });
  }
  const activeConfigHost = config.bindHost || null;
  if (activeConfigHost && !seen[activeConfigHost]) {
    options.splice(1, 0, { host: activeConfigHost, label: '当前保存的地址', kind: 'custom' });
  }

  const header = h(
    'div',
    { style: styles.cardHeader },
    h('div', { style: { minWidth: 0 } },
      h('div', { style: styles.title }, 'Web 访问'),
      h('div', { style: styles.caption }, '把 dsh web 绑定到 Tailscale 或局域网地址，手机或其他设备也能打开这套 DSH。'),
    ),
    h(StatusPill, { loading: status === undefined && error === '', running, pending: pendingStart ? '启动中…' : '' }),
  );

  const infoGrid = h(
    'div',
    { style: styles.grid },
    h(Field, {
      label: '本地监听地址',
      title: running ? `${effectiveHost}:${effectivePort}` : undefined,
    }, `${effectiveHost}:${effectivePort}`),
    h(Field, {
      label: '入口地址',
      title: config.bindHost ? config.bindHost : '自动探测（优先 Tailscale）',
    }, describeEntry(config.bindHost, candidates)),
    h(Field, {
      label: '运行时长',
      title: startedAt ? `于 ${formatClock(startedAt)} 启动` : undefined,
    }, running ? formatDuration(startedAt, now) : '—'),
    h(Field, { label: 'PID' }, running && status.pid ? String(status.pid) : '—'),
  );

  const actions = h(
    'div',
    { style: merge(styles.row, { marginTop: 12 }) },
    h(Button, {
      variant: 'primary',
      onClick: () => doAction('start'),
      disabled: busyAny || running || !statusReady,
      title: running ? '服务已在运行' : '',
      busy: busy === 'start',
      busyLabel: '启动中…',
    }, '启动'),
    h(Button, {
      onClick: () => doAction('stop'),
      disabled: busyAny || !running,
      title: running ? '' : '服务未运行',
      busy: busy === 'stop',
      busyLabel: '停止中…',
    }, '停止'),
    h(Button, {
      onClick: () => doAction('restart'),
      disabled: busyAny || !running,
      title: running ? '' : '服务未运行',
      busy: busy === 'restart',
      busyLabel: '重启中…',
    }, '重启'),
    busy === 'start' || busy === 'restart'
      ? h('span', { style: styles.caption }, '正在等待 dsh web 就绪，最多约 45 秒…')
      : null,
  );

  const warningsBlock = warnings.length > 0
    ? h('div', { style: merge(styles.warnLine, { marginTop: 10 }) },
        warnings.map((item, index) => h('div', { key: index }, `· ${item}`)))
    : null;

  const urlBlock = running && url
    ? h('div', null,
        h('div', { style: merge(styles.cardHeader, { marginTop: 12 }) },
          h('div', { style: styles.caption }, '访问地址（含一次性 token，请勿随手分享）'),
          sameOrigin(url) ? h('span', { style: styles.tag }, '当前页面') : null,
        ),
        h('div', { style: merge(styles.urlBox, { marginTop: 6 }) },
          h('span', { style: styles.urlText, title: url }, url),
          h(Button, { onClick: copyUrl }, copied ? '已复制' : '复制'),
          h(Button, { onClick: () => window.open(url, '_blank', 'noopener') }, '打开'),
        ),
        warningsBlock,
      )
    : null;

  const optionsBlock = h('div', null,
    h('div', { style: merge(styles.caption, { marginTop: 12 }) }, '绑定地址'),
    h('div', { style: styles.options },
      options.map((option) => {
        const host = option.host;
        const selected = (host === null && !activeConfigHost) || (host !== null && host === activeConfigHost);
        const locked = busy || running;
        const tag = option.kind === 'auto' ? '推荐' : candidateKindText(option.kind);
        const main = host === null
          ? h('span', { style: styles.optionLabel }, '自动选择（优先 Tailscale）')
          : h('span', { style: styles.optionMain },
              h('span', { style: styles.optionLabel }, option.label || host),
              h('span', { style: styles.optionHost }, host));
        return h('label', {
          key: host === null ? '__auto__' : host,
          style: merge(styles.option, selected ? styles.optionActive : null, locked ? styles.optionDisabled : null),
          title: running ? '服务运行中，停止后才能切换绑定地址' : '设为绑定地址',
        },
          h('input', {
            type: 'radio',
            name: 'dsh-web-control-bind-host',
            checked: selected,
            disabled: locked,
            onChange: () => pickHost(host),
            style: styles.radio,
          }),
          main,
          h('span', { style: merge(styles.tag, option.kind === 'auto' ? styles.tagAccent : null) }, tag),
        );
      }),
    ),
    // 手动输入 IPv4（候选探测不到时）
    customOpen
      ? h('div', { style: merge(styles.row, { marginTop: 8 }) },
          h('input', {
            type: 'text',
            value: customHost,
            placeholder: '例如 192.168.1.23',
            spellCheck: false,
            disabled: busy || running,
            onChange: (event) => setCustomHost(event.target.value),
            style: merge(styles.input, { width: 180, opacity: busy || running ? 0.5 : 1 }),
          }),
          h(Button, {
            onClick: () => {
              const value = customHost.trim();
              if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
                setActionError('请输入点分十进制的 IPv4 地址，例如 192.168.1.23');
                return;
              }
              if (saveConfig({ bindHost: value })) {
                setCustomHost('');
                setCustomOpen(false);
              }
            },
            disabled: busy || running || customHost.trim() === '',
          }, '使用此地址'),
          h(Button, { onClick: () => { setCustomOpen(false); setCustomHost(''); }, disabled: busy }, '取消'),
        )
      : h('div', { style: merge(styles.row, { marginTop: 6 }) },
          h('button', {
            type: 'button',
            onClick: () => setCustomOpen(true),
            disabled: running,
            title: running ? '服务运行中，停止后才能切换绑定地址' : '候选里没有想要的地址时手动填写',
            style: merge(styles.button, { minHeight: 24, fontSize: 11.5, opacity: running ? 0.4 : 1 }),
          }, '手动输入地址…'),
        ),
  );

  const portBlock = h('div', { style: merge(styles.row, { marginTop: 12 }) },
    h('div', { style: styles.caption }, '端口'),
    h('input', {
      type: 'number',
      min: 1,
      max: 65535,
      step: 1,
      inputMode: 'numeric',
      value: portText,
      disabled: busy,
      onChange: (event) => setPortText(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter') savePort();
      },
      style: styles.input,
    }),
    h(Button, {
      onClick: savePort,
      disabled: busy || Number(portText) === config.port,
      busy: busy === 'config',
      busyLabel: '保存中…',
    }, '保存'),
    h('label', { style: merge(styles.row, { gap: 6, marginLeft: 8, cursor: busy ? 'default' : 'pointer', fontSize: 12 }) },
      h('input', {
        type: 'checkbox',
        checked: autoStart,
        disabled: busy,
        onChange: toggleAutoStart,
        style: merge(styles.radio, { borderRadius: 2 }),
      }),
      h('span', { style: styles.secondary }, '打开页面时自动启动'),
    ),
    running && Number(portText) !== config.port ? h('span', { style: styles.caption }, '新端口在重启后生效') : null,
    saveNote ? h('span', { style: merge(styles.caption, { color: color.success }) }, saveNote) : null,
  );

  const logBlock = h('div', null,
    h('div', { style: merge(styles.cardHeader, { marginTop: 12 }) },
      h('button', {
        type: 'button',
        onClick: toggleLog,
        style: merge(styles.linkButton, { color: color.primary, fontSize: 13, fontWeight: 500 }),
      }, `${logOpen ? '▾' : '▸'} 运行日志`),
      logOpen
        ? h(Button, { onClick: () => loadLog(200), disabled: logLoading }, logLoading ? '读取中…' : '刷新')
        : null,
    ),
    logOpen
      ? h('div', null,
          logError ? h('div', { style: merge(styles.caption, { color: color.error }) }, logError) : null,
          h('pre', { style: styles.log },
            h('code', { style: styles.logText }, logText || (logLoading ? '读取中…' : '（暂无日志）'))),
        )
      : null,
  );

  const errorBlock = error
    ? h('div', { style: styles.errorBar, role: 'alert' },
        h('span', { style: styles.errorMessage }, error),
        h('button', {
          type: 'button',
          onClick: () => {
            setActionError('');
            setLoadError('');
            refresh();
          },
          style: merge(styles.linkButton, { color: color.error }),
        }, '关闭'),
      )
    : null;

  return h('div', { style: styles.root },
    errorBlock,
    h('div', { style: styles.card },
      header,
      infoGrid,
      actions,
      running ? null : warningsBlock,
      urlBlock,
    ),
    h('div', { style: styles.card },
      h('div', { style: styles.row },
        h('div', { style: styles.title }, '连接设置'),
        status === undefined
          ? h('span', { style: styles.caption }, '读取中…')
          : null,
      ),
      optionsBlock,
      h('div', { style: styles.divider }),
      portBlock,
      h('div', { style: styles.divider }),
      logBlock,
    ),
    h('div', { style: styles.footer },
      '绑定到本机以外的地址后，任何能访问该地址的人都拥有这套 DSH 的完整权限（读写文件、执行命令），请只在可信网络里开启。',
    ),
  );
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

const name = 'dsh-web-control';
const inject = ['slots'];

function apply(ctx) {
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'web-access',
    order: 65,
    label: () => 'Web 访问',
  }, Panel)), 'dsh-web-control: settings section');
}

module.exports = { name, inject, apply };
