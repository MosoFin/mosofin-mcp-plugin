---
name: connect
description: Sign in to MosoFin from the conversation and continue the user's request. Use when MosoFin tools are missing, a call returns Unknown tool or an authentication error, the MosoFin server needs authentication, the user asks how to connect or sign in to MosoFin, or the user says they finished signing in.
allowed-tools:
  - mcp__plugin_mosofin_mosofin__list_workspaces
  - mcp__plugin_mosofin_local__list_workspaces
  - mcp__plugin_mosofin_local__mosofin_connection_status
  - mcp__plugin_mosofin_local__mosofin_sign_in
  - mcp__plugin_mosofin_local__mosofin_connect
---

# Sign in to MosoFin

MosoFin is a remote MCP server at `https://mcp.mosofin.com/mcp` using OAuth
(DCR + PKCE). This plugin offers two ways to reach it — use whichever already
works; the user never needs both:

| Route | Shown in `/mcp` as | Sign-in |
|---|---|---|
| `mosofin` — HTTP | `plugin:mosofin:mosofin` | The host's own OAuth (`/mcp` → Authenticate, Connectors page, …) |
| `local` — plugin helper (Node.js) | `plugin:mosofin:local` | From the conversation, through the helper's tools below |

The `local` helper starts **idle** and only exposes three tools until signed
in: `mosofin_connection_status`, `mosofin_sign_in`, `mosofin_connect`. Once
signed in, it exposes the same MosoFin tools as the HTTP route.

Signing in to **MosoFin** is not the same as reconnecting a **company file**.
A disconnected QuickBooks (or other) file comes back as `connected: false` or
`datasource_not_active` with a `reconnect_url` — that is handled by
`/mosofin:connections`, not here. Say "sign in to MosoFin", never
"refresh/reconnect the integration".

## 1. Keep the request

Before any sign-in step, hold on to what the user asked: the question,
workspace or company they named, period (resolve relative dates to
`YYYY-MM-DD` now), and the output they want. Sign-in must not cost them their
question.

## 2. Check for working tools first

Search the session's tools for MosoFin's `list_workspaces`. Check the tool's
origin rather than one exact prefix — any of these is MosoFin:

| Where it came from | Typical id |
|---|---|
| This plugin, HTTP route | `mcp__plugin_mosofin_mosofin__list_workspaces` |
| This plugin, `local` helper | `mcp__plugin_mosofin_local__list_workspaces` |
| A MosoFin connector added in Claude (claude.ai, Desktop, Cowork) | `mcp__MosoFin__list_workspaces` or similar |
| ChatGPT / Codex app | `mosofin.list_workspaces` |

If one exists, call `list_workspaces`. If it succeeds, the user is signed in:
go to step 5. Do not start a sign-in "to be sure", and do not sign in to a
second route when one works. If two routes both work, use one consistently;
they may be signed in as different MosoFin users, so if their workspace lists
differ, ask which account to use.

A loaded skill does not prove the connection works, and a missing tool does
not prove the user's login expired. Report what you actually see.

## 3. Get the user signed in

Give **only** the next step for the host you are in — not every host's list.
Call each sign-in tool **once**; never loop.

### 3a. The plugin helper is available (`mosofin_sign_in` is listed)

- **Local Claude Code** (terminal, IDE, Desktop Code tab — the browser runs
  on this machine): call **`mosofin_connect`**. It reuses a saved login or
  opens the browser here. Say: "A MosoFin sign-in page opened in your
  browser — approve it, then come back and say *done*."
- **Cowork, or any host where the browser is not on this machine:** call
  **`mosofin_sign_in`**. Then by `state`:
  - `awaiting_sign_in` with `authorization_url` → show it as a short link,
    **[Sign in to MosoFin](<authorization_url>)**, and say: "Sign in, then
    come back here and say *done*; I'll pick up where we left off." Never
    paste the raw long URL, edit or construct a URL, or open a second browser.
    The helper receives completion itself — no codes or callback URLs.
  - `connected` → a saved sign-in was reused: go to step 4.
  - `connecting` → check `mosofin_connection_status` **once** after a moment.
  - `failed` and the message says conversation sign-in **is not enabled on
    this MosoFin server** → don't retry it; use the host's own sign-in (3b).
  - `failed` otherwise → call `mosofin_sign_in` once more (it resumes a valid
    link or makes a fresh one). A second failure: report the non-secret
    `message` and use 3b.

Status results carry `plugin_version`, `helper_instance`, and
`connection_route` — quote them when reporting a problem. `idle` alone does
not prove a restart or a lost sign-in.

