---
name: Valet
description: A valet key for AI agents — agents run commands on a client's machine, and the client's machine decides what is allowed.
colors:
  ground: "#f4f4f2"
  panel: "#ffffff"
  panel-2: "#fafaf8"
  ink: "#15161a"
  ink-2: "#4a4c55"
  ink-3: "#666977"
  line: "#e4e4e9"
  line-2: "#efeff2"
  line-strong: "#cfcfd6"
  sky: "#8ec5ff"
  sky-soft: "#e4f0ff"
  sky-ink: "#1f4b8f"
  lilac: "#c7b8ff"
  lilac-soft: "#efeaff"
  peach: "#ffc4b0"
  peach-soft: "#ffede6"
  peach-ink: "#8f3b1f"
  accent: "#4353e8"
  ok: "#1fa35a"
  idle: "#d99a00"
  gone: "#9a9ca8"
  brand-red: "#e2412f"
  brand-red-ink: "#b8301f"
  brand-cream: "#efd09b"
  brand-cream-soft: "#fbf3e3"
  risk-low-soft: "#e3f4ea"
  risk-low-ink: "#136b3a"
  risk-medium-soft: "#fdf0d2"
  risk-medium-ink: "#7a5200"
  risk-high-soft: "#ffe3d9"
  risk-high-ink: "#8f2f14"
  risk-critical: "#8f2f14"
typography:
  display:
    fontFamily: "Funnel Display, Albert Sans, system-ui, sans-serif"
    fontSize: "clamp(2.625rem, 6vw, 5rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.03em"
  display-strong:
    fontFamily: "Funnel Display, Albert Sans, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4.5vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Funnel Display, Albert Sans, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 2.75rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Funnel Display, Albert Sans, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title-sans:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.3
  lead:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.625
  meta:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Albert Sans, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.02em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.65
  mono-action:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.55
rounded:
  code: "5px"
  focus: "6px"
  avatar: "9px"
  control: "12px"
  card: "20px"
  panel: "28px"
  frame: "36px"
  pill: "9999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-primary-sm:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.peach-ink}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-danger-filled:
    backgroundColor: "{colors.peach-soft}"
    textColor: "{colors.peach-ink}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px"
  action-block:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-action}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
  input:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  segmented:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "4px"
  segmented-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.avatar}"
    height: "36px"
  badge-agent:
    backgroundColor: "{colors.sky-soft}"
    textColor: "{colors.sky-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
  badge-client:
    backgroundColor: "{colors.peach-soft}"
    textColor: "{colors.peach-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
  risk-low:
    backgroundColor: "{colors.risk-low-soft}"
    textColor: "{colors.risk-low-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  risk-medium:
    backgroundColor: "{colors.risk-medium-soft}"
    textColor: "{colors.risk-medium-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  risk-high:
    backgroundColor: "{colors.risk-high-soft}"
    textColor: "{colors.risk-high-ink}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  risk-critical:
    backgroundColor: "{colors.risk-critical}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  avatar-agent:
    backgroundColor: "{colors.sky-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.avatar}"
    size: "30px"
  warning-note:
    backgroundColor: "{colors.peach-soft}"
    textColor: "{colors.peach-ink}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
---

# Design System: Valet

Valet shares Wave's design language (`wave-project/wave/DESIGN.md`, recorded 2026-09-11). Every Wave token is carried over unchanged: ground, panels, ink, lines, role hues, accent, presence, type, radii, spacing, shadows and motion. Valet adds two sets of its own: the **brand colours**, red and cream from the valet-ticket mark, and the **risk scale**, because Valet is about deciding whether something is safe and Wave has nothing like it. Nothing is built yet, so this is a **seed**: tokens are normative, and the component sections describe intent until code exists. Once the first surface ships, re-run `/impeccable document` in scan mode and let the code become the authority.

## Overview

**Creative North Star: "The Valet Stand"**

A valet stand is where you hand over a key that does less than your own: it drives the car but doesn't open the trunk. Valet's screens are that handover, made visible. The first thing on any surface is **the exact thing being asked for**, a command, a path or a host, in a white panel on Wave's warm off-white ground. Who is asking, why they say they need it, and how risky it is all sit around that panel and stay quieter than it.

