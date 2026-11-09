# dsh-web-control — 接口契约（所有队友必须遵守）

插件名：`dsh-web-control`
包名：`dsh-web-control`
目标 profile：`desktop`（同时也支持 `web` profile）

## 插件干什么

让用户从 DSH 里直接管理一个「可被局域网 / Tailscale 访问的 dsh web 实例」：

- 选择绑定地址（自动探测 Tailscale IP / 局域网 IP / loopback）
- 启动 / 停止 / 重启 / 查看状态
- 拿到带 token 的完整访问地址
- 查看日志、切换端口
- 暴露成 DSH 工具给智能体调用
- 提供「设置 → Web 访问」页面的客户端 UI

## 关键机制（来自参考会话，已验证）

启动命令（macOS）：

```
node <dsh>/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js \
  web --no-open --port <PORT> --host <IP> --public-url http://<IP>:<PORT>/
```

- `--host` 必须是**具体 IPv4 字面量**，不能是 `0.0.0.0`（dsh 拒绝通配地址）。
- dsh 的 Host 栅栏**自动接受监听器绑定 IP**，因此**不需要** `--trusted-host`。
- 非 loopback + 非 TLS 时，dsh 会打印一行警告，**这不是错误**：
  `dsh web: listening on <IP> over plain HTTP; restrict this port to a trusted proxy or network`
- 成功后就绪，日志里会出现（这是唯一可用来解析的就绪行）：
  `dsh web: http://<IP>:<PORT>/?token=<TOKEN>`
- 解析 URL 时必须匹配以 `http` 开头的行，不能只匹配 `dsh web:`（否则会匹配到上面的警告行）。

Tailscale IP 探测（按优先级）：
1. `DSH_WEB_TAILSCALE_IP` 环境变量
2. `/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4`（取第一行）
3. 网卡里 `100.64.0.0/10` 段地址（CGNAT）

局域网 IP 探测：`en0` 的 `ipconfig getifaddr en0`，回退到 192.168/10/172.16 私网段。

## 状态目录

`~/.dsh-web-control/`
- `config.json`   — 持久化配置（用户改的设置）
- `instance.json` — 运行实例状态（pid / url / startedAt / bindHost / port）
- `dshweb.log`    — 子进程 stdout+stderr
- `url.txt`       — 当前完整 URL（权限 600）

## HTTP 路由契约（host/src/admin.ts 提供）

所有路由挂在 `/api/dsh-web-control` 下，返回 JSON。

| 方法 | 路径 | 请求体 | 响应 |
|---|---|---|---|
| GET  | `/status` | — | `StatusResponse` |
| POST | `/start`  | `{ }` 可选覆盖 | `StatusResponse` |
| POST | `/stop`   | `{ }` | `StatusResponse` |
| POST | `/restart`| `{ }` | `StatusResponse` |
| GET  | `/log?lines=N` | — | `{ log: string }` |
| GET  | `/config` | — | `ConfigResponse` |
| POST | `/config` | `Partial<Config>` | `ConfigResponse` |
| GET  | `/candidates` | — | `{ candidates: Candidate[] }` |

错误响应统一：`{ error: { code: string, message: string } }`，HTTP 状态码 400/409/500/503。

### 类型（以 host/src/types.ts 为准）

```ts
export interface Config {
  bindHost: string | null;   // null = 自动探测
  port: number;              // 默认 3080
  autoStart: boolean;        // 首次访问插件时是否自动拉起
}
export interface InstanceState {
  pid: number | null;
  running: boolean;
  url: string | null;        // 完整带 token 的 URL
  bindHost: string | null;
  port: number | null;
  startedAt: number | null;  // epoch ms
  logFile: string;
}
export interface Candidate { label: string; host: string; kind: 'tailscale' | 'lan' | 'loopback' }
export interface StatusResponse extends InstanceState {
  candidates: Candidate[];
  effectiveHost: string | null;
  config: Config;
  warnings: string[];
}
```

## 工具契约（host/src/tools.ts 提供）

注册两个工具到 `ctx.tools.register`：

**`dsh_web_control`** — 管理服务
参数：`{ action: 'status'|'start'|'stop'|'restart'|'url', host?: string, port?: number }`
返回 `{ running, url, bindHost, port, message }`

**`dsh_web_config`** — 读写持久化配置
参数：`{ bindHost?: string, port?: number, autoStart?: boolean }`（不传 = 读取）
返回 `{ config, candidates }`

## 客户端 UI 契约（client/index.js 提供）

- 模块 id：`dsh-web-control`
- 注入 `settings.section` 槽，注册 `{ name:'settings.section', id:'web-access', order:65, label: () => 'Web 访问' }`
- 用 `fetch('/api/dsh-web-control/...')` 调上面的路由
- React 来自 `require('react')`（冻结平台表），**不要**打包 react
- 样式用 DSH 的 CSS 变量（`--dsw-alias-*`），字体继承
- 功能：状态卡片、启动/停止/重启按钮、地址候选选择、端口输入、完整 URL 展示+复制、日志查看

## 文件分工（写作用域，禁止越界）

- `host/src/types.ts`、`host/src/config.ts`、`host/src/process.ts`、`host/src/discover.ts`、`host/src/admin.ts`、`host/src/tools.ts`、`host/src/plugin.ts` → **host-dev**
- `client/index.js` → **ui-dev**
- `README.md`、`README.zh.md`、`docs/**` → **docs-dev**
- `package.json`、`cordis.patch.yml`、`tools/build.mjs`、`tools/pack-bundle.mjs`、`tsconfig.json`、`test/**` → **lead**

## 构建

```bash
cd ~/Downloads/dsh-web-control/host && npm install   # 或复用 dsh-anywhere 的 node_modules
cd ~/Downloads/dsh-web-control && node tools/build.mjs
node tools/pack-bundle.mjs
dsh plugin --profile desktop add ./build/dsh-web-control.tgz
```

Node 24，ESM，`type: module`。必须能在 DSH 打包的 Electron Node 里跑（不要用实验性 API）。

## 打包硬性要求（实测踩过的坑，务必遵守）

1. **package.json 必须声明 `dsh.bundle.patch`**，否则 DSH 组合 profile 时会跳过并报
   `declares no dsh.bundle in its package.json`：

   ```json
   "dsh": { "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": [] } }
   ```

2. **host 端必须打成单文件**。DSH 按路径从 profile 的 `node_modules` 导入 `dist/plugin.js`，
   而包的 `exports` 只暴露 `./dist/plugin.js`，同目录的其它模块（config.js 等）不会被 pnpm
   安装，会报 `ERR_MODULE_NOT_FOUND`。所以 `tools/build.mjs` 用 esbuild 把 host 合并成
   `dist/plugin.bundle.js` 后再作为 `dist/plugin.js` 打包。

3. **工具参数的 JSON Schema 不支持 `type` 数组**。DSH 报
   `type arrays are not supported`；用单一 type + 额外布尔字段表达「可选/null」语义。

4. **`dsh plugin add` 后不会自动把包加进 `dsh.profile.bundles`**，需要手动追加到
   `~/.dsh/profiles/<profile>/package.json` 的 bundles 数组。

5. `desktop` profile 由 Electron 应用独占，`dsh --profile desktop --dump-config` 会被拒绝；
   验证组合用 `web` profile，或直接在 GUI 里重启后看设置页。