### 3b. The host's own sign-in

**Claude Code**

- If the host offers its own MosoFin authentication tool (e.g. `authenticate`
  on the `mosofin` server), call it once and show its URL as
  **[Sign in to MosoFin](<returned URL>)**.
- Otherwise: `/mcp` → **`plugin:mosofin:mosofin`** (shows *Needs
  authentication*) → **Authenticate**. The browser opens; return here after.
- Browser can't open (SSH, container): from a shell,
  `claude mcp login plugin:mosofin:mosofin --no-browser`, open the printed
  link anywhere, and paste the final callback URL into **that terminal** —
  never into this chat.
- Neither `plugin:mosofin:mosofin` nor `plugin:mosofin:local` in `/mcp`: the
  plugin isn't installed or enabled here —
  `/plugin marketplace add mosofin/mosofin-mcp-plugin`,
  `/plugin install mosofin@financehub`, restart Claude Code.
- `plugin:mosofin:local` shows **failed** at startup: Node.js 22.12+ and npm
  must be available to Claude Code. The HTTP route still works without them —
  use `/mcp` → Authenticate above.
- Still failed right after signing in: some Claude Code versions hold a failed
  sign-in for about 15 minutes — Authenticate again in `/mcp`, or restart
  Claude Code. Never edit or delete auth or cache files.

**Claude Desktop, Cowork, claude.ai**

**Settings → Connectors** (or **+** in the prompt box → Connectors) →
**MosoFin** → **Connect**. If MosoFin isn't listed, add a custom connector
with URL `https://mcp.mosofin.com/mcp`, then Connect. Return to **this**
conversation and make sure MosoFin is on for it. If sign-in lands on a
`localhost` page the browser can't reach, the host's callback didn't
complete — use `mosofin_sign_in` (3a) if listed, otherwise the Connectors
page; don't retry the same link.

**ChatGPT / Codex**

1. ChatGPT web → **Settings → Apps & Connectors** (or chatgpt.com/plugins).
2. Turn on **Developer mode** if adding a custom connector (Settings →
   Security and login, or Apps → Advanced settings).
3. Create **MosoFin** — URL `https://mcp.mosofin.com/mcp`, Authentication
   **OAuth** — and complete sign-in.
4. Start a **new** chat with the MosoFin app **on**, then ask again. (ChatGPT
   can't add tools to an existing chat, so this is the one host where the
   user restates the request — offer a ready-to-paste version of it.)

**Grok Build**

Install `mosofin` from the xAI plugin marketplace and complete the sign-in it
prompts for, then return here.

## 4. When the user comes back

When the user says *done*, *signed in*, *continue*, or similar:

1. If the helper was used, call `mosofin_connection_status` **once**. It
   resumes the sign-in even if the helper restarted meanwhile.
2. Search the tools again — MosoFin's data tools may have just appeared.
3. Call `list_workspaces` **once**. Success → step 5; don't ask them to
   repeat their question.
4. Still missing or unauthorized → say exactly what you see (e.g.
   "`plugin:mosofin:local` is still waiting for sign-in") and give the one
   next step. Allow **one** retry in total; then stop and point them to
   support@mosofin.com with the visible, non-secret status. A "signed in"
   browser page alone does not prove access.

If the original request is no longer visible in this conversation, ask what
they want to look at — never claim to remember a request you can't see.

## 5. Continue the request

Workspace confirmation is still mandatory after sign-in: read the workspace
name(s) back and get an explicit yes (see `/mosofin:workspaces`). Then carry
on with the held request through `/mosofin:query-workspace` or the matching
skill, using the route that worked. If the user only asked to connect, say
they're signed in, name the workspaces they can see, and suggest one useful
first question.

## Never

- Ask for, accept, or repeat passwords, tokens, authorization codes, or
  callback URLs in the chat. If a user pastes one, tell them not to and
  don't use it.
- Build OAuth or login URLs yourself, call MosoFin's HTTP endpoints directly,
  or write MCP configuration to work around a missing connection.
- Call `mosofin_connect` in Cowork or a remote host (its browser opens on a
  machine the user can't see), or sign in to a second route when one works.
- Loop through repeated sign-ins, reinstalls, or new chats, or tell a
  remote-only host's user to install Node.js.
- Invent workspaces, companies, or figures while signed out, or answer from
  memory as if it were live data.
- Treat a MosoFin sign-in as fixing a disconnected company file, or the
  reverse.
