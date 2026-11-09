# dsh-web-control

在 DSH 里管理一个「局域网 / Tailscale 可访问的 dsh web 实例」的插件。

选绑定地址、启动、停止、重启、拿到带 token 的访问地址、看日志——这些原本要手写 shell 脚本、手动查 IP、手动拼参数的事，现在在 DSH 设置页点几下就能做，也可以让智能体通过工具调用完成。

[English](README.md)

---

## 它解决什么问题

`dsh web` 默认只监听 `127.0.0.1`，所以只有本机能打开 `http://127.0.0.1:<port>/`。手机、平板、另一台电脑打不开。

要跨设备访问，必须同时满足两件事：

1. **绑定一个具体的非 loopback IP** —— 局域网 IP（如 `192.168.1.100`）或 Tailscale IP（如 `100.64.0.10`）。
2. **用带 token 的 URL 登录** —— 就绪后日志里那一行 `dsh web: http://<IP>:<PORT>/?token=<TOKEN>`。

这个插件把这两步封装好：自动探测本机可用的地址，用正确的参数拉起子进程，从日志里解析出带 token 的地址，并且能停止、重启、查看状态和日志。

它不改变 dsh 的鉴权模型，也不代理流量——只是把「手动起一个可从外部访问的 dsh web」这件事变成 DSH 内的一个操作。

## 安装

需要一个已经构建好的插件包（`.tgz`）。假设它在 `~/Downloads/dsh-web-control/build/dsh-web-control.tgz`：

```sh
dsh plugin --profile desktop add file:~//Downloads/dsh-web-control/build/dsh-web-control.tgz
```

> **路径必须带上，建议用 `file:` 加绝对路径。** 只写包名 `dsh-web-control` 会让 pnpm 把它当成 npm 上的包去下载，报
> `ERR_PNPM_FETCH_404 GET https://registry.npmjs.org/dsh-web-control.tgz: Not Found`。这个包没有发布到 npm，只能从本地 `.tgz` 装。

`PATH` 里没有 `dsh` 时，用 App 自带的那一个：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add file:~//Downloads/dsh-web-control/build/dsh-web-control.tgz
```

装完**重启 DSH**。重启后在 **设置 → Web 访问** 能看到面板。

### 如果命令以 exit 1 结束

`pnpm` 可能因为**其它插件**的构建脚本被忽略而返回非零退出码：

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@…, cpu-features@…, ssh2@…
```

这跟本插件无关（它没有任何依赖、也没有构建脚本）。判断是否装成功，看这三处：

```sh
# 1. 依赖写进了 profile
grep dsh-web-control ~/.dsh/profiles/desktop/package.json
# 2. 文件真的落地了
ls ~/.dsh/profiles/desktop/node_modules/dsh-web-control/dist/
# 3. 在 bundles 列表里（没在就手动加）
grep -A15 '"bundles"' ~/.dsh/profiles/desktop/package.json
```

`dsh plugin add` 不会自动把包加进 `dsh.profile.bundles`，需要手动追加 `"dsh-web-control"`。三项都对，重启 DSH 即可。

卸载：

```sh
dsh plugin --profile desktop remove dsh-web-control
```

macOS 上从零到可用的完整步骤见 [docs/SETUP-MAC.zh.md](docs/SETUP-MAC.zh.md)。

## 怎么选访问方式

绑定地址决定了谁能连上。两种常见选择：

| | Tailscale | 局域网 |
| --- | --- | --- |
| 覆盖范围 | 任何网络，只要有网 | 同一个 WiFi / 路由器 |
| 加密 | WireGuard 端到端加密，HTTP 明文只在隧道内 | 明文 HTTP，同网段可嗅探 |
| 前置条件 | 两端都装并登录 Tailscale | 无 |
| 适合 | 出门在外用手机访问家里 Mac | 在家 / 办公室 |

简单说：**要跨网络就选 Tailscale，只在同一 WiFi 下用就选局域网**。两者对插件来说是同一个操作，只是绑的 IP 不同。

## 使用

1. 打开 DSH，进入 **设置 → Web 访问**。
2. 在地址候选里选一个：**Tailscale**（`100.64.0.10`）、**局域网**（`192.168.1.100`）或 **本机**（`127.0.0.1`）。
3. 需要的话改端口，默认 `3080`。
4. 点 **启动**。等服务就绪，面板上会显示完整访问地址。
5. 点 **复制**，把地址发到手机上打开；或点 **打开** 在本机验证。地址形如：

   ```
   http://100.64.0.10:3080/?token=<TOKEN>
   ```

