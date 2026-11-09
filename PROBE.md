# The MCP probe

A deployment that answers MCP calls exactly as production does, and keeps a redacted record of what each client sent.
It exists to answer questions no amount of reading can settle — whether a client carries `Mcp-Session-Id` across turns,
what it puts in `_meta`, which protocol version it speaks.

## Switching it on

The capture is inert unless `MCP_PROBE=1`. Set it on this branch's preview deployment only; anywhere else the route
behaves exactly as it does on `main` and nothing is written.

## Pointing a client at it

Use the branch's preview URL as the MCP server address, with `/mcp` as the path. Everything else about the server is
unchanged, so a session started here is a real session and a real person still has to join it.

## Reading what came in

    curl -s -H "Authorization: Bearer $CRON_SECRET" https://<preview-host>/api/probe | jq

`DELETE` on the same path empties the log, which is worth doing before each run so one client's traffic is easy to
read on its own. Entries are newest first, at most 200, and expire after a day.

## What it keeps, and what it refuses to

A client's own name for a caller — ChatGPT's `openai/subject`, or whatever another client sends — is a secret that
happens to be stable, so it is never stored. It is fingerprinted instead: the same value always marks the same way, so
a repeated fingerprint tells you a client holds that value steady across turns, which is the thing worth knowing,
without the probe holding the value itself.

Kept in the clear: HTTP method, response status, JSON-RPC method names, Valet tool names, `io.modelcontextprotocol/*`
metadata, and the few headers that say what a client is (`mcp-protocol-version`, `mcp-method`, `mcp-name`,
`content-type`, `accept`, `user-agent`).

Never kept: tool arguments, tool results, `Authorization`, `Cookie`. Other header values are recorded only as a
length. `Mcp-Session-Id` is fingerprinted, which is what makes "did this change between turns" readable.

## Keeping it honest

A probe that has drifted from `main` stops answering the question you are asking it, because it is no longer the
server your clients talk to. Rebase it onto `main` before trusting a run.
