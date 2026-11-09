# dsh-web-control：在 macOS 上从零到可用

面向 Apple 芯片的 Mac，从装插件到手机打开页面为止。主文档见 [README.zh.md](../README.zh.md)。

本文默认你的网络环境是：

- Mac 上装了 [Tailscale](https://tailscale.com/) 并已登录（跨网络访问要它，只在家里用可以跳过）；
- 局域网 IP `192.168.1.100`，Tailscale IP `100.64.0.10`，端口 `3080`。

实际值不一样没关系，把命令里的数字换成你自己的即可。

## 0. 先确认 dsh 能跑

装过 DSH Desktop 并打开过一次之后：

```sh
dsh --version
```

如果提示 `command not found`，用 App 自带的路径，下面所有 `dsh` 命令都换成它：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" --version
```

后面为了好读统一写 `dsh`，你用哪个都行。

> **注意：不要 `sudo`。** 插件和它拉起的 dsh web 都以你自己的用户身份运行，绑 `3080` 这种高位端口也不需要 root。

## 1. 装插件

拿到构建好的 `.tgz`。如果是从源码构建的，先构建：

```sh
git clone https://github.com/weichengwu/dsh-web-control
cd dsh-web-control
npm install --prefix host
npm run build
npm run pack
```

产物在 `build/dsh-web-control.tgz`。安装：

```sh
dsh plugin --profile desktop add file:$PWD/build/dsh-web-control.tgz
```

也可以直接从 GitHub 装，跳过构建：

```sh
dsh plugin --profile desktop add github:weichengwu/dsh-web-control
```

装完**重启 DSH**：完全退出 App（`Cmd+Q`），再重新打开。已经在运行的那个 DSH 不会自动加载新插件。

## 2. 确认插件加载了

重新打开 DSH，进入 **设置**。左侧应该多出一项 **Web 访问**。

没有这一项的话，看 DSH 的日志有没有插件加载失败的报错；也可以确认一下包是否真的进了 profile：

```sh
ls ~/.dsh/profiles/desktop/node_modules/ | grep dsh-web-control
```

## 3. 查一下本机有哪些地址

选绑定地址之前，先确认你要用的那个 IP 是真的存在：

```sh
# Tailscale 地址
/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4

# 局域网地址
ipconfig getifaddr en0
```

预期输出：

```
100.64.0.10
192.168.1.100
```

- Tailscale 那条没输出，说明 Tailscale 没登录或没在运行，先处理它。
- `en0` 是 Wi-Fi 的主网卡。插网线的话可能是 `en1`，用 `ifconfig` 找当前活跃的那个：

  ```sh
  ifconfig | grep -E "^[a-z]|inet "
  ```

- 地址可能是空的：Mac 换了网络（比如从家里到公司）之后 IP 会变，重新查一次。

插件自己也会探测，探测逻辑是：Tailscale IP 优先取环境变量 `DSH_WEB_TAILSCALE_IP`，其次调 Tailscale CLI，再从网卡里找 `100.64.0.0/10` 段地址；局域网 IP 取 `en0`，回退到 `192.168` / `10` / `172.16` 私网段。所以面板里的候选列表一般已经是对的了。

## 4. 启动

1. 打开 **设置 → Web 访问**。
2. 地址候选里选 **Tailscale**（`100.64.0.10`，要出门访问就选它）或 **局域网**（`192.168.1.100`，同一个 WiFi 下就够）。
3. 端口保持 `3080`，除非它被占了（见第 7 步）。
4. 点 **启动**。等几秒，状态变成运行中。
5. 面板会显示完整地址，点 **复制**：

   ```
   http://100.64.0.10:3080/?token=<TOKEN>
   ```

**不要手动改这个地址。** 缺了 `?token=` 就打不开，token 是每次启动重新生成的一次性的。

想先在本机验证的话，点 **打开**，或者自己贴进浏览器——用 token URL 打开后会换 cookie 并重定向，地址栏变成干净的 `http://100.64.0.10:3080/`。这说明一切正常。

## 5. 手机上打开

**走 Tailscale：**

1. 手机装 Tailscale App，登录**同一个**账号（tailnet）。
2. 确认状态是 Connected。
3. 用手机浏览器打开刚才复制的完整 URL。

**走局域网：**

1. 手机连**同一个** WiFi（同一个路由器，不是访客网络——访客网络通常隔离客户端）。
2. 用手机浏览器打开刚才复制的完整 URL。

每台新设备都要用一次当前 token URL。手机上收藏重开需要用新的，因为重启后 token 变了。

## 6. 停下

不用了就点 **停止**。绑在非 loopback 地址上的 dsh web 是一个远程控制面板级别的暴露面，没必要 24 小时开着。

重启 DSH 或重启 Mac 之后，插件不会自动拉起实例（除非开了 `autoStart`）。回来用的时候再点一次 **启动**。

## 7. 出问题时

### 启动失败

先看面板的日志区，或直接看日志文件：

```sh
tail -n 80 ~/.dsh-web-control/dshweb.log
```

对照常见原因：

| 日志里看到 | 原因 | 处理 |
| --- | --- | --- |
| `EADDRINUSE` / 端口相关报错 | 端口被占 | 见下方「端口被占用」 |
| 地址相关报错，`--host` 无效 | 填了 `0.0.0.0` 或不对的地址 | 换成具体的本机 IP，见第 3 步 |
| 一直没出现就绪行，最后超时 | 子进程起不来或卡住 | 看日志尾部，通常是 DNS、权限或地址不存在 |

### 端口被占用

```sh
lsof -nP -iTCP:3080 -sTCP:LISTEN
```

- 占用的是残留的 dsh web：面板点 **停止** 再 **启动**。
- 占用的是别的程序：面板里把端口改成 `3081`，保存后重新启动。

### 手机连不上

按这个顺序查，每一步都能排掉一类问题：

1. **Tailscale 在线？** 两端都登录同一 tailnet，且状态 Connected。用局域网模式则跳过。
2. **IP 通不通？** 手机浏览器直接打开 `http://100.64.0.10:3080/`。看到登录 / 未授权页面就说明网络通了，问题在 token；转圈或超时说明网络层就不通。
3. **端口在监听？** 在 Mac 上跑：

   ```sh
   lsof -nP -iTCP:3080 -sTCP:LISTEN
   ```

   没输出 = 服务没起。回面板看状态。

4. **代理软件在拦？** Clash、Surge、Quantumult 这类工具会接管手机流量。在规则里把这些配成**直连**：

   - `*.ts.net`
   - `100.64.0.0/10`（Tailscale 的 CGNAT 网段）
   - 局域网模式下另加 `192.168.0.0/16`、`10.0.0.0/8`、`172.16.0.0/12`

   这一步是 Tailscale 场景下最常见的坑：手机明明在 tailnet 里，流量却全被代理规则送走了。

5. **macOS 防火墙？** 系统设置 → 网络 → 防火墙。开着的话确认 `node` 进程允许接受传入连接。之前点过「拒绝」的，去「选项」里改回来。

另外别忘了确认你用的是**这次启动**的 token URL——用上次的链接会显示鉴权失败，看起来很像连不上。

### 那条 plain HTTP 警告

日志里这行是老朋友，正常现象：

```
dsh web: listening on 100.64.0.10 over plain HTTP; restrict this port to a trusted proxy or network
```

dsh 在提醒你正在用明文 HTTP 对外监听。走 Tailscale 时这层明文包在 WireGuard 隧道里；走局域网时要自己判断可信度。功能上不受影响，忽略它。

## 8. 安全提醒

绑定到非 loopback 地址后，**任何能连到该地址并拿到 token / cookie 的人，就拥有你整台机器上 dsh 的权限**——能读写文件、执行命令、调用所有工具。

- 公共 WiFi（酒店、咖啡馆、机场）下不要用局域网模式。
- 不需要远程访问时点 **停止**。
- token URL 当凭证对待，别外传。
- 个人 tailnet 里的其他设备同样在你的边界之内。

## 9. 卸载

```sh
dsh plugin --profile desktop remove dsh-web-control
```

然后完全退出并重新打开 DSH。插件在 `~/.dsh-web-control/` 留下的配置和日志不会自动删除，需要的话自己清：

```sh
rm -rf ~/.dsh-web-control
```

如果当时实例还在运行，删除前先在面板里 **停止**，或手动结束那个 PID（PID 在 `~/.dsh-web-control/instance.json` 里）。
