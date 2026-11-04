# Valet: Product Requirements Document

**Product:** Valet (`valet.davidsling.in`)
**Tagline:** A valet key for AI agents.
**Status:** Draft v0.1
**Last updated:** 2026-11-04

---

## 1. Summary

Valet lets an AI agent run commands on another person's machine, with that machine's owner deciding what is allowed.

The client installs the Valet desktop app. An agent, such as a software vendor's support agent, connects to it for one session. The session starts with a set of permissions the client reviews and can change: none, all, or a template. Whenever the agent tries something outside those permissions, the client sees an approval prompt on their own machine. Valet enforces every rule on the client machine, inside an OS sandbox, and records every action in a signed log that both sides can see.

Valet is **commands only**. It has no screen sharing, screen capture or mouse and keyboard control.

## 2. Terminology

| Term | Meaning |
|---|---|
| **Agent** | The side that does the controlling: an AI agent, usually run by a software vendor. |
| **Client** | The side being controlled: the machine, and the person who owns it. |
| **Session** | One temporary connection between an agent and a client. All permissions belong to a session and end with it. |
| **Grant** | One permission within a session, for example "read `~/Library/Logs/AcmeApp/**`". |
| **Action** | One request from the agent, for example running a command or reading a file. |
| **Template** | A permission set the vendor suggests ahead of time, which the client can accept, edit or reject. |

## 3. Problem

- AI agents work well when they can see the real environment, but the environments where problems happen (customer laptops, on-site servers) are not ones the agent can reach.
- The existing ways to reach a remote machine don't fit AI agents:
  - **Remote desktop tools** (TeamViewer, AnyDesk) are built for a human watching a screen. They have no per-action consent, and an AI agent working through pixels is slow, costly and hard to audit.
  - **SSH and privileged-access tools** give an account's full rights once someone logs in, need open ports and key management, and have no per-action approval by the machine's owner.
  - **IT management "run a script" features** serve a company's IT team managing its own devices, not an outside vendor working on a customer's machine.
  - **Agent tools like Claude Code** ask for permission on the machine they run on, from the same person who started them. They don't cover two separate parties.
- Clients won't let an outside AI touch their machine unless they keep control and can check what happened.

## 4. Target users

### First market: desktop software vendors
Teams shipping Electron apps, developer tools, CAD and design tools, games, or self-hosted business software, whose hardest support tickets involve the customer's environment ("works on my machine", install failures, crashes the crash reports don't explain).

| Persona | Side | Needs |
|---|---|---|
| Support or solutions engineer at a vendor | Agent | Find the cause of a customer's crash or install failure quickly without long screen-share calls. |
| Engineering lead at a vendor | Agent | Tie field failures to the codebase; turn findings into tickets or fixes. |
| End user at a customer | Client | Get the problem fixed without losing control of their machine. |
| IT or security admin at a customer | Client | Approve Valet for installation; set limits; review logs. |

