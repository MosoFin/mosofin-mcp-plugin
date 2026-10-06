---
name: connect
description: Sign in to MosoFin from the conversation and continue the user's request. Use when MosoFin tools are missing, a call returns Unknown tool or an authentication error, the MosoFin server needs authentication, the user asks how to connect or sign in to MosoFin, or the user says they finished signing in.
allowed-tools:
  - mcp__plugin_mosofin_mosofin__list_workspaces
---

# Sign in to MosoFin

MosoFin is a remote MCP server at `https://mcp.mosofin.com/mcp` using OAuth
(DCR + PKCE). The **host** (Claude Code, Claude Desktop/Cowork, ChatGPT, Grok
Build, …) owns sign-in and stores the tokens. This plugin ships no helper,
client id, or callback: the job here is to get the user through their host's
own sign-in with as few steps as possible, then resume what they asked.

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
| This plugin in Claude Code / Grok Build | `mcp__plugin_mosofin_mosofin__list_workspaces` |
| A MosoFin connector added in Claude (claude.ai, Desktop, Cowork) | `mcp__MosoFin__list_workspaces` or similar |
| ChatGPT / Codex app | `mosofin.list_workspaces` |

If one exists, call `list_workspaces`. If it succeeds, the user is signed in:
go to step 5. Do not start a sign-in "to be sure". If both the plugin and a
connector are present, use one consistently for the whole task; they may be
signed in as different MosoFin users, so if their workspace lists differ, ask
which account to use.

A loaded skill does not prove the connection works, and a missing tool does
not prove the user's login expired. Report what you actually see.

## 3. Get the user signed in

Pick the row for the host you are running in and give **only** that next
step — not every host's instructions.

### Claude Code (terminal, IDE, Desktop Code tab)

- **A MosoFin authentication tool is offered** (some hosts expose one, e.g.
  named `authenticate` on the `mosofin` server, when it needs sign-in): call
  it **once**. Show the URL it returns as a short link —
  **[Sign in to MosoFin](<returned URL>)** — and say: "Sign in, then come back
  here and say *done*; I'll pick up where we left off." Never paste the raw
  long URL, construct or edit a URL, or call the tool again while waiting.
- **No such tool:** ask the user to run `/mcp`, select
  **`plugin:mosofin:mosofin`** (it shows *Needs authentication*), and choose
  **Authenticate**. The browser opens; after approving, return here.
- **Browser can't open** (SSH, container, remote box): from a shell,
  `claude mcp login plugin:mosofin:mosofin --no-browser`, open the printed
  link anywhere, then paste the final callback URL back into **that
  terminal** — not into this chat.
- **`plugin:mosofin:mosofin` is not listed in `/mcp`:** the plugin isn't
  installed or enabled in this scope —
  `/plugin marketplace add mosofin/mosofin-mcp-plugin`, then
  `/plugin install mosofin@financehub`, then restart Claude Code.
- **It still shows failed right after signing in:** some Claude Code versions
  hold a failed sign-in for about 15 minutes. Choose **Authenticate** again in
  `/mcp`, or restart Claude Code. Never edit or delete auth or cache files.

### Claude Desktop, Cowork, claude.ai

Ask the user to open **Settings → Connectors** (or the **+** button in the
prompt box → Connectors), find **MosoFin**, and choose **Connect**. If MosoFin
isn't listed, add a custom connector with URL `https://mcp.mosofin.com/mcp`,
then Connect. After approving in the browser, return to **this** conversation
and make sure MosoFin is turned on for it.

If the host offers its own authentication tool or link, use that once
instead, as above. If sign-in lands on a `localhost` page the browser can't
reach, the host's callback did not complete: use the Connectors page above
rather than retrying the same link.

### ChatGPT / Codex

1. ChatGPT web → **Settings → Apps & Connectors** (or chatgpt.com/plugins).
2. Turn on **Developer mode** if adding a custom connector (Settings →
   Security and login, or Apps → Advanced settings).
3. Create **MosoFin** — URL `https://mcp.mosofin.com/mcp`, Authentication
   **OAuth** — and complete sign-in.
4. Start a **new** chat with the MosoFin app turned **on**, then ask again.
   (ChatGPT cannot add tools to an existing chat, so this is the one host
   where the user must restate the request — offer to give them a ready-to-
   paste version of it.)

### Grok Build

Install `mosofin` from the xAI plugin marketplace and complete the sign-in it
prompts for, then return here.

## 4. When the user comes back

When the user says *done*, *signed in*, *continue*, or similar:

1. Search the tools again — they may have just appeared.
2. Call `list_workspaces` **once**.
3. Success → step 5. Do not ask them to repeat their question.
4. Still missing or still unauthorized → say exactly what you see (e.g.
   "`plugin:mosofin:mosofin` is still not exposing tools") and give the one
   next step for this host. Allow **one** retry of sign-in in total; after
   that, stop and point them to support@mosofin.com with the visible,
   non-secret status or error text.

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