The world is Wave's: light, low-contrast surfaces, high-contrast type, and one soft colour field per surface. Valet keeps Wave's two sides with new names: **sky is the agent** (the side that controls), **peach is the client** (the side being controlled, and the person who decides), and **lilac is the session**, the temporary space where they meet. Valet is calmer than Wave. Wave shows a conversation; Valet shows a decision, and a decision needs stillness.

The brand itself is a **valet ticket**: a red ticket with its cream claim stub torn off. The agent holds the ticket and the client keeps the stub, so a session is one ticket in two halves. Red and cream are Valet's identity colours. They belong to the mark, the app icon and the landing page, and stay out of the decisions the client makes in the app (see the Brand-Is-Not-A-Signal Rule).

Lineage and refusals carried from Wave: no gradient text, no kicker labels above headings, no cards inside cards, light theme only (dark is a separate later decision, not an inversion of these tokens). Refused for Valet in particular: padlock-and-shield imagery, glowing "cyber" greens, dark terminal-themed panels, and red alarm styling. Valet should feel like a calm front desk, not a security product's war room.

**Key Characteristics:**
- A red-and-cream valet ticket as the mark; red and cream as brand colours outside the decision screens.
- Wave's warm off-white ground, white 28px panels and diffuse low shadows.
- The literal action (command, path, host) is always shown in Geist Mono, always shown first, and is never shortened in a way that hides what it touches.
- Sky = agent, peach = client, lilac = session. Risk is a separate four-step scale, always shown as a word plus colour, never colour alone.
- The ink pill is the only primary action, and in an approval prompt it is never the default. Approving always takes a deliberate step.
- The client can always see the session and end it in one click.

## Surfaces

Valet has three surfaces. Each has its own mode (see the Impeccable skill):

| Surface | Mode | Who uses it |
|---|---|---|
| **Client app** (desktop): join, permission review, approval prompt, activity feed, audit log | Operate | The client: the person whose machine it is |
| **Vendor dashboard** (web): sessions, templates, received logs, team | Operate | The vendor running the agent |
| **Landing page** (`valet.davidsling.in`) | Persuade | Vendors evaluating Valet; clients checking whether it's safe |

## Colors

Wave's warm neutral base and role hues, plus Valet's own red-and-cream brand pair and a semantic scale for risk.

| Token | Hex | Role in Valet |
|---|---|---|
| ground | #f4f4f2 | Window and page background. |
| panel | #ffffff | Every panel: the approval prompt, permission list, activity feed, log. |
| panel-2 | #fafaf8 | Recessed surfaces: the action block, inputs, segmented track, inline code. |
| ink | #15161a | Text, headings, the primary pill, the literal action in the action block. |
| ink-2 | #4a4c55 | Secondary copy; the agent's stated reason. |
| ink-3 | #666977 | Labels, timestamps, hints, system events. Clears 4.5:1 on ground, panel and panel-2. |
| line / line-2 / line-strong | #e4e4e9 / #efeff2 / #cfcfd6 | Hairlines, as in Wave. |
| sky / sky-soft / sky-ink | #8ec5ff / #e4f0ff / #1f4b8f | **Agent.** Agent avatar tile, `agent` badge, the agent's side of the signal field. |
| peach / peach-soft / peach-ink | #ffc4b0 / #ffede6 / #8f3b1f | **Client.** `you` badge, the client's side of the field; also Wave's warning tone (danger buttons, warning notes). |
| lilac / lilac-soft | #c7b8ff / #efeaff | **Session.** The session bar's fill, text selection, the middle of the field. |
| accent | #4353e8 | Focus rings, focused borders, links. Never a fill, never a button. |
| ok / idle / gone | #1fa35a / #d99a00 / #9a9ca8 | Connection presence: agent connected, waiting, disconnected. Also the "verified" and "signature valid" checks (`ok`). |
| brand-red | #e2412f | **Brand.** The ticket half of the mark; large brand moments on the landing page (illustration, a single brand panel). 4.2:1 on white, so never body text. |
| brand-red-ink | #b8301f | **Brand.** Red when it has to be text, such as a brand word on the landing page. 6.0:1 on white, 5.5:1 on brand-cream-soft. |
| brand-cream | #efd09b | **Brand.** The stub half of the mark; illustration fills. Ink on it is 12.2:1. |
| brand-cream-soft | #fbf3e3 | **Brand.** The app icon tile; the landing page's brand surface. Ink on it is 16.4:1. |
| risk-low-soft / risk-low-ink | #e3f4ea / #136b3a | **New.** Low risk: reads within an approved scope. 5.8:1. |
| risk-medium-soft / risk-medium-ink | #fdf0d2 / #7a5200 | **New.** Medium risk: writes in scope, running an allowed program. 6.1:1. |
| risk-high-soft / risk-high-ink | #ffe3d9 / #8f2f14 | **New.** High risk: network access, protected locations, deletes, installs. 6.7:1. |
| risk-critical | #8f2f14 | **New.** Critical: admin rights, system settings. The only filled chip in the system; white text, 8.1:1. |