### Later
- Guided onboarding and installation (the agent sets up the vendor's software on the client machine).
- Managed service providers and internal IT teams.
- Developers giving their own agents controlled access to other machines they own.

## 5. Goals and non-goals

### Goals (v1)
1. An agent can run commands on a client machine within permissions the client granted for that session.
2. Every action outside the granted permissions needs approval from a person at the client machine.
3. The OS enforces the permissions; Valet does not rely on parsing command text.
4. The client can see and export a tamper-evident record of everything that happened.
5. A vendor can connect its existing agent (via MCP) in under an hour.

### Non-goals (v1)
- GUI control: no screen sharing, screen capture, or mouse and keyboard input. **This is permanent, not just v1.**
- Unattended access. A person at the client machine must be present and must have started or accepted the session.
- Access that lasts beyond a session.
- Mobile clients.
- Building Valet's own AI agent. Valet is the secure connection layer; vendors bring their own agent.

## 6. Product principles

1. **The client's machine decides.** Permissions are held and enforced on the client. Nothing on the agent side can grant permissions.
2. **Deny by default.** Anything not explicitly granted is blocked or needs approval.
3. **Only a person can approve.** The agent can never approve its own requests.
4. **Show the real action.** Approval prompts show what will actually happen, not what the agent says it will do.
5. **Everything is recorded.** If it's not in the log, it didn't happen.
6. **No lingering access.** When a session ends, all its permissions and processes end with it.

## 7. Core concepts

### 7.1 Sessions
- The **agent side** creates a session request and gets a one-time join code or link.
- The **client** opens the Valet app and enters the code or opens the link. The client app shows:
  - the agent's **verified organization** (for example "Acme Inc., verified") and the purpose the agent gave,
  - the proposed permission template.
- The client chooses a starting point: **no permissions**, **all permissions** (with a clear warning), or the **template**, which they can edit item by item before accepting.
- The session has a maximum length (default 60 minutes; the client can extend it).
- Either side can end the session at any time. The client has an always-visible **End session** control.
- At session end: all grants are revoked, every process the session started is killed, and the log is sealed.

### 7.2 Permission model
Each grant is a **type + scope + access level**, optionally limited in time.

| Type | Scope | Access levels | Example |
|---|---|---|---|
| **Filesystem** | Path or glob | `read`, `write`, `execute` | read `~/Library/Logs/AcmeApp/**` |
| **Program** | Absolute path of an executable | `run` | run `/usr/bin/log` |
| **Network** | Host, port, or "none" | `connect` | connect `api.acme.com:443` |
| **Environment** | Variable names | `read` | read `PATH`, `NODE_ENV` |
| **Processes** | All, or by name | `list`, `signal` | list all; signal `AcmeApp` |
| **Admin rights** | Per command | `elevate` | Never granted in advance; always asks |

Rules:
- Scopes are always **explicit**. A grant for `~/Projects/acme` does not cover `~/Projects`.
- Symbolic links are resolved before checking; a link can't escape a scope.
- A grant can be **time-limited** ("for 15 minutes") or **one-off** ("this command only").
- Some locations are **always protected** and can't be granted through a template, only through an explicit high-risk approval: SSH keys, keychains and credential stores, browser profiles, password manager data, and `.env` files outside the granted scope.

### 7.3 Risk levels
Each action gets a risk level that controls how approval works, to avoid approval fatigue.

| Level | Examples | Default behavior |
|---|---|---|
| **Low** | Read inside a granted scope; list processes; read allowed environment variables | Allowed automatically if granted; logged |
| **Medium** | Write inside a granted scope; run an allowed program | Allowed if granted; otherwise prompt |
| **High** | Any network access; reading protected locations; deleting files; installing software | Always prompts, even if granted, unless the client chose "don't ask again this session" |
| **Critical** | Admin rights; changes to system settings | Always prompts with stronger confirmation; can't be pre-granted |

### 7.4 Approval flow
When an action needs approval:

1. **Valet prompt (always first).** A native window on the client shows:
   - the **exact action**: command and arguments, working directory, resolved program path, and the files, hosts or rights it needs that aren't already granted,
   - the risk level,
   - the **agent's stated reason**, shown below and clearly marked as the agent's own description,
   - choices: **Deny**, **Allow once**, **Allow for this session**, **Allow for 15 minutes**, and for scoped requests, **Allow for this directory**.
2. **OS prompt (if needed).** If the action also needs an OS-level permission (for example macOS Full Disk Access, or an admin password), the OS prompt appears after the Valet prompt. **The Valet prompt appears even if the Valet app already holds the OS permission.**
3. **Confirmation needs a person.** Approving requires a physical key press, Touch ID or Windows Hello. Medium-risk approvals can use a plain click; high and critical levels require biometric or password confirmation.
4. **Timeout.** If nobody answers within 60 seconds (configurable), the request is denied.
5. The agent gets a structured result: `approved`, `denied`, or `timed_out`.

### 7.5 Enforcement
- Every command runs in a **sandboxed process** that only has the session's current grants. Child processes inherit the same restrictions.
- Enforcement happens at the OS level, not by inspecting command text:
  - **macOS:** sandbox profiles; Endpoint Security for monitoring
  - **Windows:** AppContainer and Job Objects
  - **Linux:** Landlock, seccomp, namespaces
- The command text is shown to the person approving it. **The sandbox is what actually enforces the rules.**
- If a sandboxed command tries to access something it wasn't granted, Valet stops it and raises an approval prompt (if possible) or returns a denial to the agent.
- Resource limits per session: CPU time, memory, number of processes, output size.
- The environment is **cleared by default**; only granted variables are passed in.

### 7.6 Output filtering
Before any output leaves the client machine:
- Known secret patterns (API keys, tokens, private keys, passwords in connection strings, `.env` values) are replaced with `[REDACTED:<type>]`.
- Optional filtering of personal data (emails, phone numbers) can be turned on by the client's admin.
- The log records that something was removed, but not what was removed.
- Output size is capped per action; larger output is cut off with a marker.

### 7.7 Audit log
- Every session event is recorded: session start, permission changes, each action, each approval or denial (and how it was confirmed), output size, filtering, and session end.
- Each entry is chained to the previous one and signed with a key held on the client, so the log is tamper-evident.
- The client can view the log during and after the session, and export it (JSON and a readable PDF).
- The agent side receives a copy of the sealed log at session end.
- Logs are kept on the client. Copies kept by Valet's servers, and for how long, are an open question (see §13).

## 8. User flows

### 8.1 Vendor-initiated support session
1. A customer contacts Acme's support with a crash.
2. Acme's support agent (AI) creates a Valet session using the "AcmeApp crash triage" template and sends the customer a join link.
3. The customer opens the link; the Valet app shows "Acme Inc. (verified) wants to start a session" with the proposed permissions:
   - read `~/Library/Logs/AcmeApp/**`
   - read `~/Library/Application Support/AcmeApp/config.json`
   - run `/usr/bin/log`, `/usr/sbin/system_profiler`
   - list processes
4. The customer removes `system_profiler` and accepts.
5. The agent reads logs and config (allowed automatically), runs `log show` for the app (allowed), and finds a conflict with an outdated GPU driver.
6. The agent asks to run `system_profiler SPDisplaysDataType`. The customer gets a prompt, checks it, and approves once with Touch ID.
7. The agent confirms the cause and asks to write a corrected setting to `config.json`. The customer approves.
8. The session ends; the customer and Acme both receive the signed log. The agent files an internal ticket with what it found.

### 8.2 Denied action
1. During a session, the agent tries `cat ~/.ssh/id_rsa`.
2. The sandbox blocks the read. Because `~/.ssh` is protected, the client sees a **high-risk** prompt highlighting that this is an SSH private key.
3. The client denies it. The agent receives `denied`; the event is logged.

### 8.3 Client ends the session early
1. The client clicks **End session** at any point.
2. All grants are revoked at once, running processes are killed, the log is sealed, and the agent is told the session ended.

## 9. Functional requirements

### 9.1 Client app (desktop)
| ID | Requirement | Priority |
|---|---|---|
| C1 | Join a session with a code or link; show the agent's verified organization and stated purpose. | P0 |
| C2 | Show the proposed permissions; let the client start from none, all or the template, and edit each item. | P0 |
| C3 | Enforce grants with the OS sandbox for every command and its child processes. | P0 |
| C4 | Show approval prompts per §7.4, with confirmation that the agent can't fake. | P0 |
| C5 | Deny unanswered prompts after the timeout. | P0 |
| C6 | Always-visible session indicator with **End session**. | P0 |
| C7 | Filter secrets out of output before sending. | P0 |
| C8 | Signed, chained audit log; view and export. | P0 |
| C9 | Kill all session processes and revoke all grants when the session ends. | P0 |
| C10 | Live activity feed showing each action as it happens. | P1 |
| C11 | Admin policy: an organization can set limits that individual users can't override (for example "never allow network access"). | P1 |
| C12 | Optional filtering of personal data. | P2 |

### 9.2 Agent connector
| ID | Requirement | Priority |
|---|---|---|
| A1 | MCP server exposing Valet tools to any MCP-compatible agent. | P0 |
| A2 | Tools: `create_session`, `get_session_status`, `run_command`, `read_file`, `write_file`, `list_dir`, `tail_log`, `list_processes`, `get_system_info`, `request_permission`, `end_session`. | P0 |
| A3 | Every tool returns structured results, including `denied` and `timed_out`, so the agent can adapt. | P0 |
| A4 | Each action requires a `reason` string, shown to the client as the agent's own description. | P0 |
| A5 | Vendor templates, created in a dashboard or as config files. | P1 |
| A6 | TypeScript and Python SDKs for agents that don't use MCP. | P1 |
| A7 | Webhooks for session events (started, ended, log ready). | P2 |

Structured tools (`read_file`, `tail_log` and so on) are easier to approve automatically within scope. `run_command` is the flexible, higher-risk option and gets its risk level from what it actually tries to access.

### 9.3 Relay service and dashboard
| ID | Requirement | Priority |
|---|---|---|
| R1 | Relay that connects the two sides; both connect outward, so the client opens no ports. | P0 |
| R2 | End-to-end encryption between client app and agent connector; the relay can't read commands or output. | P0 |
| R3 | Vendor organization accounts, verification, and API keys for the agent connector. | P0 |
| R4 | One-time join codes that expire after a short time (default 10 minutes). | P0 |
| R5 | Vendor dashboard: sessions, templates, logs received, team members. | P1 |
| R6 | Rate limits and abuse detection on session creation. | P1 |

## 10. Security requirements

### 10.1 Threats and mitigations
| Threat | Mitigation |
|---|---|
| Agent approves its own request | No GUI control; approval requires physical key press or biometric, handled only by the client app. |
| Agent misdescribes an action (prompt injection or a compromised agent) | Prompt shows the real action first; the agent's reason is secondary and labeled. |
| Command gets around directory scope (interpreters, `find -exec`, git hooks, install scripts, `PATH` tricks) | Enforcement in the OS sandbox on the whole process tree, not by parsing commands; resolved program paths; cleared environment. |
| Lingering access after the session | All grants are tied to the session; processes are killed and grants revoked at session end; no unattended mode. |
| Secrets leak to the agent or AI provider | Output filtering on the client; protected locations; environment cleared by default. |
| Scam: someone poses as a vendor | Verified organizations shown clearly; sessions only start when the client enters a code or opens a link; warnings for unverified organizations; client education in the app. |
| Relay compromise | End-to-end encryption; relay sees only metadata. |
| One vendor reaching another vendor's sessions | Sessions tied to a vendor organization and an authenticated connector; the backend checks organization membership and session ownership on every request; no trust in client-supplied organization IDs. |
| Log tampering | Chained, signed entries; copies held by both sides. |
| Client app compromised or bypassed | Signed builds and automatic updates; the sandbox runs separately from the network-facing part of the app; regular third-party security reviews. |

### 10.2 Compliance
- Plan for a SOC 2 Type II audit before selling to larger companies.
- Publish a security whitepaper and a clear description of what data leaves the client machine.
- Document how the AI provider handles data: what the vendor's agent sends to its AI model is the vendor's responsibility, but Valet should make it visible to the client.

## 11. Platforms
- **v1:** macOS (Apple Silicon and Intel).
- **v1.1:** Windows 10 and 11.
- **Later:** Linux (Ubuntu, Fedora).

*Assumption: macOS first, because sandboxing and biometric confirmation are most consistent there. Revisit based on where target customers' users are.*

## 12. Success metrics

| Metric | Target (first 6 months after launch) |
|---|---|
| Vendors with at least one completed session per week | 10 |
| Sessions where the client accepted the permissions (out of all session requests) | ≥ 70% |
| Median time from join to cause found, compared with the vendor's usual process | 50% faster |
| Approval prompts per session (median) | ≤ 5 |
| Client prompts answered "Allow" in under 2 seconds (a sign of approval fatigue) | < 20% |
| Security incidents caused by a grant being bypassed | 0 |

## 13. Open questions
1. **Server-side logs:** should Valet keep copies of logs, and for how long? The trade-off is easier vendor access against less data held by Valet.
2. **Pricing:** per vendor seat, per session, or per active client machine?
3. **Template trust:** can vendors' templates be reviewed or certified, so clients can trust them more?
4. **Join flow:** is a code or link enough, or should the vendor's own app (via an SDK) be able to start a Valet session?
5. **Embedded mode:** offer a client SDK that vendors build into their own app, instead of a separate Valet install?
6. **Admin rights:** support them at all in v1, or leave them out entirely?
7. **AI provider data:** should the client be able to require that output only go to AI providers with zero data retention?
8. **Offline or air-gapped clients:** is there a self-hosted relay option for regulated customers?

## 14. Competitive landscape

| Category | Examples | How Valet differs |
|---|---|---|
| Remote desktop with AI features | TeamViewer (MCP connector, Tia), Devolutions RDM | Built for humans watching screens; no per-action consent from the machine's owner for an AI. |
| SSH and privileged access | OpenSSH, Teleport, StrongDM, Tailscale SSH | Account-level access after login; no per-action approval by the machine's owner. Check whether these have added AI-agent access features. |
| IT management | NinjaOne, Atera, ConnectWise | For a company's own IT team on its own devices, not an outside vendor on a customer's machine. |
| Open-source MCP remote control | mcp-vnc, MCPControl, Remote macOS Use | GUI-based, no consent model, no enforcement on the client. |
| AI debugging from crash data | Sentry Seer | Works from crash reports; can't inspect the live environment. A possible integration rather than a competitor. |

**Valet's edge:** permissions owned and enforced on the client's machine, across two separate parties, with approvals only a person can give and a log both sides can trust.

## 15. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Validate** | 10–15 interviews with vendors; mock of the permission prompt reviewed by 3–5 client-side security or IT people; manual "send us your hardest ticket" trials | At least 3 vendors agree to a pilot |
| **1. Prototype** | macOS client app with sandbox, prompts and log; MCP connector; simple relay | One end-to-end session on a test machine |
| **2. Private pilot** | Templates, output filtering, verified vendor organizations, dashboard basics | 3 vendors running real support sessions |
| **3. Security review** | Third-party penetration test; whitepaper; start SOC 2 preparation | No unresolved high-severity findings |
| **4. Public beta** | Windows client, SDKs, admin policies | 10 vendors active weekly |