6. 用完点 **停止**。

面板上还有 **重启**、运行时长、PID、绑定地址，以及一个可展开的日志区（最近 80 行）。

## 智能体工具

插件注册两个工具，智能体可以直接调用，不用你开设置页。

### `dsh_web_control`

管理服务的生命周期。

```jsonc
{
  "action": "status",   // "status" | "start" | "stop" | "restart" | "url"
  "host": "100.64.0.10", // 可选，覆盖绑定地址
  "port": 3080            // 可选，覆盖端口
}
```

返回：

```jsonc
{
  "running": true,
  "url": "http://100.64.0.10:3080/?token=<TOKEN>",
  "bindHost": "100.64.0.10",
  "port": 3080,
  "message": "started"
}
```

`action: "url"` 用来只要地址不要其他信息，适合「把访问地址给我」这类请求。

### `dsh_web_config`

读写持久化配置。三个参数都可省略；**全都不传就是读取**。

```jsonc
{
  "bindHost": "192.168.1.100", // 可选
  "port": 3080,                  // 可选
  "autoStart": false             // 可选
}
```

返回：

```jsonc
{
  "config": { "bindHost": "192.168.1.100", "port": 3080, "autoStart": false },
  "candidates": [
    { "label": "Tailscale", "host": "100.64.0.10",   "kind": "tailscale" },
    { "label": "局域网",     "host": "192.168.1.100", "kind": "lan" },
    { "label": "本机",       "host": "127.0.0.1",      "kind": "loopback" }
  ]
}
```

一个典型用法，贴给智能体：

> 把 dsh web 绑到 Tailscale 地址、端口 3080 启动，然后把访问地址给我。

## 设置项

配置文件：`~/.dsh-web-control/config.json`

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `bindHost` | `string \| null` | `null` | 绑定地址。`null` 表示**自动探测**：优先 Tailscale，其次局域网，最后 loopback |
| `port` | `number` | `3080` | 监听端口，合法范围 1–65535 |
| `autoStart` | `boolean` | `false` | 首次打开插件时是否自动拉起实例 |

