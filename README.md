# dsh-web-control

Manage a LAN/Tailscale-reachable `dsh web` instance from inside DSH: pick the bind address, start, stop, restart, copy the token URL, read the log — from a settings page or from an agent tool call.

**中文文档（主文档）：[README.zh.md](README.zh.md)** · macOS setup: [docs/SETUP-MAC.zh.md](docs/SETUP-MAC.zh.md) (中文)

## The problem

`dsh web` listens on `127.0.0.1` only, so nothing but the local machine can reach it. Exposing it needs two things at once: bind a concrete non-loopback IP (LAN or Tailscale), and sign in through a token URL. Doing that by hand means shell scripts, IP lookups and hand-assembled flags. This plugin does it for you.

Under the hood it runs:

```sh
dsh web --no-open --port <PORT> --host <IP> --public-url http://<IP>:<PORT>/
```

It invokes the `dsh` executable itself, not `node <cli.js>`: the `dsh` wrapper handles `ELECTRON_RUN_AS_NODE` and the asar-internal paths.

and parses the ready line out of the log:

```
dsh web: http://<IP>:<PORT>/?token=<TOKEN>
```

## Install

```sh
dsh plugin --profile desktop add file:~//Downloads/dsh-web-control/build/dsh-web-control.tgz
```

Then quit and reopen DSH. macOS walkthrough: [docs/SETUP-MAC.zh.md](docs/SETUP-MAC.zh.md).

## Tailscale vs LAN

| | Tailscale | LAN |
| --- | --- | --- |
| Reach | Any network with internet | Same WiFi / router |
| Encryption | WireGuard end-to-end; plain HTTP stays inside the tunnel | Plain HTTP, sniffable on the same subnet |
| Requires | Tailscale installed and logged in on both ends | Nothing |
| Good for | Reaching your Mac from a phone while away | At home / in the office |

## Using it

**Settings → Web 访问**: pick an address (Tailscale `100.64.0.10` / LAN `192.168.1.100` / loopback), set the port (default `3080`), hit **启动**, then copy the URL to your phone.

**Agent tools:**

- `dsh_web_control` — `{ action: 'status'|'start'|'stop'|'restart'|'url', host?, port? }` → `{ running, url, bindHost, port, message }`
- `dsh_web_config` — `{ bindHost?, port?, autoStart? }` (no args = read) → `{ config, candidates }`

## Settings and state

Config: `~/.dsh-web-control/config.json` — `bindHost` (`null` = auto-detect: Tailscale, then LAN, then loopback), `port` (default `3080`), `autoStart` (default `false`).

State files in `~/.dsh-web-control/`: `instance.json` (pid / url / bindHost / port / startedAt), `dshweb.log` (child stdout+stderr), `url.txt` (current full URL, mode `600`).

## Notes worth knowing

- **`0.0.0.0` is rejected.** `--host` must be a concrete IPv4 literal. Pick the IP you actually want to serve on.
- **No `--trusted-host` needed.** dsh's Host fence automatically trusts the address the listener is bound to.
- **`listening on <IP> over plain HTTP; restrict this port...` is a notice, not an error.** It tells you HTTP is unencrypted on that interface. Over Tailscale it is encrypted by WireGuard; on a LAN it is not.
- **The token rotates on every start and is single-use.** The first browser exchange turns it into a cookie and the address bar cleans up. Old links stop working after a restart.

## Security

Once bound to a non-loopback address, **anyone who can reach that address and has the token or cookie has your machine's dsh privileges**: file access, command execution, every tool. Use it only on networks you trust, never in LAN mode on public WiFi, stop it when you are done, and treat the token URL as a credential.

## Build from source

```sh
cd ~/Downloads/dsh-web-control/host && npm install
cd ~/Downloads/dsh-web-control && node tools/build.mjs
node tools/pack-bundle.mjs
dsh plugin --profile desktop add file:$PWD/build/dsh-web-control.tgz
```

Node 24, ESM, zero runtime dependencies on the host side. API contract: [CONTRACT.md](CONTRACT.md).

MIT
