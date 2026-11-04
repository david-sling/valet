# Product

<!-- impeccable:product-schema 1 -->

> Written from `PRD.md` and the founding conversation (2026-11-04). The init questions went unanswered, so lines marked *(inferred)* are taken from the PRD rather than confirmed. Correct them here when they change.

## Platform

web

The landing page and vendor dashboard are web. The client app is a desktop app (macOS first, then Windows, then Linux); its stack is not decided.

## Stack

Undecided. Landing-page explorations are static HTML. *(inferred)* Next.js on Vercel, matching Wave, is the likely choice for the landing page and dashboard.

## Users

- **Vendors (agent side), who pay:** support and solutions engineers, and engineering leads, at companies shipping desktop software (Electron apps, developer tools, CAD and design tools, games, self-hosted business software). Their hardest tickets depend on the customer's environment: "works on my machine", install failures, crashes the crash reports don't explain.
- **Clients (the side being controlled), who must agree:** the end user whose machine it is, and the IT or security admin who approves installing Valet.
- *(inferred)* The landing page speaks to vendors first; clients get a clear section on why accepting a session is safe.

## Product Purpose

Valet lets an AI agent run commands on someone else's machine, with that machine's owner deciding what is allowed. Each session starts with permissions the client reviews; anything outside them needs the client's approval on their own machine. Every rule is enforced on the client machine in an OS sandbox, and every action lands in a signed log both sides can see.

Success: vendors find the cause of environment-specific problems faster than with screen-share calls, and clients accept sessions because they stay in control.

## Positioning

Permission owned and enforced on the machine being controlled, across two separate parties. Agent tools ask the person who started them, on their own machine; remote-desktop tools assume a human technician the client can watch; SSH and access tools grant an account's full rights at login. Valet is a valet key: it drives the car but doesn't open the trunk.

## Operating Context

- A vendor's AI agent connects through an MCP server; the client joins a session with a one-time code or link.
- Sessions are temporary (default 60 minutes), attended (a person at the client machine), and start from none, all, or a vendor template of permissions.
- Approvals need a physical key press or biometric (Touch ID, Windows Hello); unanswered prompts deny after a timeout.

## Capabilities and Constraints

- **Commands only.** No screen sharing, screen capture, or mouse and keyboard control, ever.
- Permissions are granular and scoped: filesystem paths (read, write, execute), programs, network hosts, environment variables, processes, admin rights.
- Enforcement is in the OS sandbox, never by parsing command text.
- Output is filtered for secrets before it leaves the client machine.
- No unattended access and no access beyond a session.
- Open: server-side log retention, pricing, vendor-template certification, an embeddable client SDK, admin-rights support in v1, zero-retention AI requirements, self-hosted relay. See PRD §13.

## Brand Commitments

- Name: **Valet**, at `valet.davidsling.in`. Tagline: "A valet key for AI agents."
- Mark: a red valet ticket with its cream claim stub torn off (`assets/brand/`). The agent holds the ticket; the client keeps the stub.
- Brand colours: ticket red and stub cream, extended with further colours on the landing page.
- Visual language descends from Wave (`wave.davidsling.in`); the landing page should feel like the Wollo reference the founder supplied: smooth, scroll-driven motion and a multi-colour illustrated world.
- Calm, not alarming: no padlocks, shields, glowing "cyber" greens, or red alarm styling for security.

## Evidence on Hand

None yet: no customers, testimonials, benchmarks, or pricing. Nothing of that kind may be invented on any surface. Demonstration content (example sessions, commands, vendors) must be labelled as an example.

## Product Principles

1. The client's machine decides.
2. Deny by default; approve on purpose.
3. Show the real action, not the agent's description of it.
4. If it isn't in the log, it didn't happen.
5. No lingering access: everything ends with the session.

## Accessibility & Inclusion

Risk and state are never conveyed by colour alone. Approval prompts must be fully keyboard operable, with focus starting on Deny. All motion has a reduced-motion alternative.