`bindHost` 必须是具体的 IPv4 字面量，比如 `192.168.1.100`。`0.0.0.0` 之类的通配地址会被拒绝，原因见[常见问题](#为什么不能绑-0000)。

## 状态目录

`~/.dsh-web-control/`

| 文件 | 内容 |
| --- | --- |
| `config.json` | 持久化配置，即上面那些设置项 |
| `instance.json` | 当前运行实例：`pid` / `url` / `bindHost` / `port` / `startedAt` |
| `dshweb.log` | 子进程的 stdout + stderr。启动失败时先看这里 |
| `url.txt` | 当前完整访问地址，权限 `600` |

## 底层命令行

插件内部执行的就是这条命令，理解它有助于排查问题：

```sh
dsh web --no-open --port <PORT> --host <IP> --public-url http://<IP>:<PORT>/
```

插件调的是 `dsh` 可执行文件本身，而不是 `node <cli.js>` —— `dsh` 这个包装脚本会自己处理 `ELECTRON_RUN_AS_NODE` 和 asar 内的路径，直接 node 跑 cli.js 是跑不起来的。

- `--no-open` 不在本机自动打开浏览器。
- `--host` 是具体 IP 字面量。
- `--public-url` 让 dsh 生成对外地址时用这个基地址，而不是 `127.0.0.1`。

绑定非 loopback 地址时，启动日志里会出现：

```
dsh web: listening on 100.64.0.10 over plain HTTP; restrict this port to a trusted proxy or network
```

**这是一条正常的提示，不是错误。** dsh 在告诉你：它现在用明文 HTTP 对外监听，请确保这个端口处在你信任的网络上。

就绪后会打印：

```
dsh web: http://100.64.0.10:3080/?token=<TOKEN>
```

## 常见问题

### 为什么不能绑 `0.0.0.0`？

`0.0.0.0` 是通配地址，意思是「本机所有网卡」。dsh **拒绝**通配地址，`--host` 必须是具体的 IPv4 字面量。

这是最常见的困惑点。原因不难理解：绑 `0.0.0.0` 意味着同时暴露在 Tailscale、局域网、以及任何临时网络接口上，而 dsh 的 Host 栅栏和访问地址需要知道确切的那个地址来生成校验。选具体 IP 等于明确表态「我只在哪个网络上提供服务」。

所以：直接填 `0.0.0.0` 会启动失败，改填 `192.168.1.100` 或 `100.64.0.10` 就对了。

### 为什么不需要 `--trusted-host`？

dsh 的 Host 栅栏会自动信任**监听器绑定的那个 IP**。既然 `--host` 已经选定了地址，通过这个地址进来的请求就能通过栅栏校验，不需要再额外加 `--trusted-host`。

实测行为，用 `curl` 可以自己验证：

```sh
# 用绑定 IP 当 Host 头 —— 通过栅栏，但未带凭证，返回 401
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: 100.64.0.10:3080' http://100.64.0.10:3080/api/

# 用不认识的 Host 头 —— 被栅栏拦下，返回 403
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example:3080' http://100.64.0.10:3080/api/
```

`401` 表示网络和 Host 校验都过了、只差登录；`403` 表示 Host 头不在信任列表里，请求在鉴权之前就被拒了。所以看到 403 时先查 Host 头，看到 401 时才是 token / cookie 的问题。

**注意判断的是 `/api/`，不是首页。** Host 栅栏只拦 `/api/` 这类接口路径；根路径 `/` 无论 Host 头是什么都返回 401，因为那只是登录页，还没走到 API 鉴权。三条路径实测如下：

| 路径 | 外来 Host 头 | 绑定 IP |
| --- | --- | --- |
| `/` | 401 | 401 |
| `/api/` | 403 | 401 |
| `/api/status` | 403 | 401 |

所以别拿首页的状态码判断「Host 校验过没过」——首页永远给你 401，看起来像是「只差 token」，实际上可能根本没通过栅栏。

只有当你把服务放在反向代理后面、外部访问用的域名 / 地址和绑定地址不一致时，才需要另外处理信任列表——这个插件不做代理，所以用不上。

### 那条 `over plain HTTP` 警告是什么？

见[底层命令行](#底层命令行)：绑定非 loopback 地址时 dsh 提示「正在用明文 HTTP 对外监听」，**不是错误**。

它提醒你的是网络边界问题：HTTP 本身不加密。如果你走 Tailscale，这层明文被包在 WireGuard 隧道里，出了隧道是密文；如果你走局域网，就是实实在在的明文，同一网段的人可以嗅探。这条提示不影响功能，忽略即可。

### 为什么 token 每次都变？为什么只能用一次？

token 是每次启动新生成的，所以重启之后旧的 URL 立刻失效——这是好事，重启等于轮换凭证。

token 一次性：浏览器第一次用它打开时，dsh 把它换成 cookie 并重定向，地址栏会变成干净的 `http://100.64.0.10:3080/`。之后同一个浏览器靠 cookie 访问，不需要再带 token。

实际影响：

- 每台新设备都要用**当前这次启动**的 token URL 打开一次。
- 手机上收藏的带 token 的地址，在重启后会失效，需要重新复制。
- 把 URL 发到聊天软件里，等于把凭证交出去；换 cookie 后那条链接就没用了，但这也意味着别人比你早打开就没你的份。

当前地址随时可以从面板上复制，或读 `~/.dsh-web-control/url.txt`。

### 端口被占用怎么办？

启动失败时先看日志：

```sh
tail -n 80 ~/.dsh-web-control/dshweb.log
```

然后确认端口占用者：

```sh
lsof -nP -iTCP:3080 -sTCP:LISTEN
```

两种情况：

- 占用者是**上次没清干净的 dsh web**：在面板上点一次 **停止** 再 **启动**；或手动结束那个 PID。
- 占用者是**别的程序**：在面板里把端口改成 `3081`（或任意空闲端口）保存后重新启动。

### 手机连不上，按什么顺序排查？

按这个顺序，每一步都能排除一类问题：

1. **Tailscale 是否在线？** 手机和 Mac 两端都要登录同一个 tailnet，状态显示 Connected。点局域网模式就不用看这一步。
2. **IP 能不能通？** 在手机上 ping 那个地址，或在手机浏览器打开 `http://100.64.0.10:3080/`（不带 token，报未授权也算通了，说明网络层没问题）。不通就是组网问题，还没到 dsh 这层。
3. **端口是否在监听？** 在 Mac 上：

   ```sh
   lsof -nP -iTCP:3080 -sTCP:LISTEN
   ```

   没有输出说明服务没起来，回面板看状态和日志。

4. **代理软件是否拦截？** Clash、Surge 这类工具会接管流量，把 Tailscale 地址也送进代理规则。需要在规则里把 `*.ts.net` 和 `100.64.0.0/10`（Tailscale 的 CGNAT 网段）配置成**直连**，否则手机明明在 tailnet 里也连不上。局域网模式下同样要把 `192.168.0.0/16` 之类的私网段放直连。
5. **macOS 防火墙。** 系统设置 → 网络 → 防火墙。如果开着，确认对应的 `node` 进程被允许接受传入连接；被拦时系统通常会弹窗询问，点过「拒绝」的话要去「选项」里改回来。

补充：确认你用的是**这次启动**的 token URL。用旧链接会看到一个鉴权失败的页面，看起来像「连不上」，其实是 token 过期了。

### 组网和加密是一回事吗？

不是，这两件事分开看：

- **组网**（Tailscale / 局域网）解决的是「能不能连上」。
- **加密**（WireGuard / HTTPS）解决的是「路上的内容别人看不看得见」。

Tailscale 已经在传输层做了 WireGuard 端到端加密，所以走 Tailscale 时那个明文 HTTP 只在隧道内部是明文，出了隧道是 WireGuard 密文。**不必因为看到 `over plain HTTP` 就以为自己在裸奔**——那个警告针对的是不经过隧道的场景。

但边界要说清楚：

- Tailscale 加密的是**传输**，不是**鉴权**。能连到那个 IP 的人（包括你 tailnet 里被共享过的其他设备、其他节点上的用户）依然需要 token 或 cookie 才能进 dsh。
- 局域网模式**没有**这层加密。同一 WiFi 下有能力嗅探的人可以看到 URL 和 token 明文，进而获得访问权。用公共 WiFi 时不要选局域网模式。
- Tailscale 的加密前提是两端都是你信任的节点。如果 tailnet 里有别人的设备，那人就在你的网络边界之内。

### 安全边界到底在哪？

这是全文最需要读清楚的一段。

绑定到非 loopback 地址之后，**任何能连到那个地址、并且拿到 token 或 cookie 的人，就拥有你整台机器上 dsh 的权限**：能读写文件、执行命令、调用所有工具。这不是「只是个网页界面」，这是一个带 shell 的远程控制面板。

所以：

- 只在自己信任的网络里开。个人 tailnet、自己家的 WiFi 属于可信；酒店、咖啡馆、机场的公共 WiFi 不属于。
- 公共 WiFi 下一律不要用局域网模式。要用就切到 Tailscale。
- **用完就停。** 不需要远程访问的时候点 **停止**，而不是让它常驻。绑定的端口没有人访问也不产生价值，只会增加暴露面。
- token URL 当凭证对待。不要发到公开群组、不要贴进工单或截图。
- 定期看一眼 `~/.dsh-web-control/dshweb.log` 和面板状态，确认没有你不认识的启动记录。

## 开发

```sh
git clone https://github.com/weichengwu/dsh-web-control
cd dsh-web-control

# TypeScript 编译到 build/host，esbuild 再把 host 打成一个 dist/plugin.js
npm run build
npm test                       # 16 项单元测试

# 打成本地安装包并装入 DSH
npm run pack
dsh plugin --profile desktop add file:$PWD/build/dsh-web-control.tgz
```

产物说明：`dist/` 里**只有两个文件**——`plugin.js`（host 端，单文件）和 `client.js`（浏览器端）。
DSH 按路径从 profile 的 `node_modules` 导入这两个文件，所以多文件产物会导致
`ERR_MODULE_NOT_FOUND`；中间模块都在 `build/host/`。

- Node 24，ESM，`type: module`。
- host 端只用 Node 标准库，**零第三方运行时依赖**。
- 客户端 UI 从 `require('react')` 拿 React，不打包进 bundle。
- 接口契约见 [CONTRACT.md](CONTRACT.md)，打包踩过的坑在文末。

> `tools/pack-bundle.mjs` 产出的 `build/dsh-web-control.tgz` 与 GitHub Release 上附的
> 预构建包是同一个东西，可以直接拿来装。

## 已知限制

- 绑定地址必须是具体的 IPv4 字面量。`0.0.0.0` 会被 dsh 拒绝；IPv6 和主机名不在支持范围内。
- 不代理流量、不做 TLS。需要 HTTPS 或反向代理请自己在前面挂一层。
- 同一时间只管理一个 dsh web 子进程。

## 许可

MIT
