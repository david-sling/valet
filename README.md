# Valet

A valet key for AI agents. Valet lets a vendor's AI agent run commands on someone else's machine, with that machine's owner deciding what is allowed.

- **Commands only.** No screen sharing, screen capture, or mouse and keyboard control.
- **The client's machine decides.** Each session starts from permissions the client reviews. Anything outside them waits for the client's approval, with Touch ID for high-risk actions.
- **Enforced in the OS sandbox**, never by parsing command text.
- **Temporary and attended.** Sessions last 60 minutes and only the client can extend them. Every action lands in a log both sides can see.

Live at [valet.davidsling.in](https://valet.davidsling.in).

## How it works

```
 Vendor's agent ──curl──►  Relay (web/, Vercel)  ◄──long-poll──  Client app (Tauri, client's Mac)
   reads skill.md          TanStack Start server routes           Rust core: grants, decide, sandbox,
   agent_token             Redis                                  Touch ID, audit log
```

1. The agent reads the skill file at `/agent/skill.md` and opens a session with `curl`. There is no MCP server or SDK.
2. The client joins with a one-time code or a `valet://join/…` link, reviews the proposed permissions, and starts the session.
3. The agent sends actions through the relay. The client app runs what's allowed in a sandbox, asks the person about the rest, and sends results back.

Both sides connect outward to the relay; the client opens no ports. The relay carries messages and never decides what is allowed.

## Repository

| Path | What it is |
|---|---|
| `web/` | Landing page, join page (`/j/{code}`), relay API (`/api/v1`) and the skill file. TanStack Start on Vercel |
| `app/` | The macOS client. Tauri v2: a Rust core for policy, sandbox and approvals, and a React webview |
| `packages/protocol/` | Shared schemas and types, with test vectors |
| `tools/` | `fake-agent.ts` and `fake-client.ts`, stand-ins for either side when testing the relay |

## Development

Requires Node 22, pnpm 10, and for the app, Rust stable and Xcode command line tools.

```bash
pnpm install
```

```bash
pnpm dev
```

runs the web app and relay on `http://localhost:3000`. The relay needs Redis and the variables in [ARCHITECTURE.md §12](ARCHITECTURE.md#12-deployment-and-configuration) in `web/.env`.

```bash
pnpm app
```

runs the desktop app. Set `VALET_RELAY=http://localhost:3000` to point it at a local relay instead of production.

```bash
pnpm --dir app exec vite --port 1430
```

serves the app's screens in a plain browser with a stand-in for the Rust core. Add `?update` or `?notes` to the URL to walk through an update or the What's new dialog.

To drive a session without a real agent or client:

```bash
node tools/fake-agent.ts http://localhost:3000
```

```bash
node tools/fake-client.ts http://localhost:3000 <code>
```

Checks:

```bash
pnpm typecheck && pnpm test
```

```bash
cargo test --manifest-path app/src-tauri/Cargo.toml
```

## Releasing the app

1. In one commit, bump `version` in `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`, and write the release notes in `app/release-notes/X.Y.Z.md`, drafted from the commits since the last `app-v*` tag. The release stops without them, and the app shows them on the first open after the update.
2. Tag that commit `app-vX.Y.Z` and push the tag. The release workflow builds, signs and notarises a draft release.
3. Check the draft, then publish it. Installed apps pick it up within 6 hours.

Details are in [ARCHITECTURE.md §12.1](ARCHITECTURE.md#121-client-releases).

## Documents

- [PRD.md](PRD.md): what Valet is and why
- [ARCHITECTURE.md](ARCHITECTURE.md): how the parts fit, the API, and security decisions
- [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md): product context and the design system
