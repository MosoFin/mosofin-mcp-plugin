---
name: connect
description: Sign in to MosoFin and continue the user's request. Use when MosoFin tools are missing, a call returns Unknown tool or an authentication error, the MosoFin server needs authentication, the user asks how to connect or sign in to MosoFin, or the user says they finished signing in.
---

# Sign in to MosoFin

MosoFin is a remote MCP server at `https://mcp.mosofin.com/mcp` using OAuth
(DCR + PKCE). Sign-in is handled by the AI host you are in — the plugin ships
no client id, secret, or local helper, and never handles tokens itself. This
skill's job is to keep the user's request, give the one sign-in step for this
host, and continue when they say *done*.

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
| This plugin in Claude Code | `mcp__plugin_mosofin_mosofin__list_workspaces` |
| A MosoFin connector in Claude (claude.ai, Desktop, Cowork) | `mcp__MosoFin__list_workspaces` or similar |
| ChatGPT / Codex app | `mosofin.list_workspaces` |

If one exists, call `list_workspaces`. If it succeeds, the user is signed in:
go to step 4. Do not start a sign-in "to be sure". If two MosoFin sources
both work, use one consistently; they may be signed in as different MosoFin
users, so if their workspace lists differ, ask which account to use.

A loaded skill does not prove the connection works, and a missing tool does
not prove the user's login expired. Report what you actually see.

## 3. Get the user signed in

Give **only** the next step for the host you are in — not every host's list.

**Claude Code**

- If the host offers its own MosoFin authentication tool (e.g. `authenticate`
  on the `mosofin` server), call it once and show its URL as
  **[Sign in to MosoFin](<returned URL>)**.
- Otherwise: `/mcp` → **`plugin:mosofin:mosofin`** (shows *Needs
  authentication*) → **Authenticate**. The browser opens; return here after.
- Browser can't open (SSH, container): tell the user to run Claude Code's
  own no-browser MCP sign-in for `plugin:mosofin:mosofin` from their
  terminal and follow its prompts there. Nothing from that flow belongs in
  this chat.
- `plugin:mosofin:mosofin` is not in `/mcp`: the plugin isn't installed or
  enabled here — `/plugin marketplace add mosofin/mosofin-mcp-plugin`,
  `/plugin install mosofin@financehub`, restart Claude Code.
- Still failed right after signing in: some Claude Code versions hold a failed
  sign-in for about 15 minutes — Authenticate again in `/mcp`, or restart
  Claude Code. Do not touch any local Claude Code files to work around it.

**Claude Desktop, Cowork, claude.ai**

**Settings → Connectors** (or **+** in the prompt box → Connectors) →
**MosoFin** → **Connect**. If MosoFin isn't listed, add a custom connector
with URL `https://mcp.mosofin.com/mcp`, then Connect. Return to **this**
conversation and make sure MosoFin is on for it. If sign-in lands on a
`localhost` page the browser can't reach, the host's callback didn't
complete — open the Connectors page and Connect again; don't retry the same
link.

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

1. Search the tools again — MosoFin's data tools may have just appeared.
2. Call `list_workspaces` **once**. Success → step 5; don't ask them to
   repeat their question.
3. Still missing or unauthorized → say exactly what you see (e.g.
   "`plugin:mosofin:mosofin` still needs authentication") and give the one
   next step. Allow **one** retry in total; then stop and point them to
   support@mosofin.com with the visible, non-secret status. A "signed in"
   browser page alone does not prove access.

If the original request is no longer visible in this conversation, ask what
they want to look at — never claim to remember a request you can't see.

## 5. Continue the request

Workspace confirmation is still mandatory after sign-in: read the workspace
name(s) back and get an explicit yes (see `/mosofin:workspaces`). Then carry
on with the held request through `/mosofin:query-workspace` or the matching
skill. If the user only asked to connect, say they're signed in, name the
workspaces they can see, and suggest one useful first question.

## Never

- Ask for, accept, or repeat passwords, tokens, authorization codes, or
  callback URLs in the chat. If a user pastes one, tell them not to and
  don't use it.
- Build OAuth or login URLs yourself, call MosoFin's HTTP endpoints directly,
  or write MCP configuration to work around a missing connection.
- Loop through repeated sign-ins, reinstalls, or new chats.
- Invent workspaces, companies, or figures while signed out, or answer from
  memory as if it were live data.
- Treat a MosoFin sign-in as fixing a disconnected company file, or the
  reverse.