### Brand
- **Ticket Red** (`{colors.brand-red}`) and **Stub Cream** (`{colors.brand-cream}`): Valet's identity, taken from the mark. Used for the logo, app icon, favicon, and brand moments on the landing page. **Cream Paper** (`{colors.brand-cream-soft}`) is the light surface they sit on.

### Primary
- **Ink** (`{colors.ink}`): the primary action and the literal action. In Valet, the most important text on any screen is what the agent wants to run, so it is set in ink at full weight. The primary pill stays ink, not brand red, so that a red button never reads as a warning.

### Secondary
- **Sky**: the agent. **Peach**: the client. **Lilac**: the session that joins them.

### Tertiary
- **Accent**: focus only. **Ok / Idle / Gone**: presence and verification. **Risk scale**: how dangerous an action is.

### Neutral
- Wave's three surfaces (ground, panel, panel-2), three text levels (ink, ink-2, ink-3) and two hairlines (line, line-2). No fourth grey.

### Named Rules
**The Two Sides Rule.** (Wave's Two Poles Rule, renamed.) Sky belongs to the agent and peach to the client. Neither is used as decoration detached from its side.

**The Word-And-Colour Rule.** A risk level is always shown as a chip with its word (`Low`, `Medium`, `High`, `Critical`) and its colour. Colour alone never carries risk, because a person deciding in a hurry, or one who doesn't see colour well, must still read it correctly.

**The Brand-Is-Not-A-Signal Rule.** Brand red and cream say "this is Valet", never "this is safe" or "this is dangerous". They don't appear in the approval prompt, the permission list, risk chips, outcome badges or buttons. In the client app they appear only in the mark (window title, menu bar, about screen). If brand red showed up next to a decision, it would be read as a warning.

**The Warm-Not-Red Rule.** No interface state is red. High and critical risk use a deeper version of Wave's warm warning tone (`risk-high-ink`, `risk-critical`), which is brown-red and clearly darker than brand red (2:1 apart), and always carries its word. Valet must feel serious, not alarming; alarm leads people to click whatever makes it go away.

**The One Field Rule.** Wave's signal field (sky → lilac → peach) appears at most once per surface, as a panel background, never as text. In the client app it is the join screen's panel, where the two sides first meet. It never appears behind an approval prompt.

## Typography

**Display Font:** Funnel Display (Albert Sans, system-ui fallback), weights 400, 700, 800
**Body Font:** Albert Sans (system-ui, -apple-system, Segoe UI fallback)
**Mono Font:** Geist Mono (ui-monospace, SF Mono, Menlo, Consolas fallback)

**Character:** Wave's pairing unchanged: geometric display over a plain humanist text face, with weight rather than colour carrying emphasis. Valet uses mono more than Wave, because Valet's core content is commands and paths.

### Hierarchy
Wave's hierarchy is carried over unchanged: **Display** 400 + **Display strong** 800 (landing hero only), **Headline**, **Title**, **Title sans**, **Lead**, **Body**, **Meta**, **Label** and **Mono**. See the frontmatter for exact values. Valet adds one step:

- **Mono action** (Geist Mono 500, 14px, line-height 1.55): the literal command, path or host in an approval prompt and in the activity feed. Larger and heavier than Wave's 12.5px mono, because it is the thing being decided on, not a prompt being copied. It wraps; it never truncates with an ellipsis.

### Named Rules
**The Weight-Not-Colour Rule.** From Wave: emphasis in headings is carried by weight, never by colour or gradient.

**The Mono-Is-The-Literal Rule.** (Replaces Wave's Mono-Is-For-Agents Rule.) Geist Mono is used only for text the machine will actually act on: commands and their arguments, file paths, program paths, hostnames and ports, environment variable names, and the signed log's hashes. Anything written by a person or an agent to explain something is set in Albert Sans. This makes the difference between what will happen and what someone says will happen visible at a glance.

**The Agent's-Words Rule.** The agent's stated reason is always Albert Sans 14px ink-2, under a 12.5px ink-3 label reading `Agent's reason`, and always below the action block. It is never larger, heavier or higher on the screen than the action it describes.

## Layout

**Client app.** A desktop window of about 720 × 560px minimum, laid out as a single column at `max-width: 40rem` with 24px side padding on `ground`. A session bar is pinned to the top; the content scrolls below it. Screens follow the session's life: **Join** → **Review permissions** → **Live session** (activity feed, with the current grants in a side panel from 960px wide) → **Session ended** (log summary). The approval prompt is a **separate native window** above all others, never a panel within the main window, so it can appear while the main window is hidden or minimised.

**Vendor dashboard.** Wave's page shell: centred `max-width: 72rem`, 24px side padding, Wave's split-section ratios (`0.8fr / 1.2fr`) where a list and a detail sit side by side, collapsing to one column below `lg` (1024px).

**Landing page.** Wave's landing layout: centred hero in a 44rem column, sections at 96px rhythm, split sections where copy sits beside proof. **The Proof-Wide Rule** (from Wave) applies: the proof, usually a real approval prompt or permission list, gets the wider column, and copy never exceeds 48ch.

Spacing is Wave's scale throughout: panel padding 20px on small widths and 24px from `md`, 14px gaps between list rows and cards, 24px between form groups, 8px between a label and its control.

## Elevation & Depth

Wave's approach: tonal first, shadow second. Ground, panel and panel-2 do most of the work; panels have a 6%-ink hairline border and a diffuse, low shadow. Nothing casts a hard or offset shadow.

### Shadow Vocabulary
- **Soft** (`0 1px 2px rgba(21,22,26,0.05), 0 8px 24px -12px rgba(21,22,26,0.16)`): every panel at rest.
- **Lift** (`0 2px 4px rgba(21,22,26,0.05), 0 24px 56px -24px rgba(21,22,26,0.28)`): the approval prompt window, and the framed product surface on the landing page.
- **Primary hover** (`0 10px 24px -12px rgba(21,22,26,0.5)`): the ink pill on hover, with a 1px rise.

### Named Rules
**The Soft-At-Rest Rule.** From Wave: panels don't change elevation on hover; only the primary pill lifts, by 1px.

**The Prompt-Is-Highest Rule.** The approval prompt is the only thing in Valet that uses Lift inside the client app. Nothing else may look as elevated, so nothing else can be mistaken for it.

## Shapes

Wave's radii, unchanged: 5px inline code, 6px focus ring, 9px avatar tile and selected segment, 12px controls and the action block, 20px cards and dialogs, 28px panels, 36px frame, full pill for buttons, chips and badges. Borders are 1px hairlines; panels holding a list or a `pre` clip their content so rows meet the 28px corner cleanly.

**The One Frame Rule.** From Wave: a panel is the frame. Inside it, structure comes from hairlines, tone and spacing, never a second bordered card. The action block is a recessed `panel-2` area, not a card.

## Components

### Buttons
Wave's buttons, unchanged: 48px full pills, ink-filled primary, white secondary with a `line` border, 180ms hover with a 1px rise on the primary only, 2px accent focus ring with a 3px offset. **Danger** (`button-danger`) is white with a `peach` border and `peach-ink` label; its confirmation state fills with `peach-soft`.

### Session bar
Always visible at the top of the client app while a session is live. 44px tall, `lilac-soft` fill, 1px `line` rule below. Left: the vendor's verified name in 13px 600 ink with an 8px presence dot (`ok` connected, `idle` reconnecting, `gone` disconnected), then a 13px ink-3 time remaining. Right: **End session** as a 36px `button-danger`. It ends the session immediately with no confirmation, because the safe action must never be slower than the risky one. In macOS's menu bar and the Windows tray, a Valet mark shows the same state whenever a session is live.

### Approval prompt
The product's signature component. A separate native window, 480px wide, `panel` background with the Lift shadow, 28px panel radius where the platform allows custom window shapes. From top to bottom:

1. **Header.** A risk chip, then a 16px Albert Sans 600 sentence: "**Acme support agent** wants to run a command." The vendor name is in ink; nothing else in the header is emphasised.
2. **Action block** (`action-block`). The literal action in `mono-action` on `panel-2`. Below it, three or four 12.5px rows in a two-column `label / value` grid, separated by `line-2` hairlines:
   - `Runs in`: working directory (mono)
   - `Program`: resolved program path (mono)
   - `Needs`: each access not already granted, as `read ~/Library/Logs/**` or `connect api.acme.com:443` (mono), with its own risk chip if it differs from the header's
   Protected locations (`~/.ssh`, keychains, browser profiles) are labelled in Albert Sans next to the path: "SSH private key", "Keychain".
3. **Agent's reason.** Per the Agent's-Words Rule.
4. **Scope.** Wave's choice-group capsule with the options `Once` · `This session` · `15 minutes` · `This folder` (the last only for path requests). Default: `Once`.
5. **Actions.** `Deny` (`button-secondary`) on the left and `Allow` (`button-primary`) on the right, equal widths. **Initial focus is on Deny.** Return and Space activate Deny, never Allow. Allow shows the confirmation method in its label ("Allow with Touch ID", "Allow with Windows Hello") and only completes once that confirmation succeeds. For low and medium risk, where a plain click is allowed, Allow becomes active after a 600ms pause so a click meant for another window can't land on it.
6. **Timeout.** A 2px `line-2` bar along the bottom edge that drains from right to left in `ink-3`, with a 12.5px ink-3 note: "Denies automatically in 0:42". At 10 seconds left the note turns ink; it never turns red or flashes.

Under no circumstances does the prompt auto-approve, pre-select Allow, or put Allow under the pointer's last position.

### Risk chips
A pill with the level's word in 12px 600, tracking 0.02em, using its `risk-*` component token. Low, medium and high are tinted; critical is the system's only filled chip. A 12px icon may precede the word, but the word is required.

### Join screen
The first screen of a session. One panel with the **signal field** as its background (this surface's One Field), holding:
- The vendor's name in Title (19px Funnel Display 700) with a verification line beneath: an `ok` check and "Verified organisation" in 13px ink-2. An unverified vendor shows a `warning-note` instead ("Valet could not verify this organisation. Only continue if you contacted them yourself.") and the primary action becomes `button-secondary`.
- The stated purpose in Body.
- Session length and expiry in Meta.
- **Continue to permissions** as the ink pill.

### Permission review
One panel with a `Label` heading per permission type (`Files`, `Programs`, `Network`, `Environment`, `Processes`, `Admin rights`) and one row per grant: a toggle, the scope in mono, the access level (`read`, `write`, `run`, `connect`) in a 12px `line-2` pill, and its risk chip. Rows are divided by `line-2` hairlines, not boxed. Above the list, a Wave `segmented` control picks the starting point: `None` · `Template` · `All`. Choosing `All` shows a `warning-note` above the list and keeps the protected locations off. The primary action reads "Start session with 4 permissions", stating the count so the client knows what they agreed to.

### Activity feed
Wave's transcript pattern, adapted. Each action is one row on a `30px / 1fr` grid: the agent's identity tile (sky-soft, initial in 12px 700) or the client's peach-soft tile for the client's own decisions; then a header line with the tool name (`run_command`, `read_file`) in 13px 600, an outcome badge and a 12px ink-3 `<time>`; then the literal action in 13px mono. Outcome badges: `Allowed` (ok-tinted, for actions inside a grant), `Approved` (ok-tinted, with the confirmation method on hover), `Denied` (peach), `Timed out` (gone). Output is folded by default behind "Show output · 2.1 KB"; redacted values appear as `[REDACTED:api_key]` in a `line-2` inline code style. Session events (started, permission added, session ended) are Wave's centred `.hairline-between` one-liners in ink-3.

### Audit log
The session-ended screen and the export. A panel listing the session's facts (vendor, start, end, actions, approvals, denials) in a `label / value` grid, then a seal line: an `ok` check, "Log sealed · signature valid", and the log's hash in 12px mono ink-3, shortened in the middle (`3f9a…c21e`), with the full value on hover and copy. Exports are two `button-secondary` pills: `Export JSON` and `Export PDF`.

### Valet mark (`assets/brand/`)
A valet ticket on a 24-unit grid: a red ticket (`brand-red`) with a rounded slot near the top and half-circle notches at the tear line, and its cream stub (`brand-cream`) torn off below, turned 8° and dropped slightly. The slot is a rounded bar rather than a round hole, because a round hole read as an eye. The tear is the idea: the agent holds the ticket, the client keeps the stub.

| File | Use |
|---|---|
| `valet-mark.svg` | Full-colour mark: lockups, landing page, about screen. Works on white, ground, cream and ink. |
| `valet-mark-mono.svg` | Single colour (`currentColor`): macOS menu bar, Windows tray, print, anywhere colour isn't available. |
| `valet-app-icon.svg` | 1024px app icon: the mark on a `brand-cream-soft` tile with a 228px corner radius. |
| `favicon.svg` | Browser tab icon; the full-colour mark. |

- **Lockup:** the mark, 7–8px gap, then "Valet" in Funnel Display 700 with -0.02em tracking, the mark about 1.3× the cap height.
- **Minimum size:** 16px. Below 20px the slot is barely visible; the two-part shape still reads.
- **Don't:** recolour the two halves, close the tear, rotate the whole mark, add an outline or shadow, or put it on brand red.

Explored and rejected (so they aren't tried again): a key emoji (generic), steering wheels (a full-width spoke with a centre hub read as a Poké Ball; the V-spoke wheel read as a check mark), a service bell, a key, overlapping circles (Mastercard), a pointed-bottom ticket (read as a pen nib or worse), and stacked or illustrated tickets (read as faces).

### Vendor marks
Vendor organisations appear with their own logo where supplied, at the same size as the Valet mark or smaller, following Wave's vendor-mark policy (official marks only, never redrawn).

### Motion
Wave's motion vocabulary, unchanged in timing and easing, with Valet's limits:
- **Arrive** (640ms, `cubic-bezier(0.16,1,0.3,1)`): activity-feed rows only, staggered when the feed first loads, unstaggered after that.
- **Dialog** (200ms opacity, 260ms transform): the approval prompt window and in-app dialogs.
- **Timeout drain**: linear, matching the real remaining time.
- **Button transition**: 180ms.
- **Reduced motion**: all durations collapse to 0.01ms; the timeout bar stops moving but the countdown text still updates.

**The Still-Prompt Rule.** Nothing inside the approval prompt moves except the timeout bar. No pulsing, shaking, glowing or attention-seeking animation: motion that demands attention pushes people to dismiss the prompt instead of reading it.

## Do's and Don'ts

### Do:
- **Do** show the literal action first, in `mono-action`, before anything that explains it.
- **Do** show risk as a word plus colour, using the four `risk-*` chips.
- **Do** colour by side: sky for the agent, peach for the client, lilac for the session.
- **Do** keep End session visible on every screen of a live session, one click away.
- **Do** put initial focus on Deny in every approval prompt.
- **Do** reuse Wave's components (buttons, panel, segmented control, choice group, transcript rows, hairline events) before inventing new ones.
- **Do** honour `prefers-reduced-motion`.

### Don't:
- **Don't** shorten a command or path with an ellipsis in an approval prompt; wrap it.
- **Don't** let the agent's reason sit above, or look bigger than, the action it describes.
- **Don't** use red, flashing, shaking or alarm styling for any risk level.
- **Don't** use padlocks, shields, glowing greens or dark "terminal" themes as visual shorthand for security.
- **Don't** make Allow the default, give it initial focus, or place it where a stray click lands.
- **Don't** use `accent` as a fill, heading colour or badge tone.
- **Don't** use brand red or cream for buttons, risk, outcomes or any other state; they are identity only.
- **Don't** nest a bordered or shadowed card inside a panel.
- **Don't** use the Lift shadow for anything in the client app except the approval prompt.
- **Don't** set a dark theme by inverting these tokens.
