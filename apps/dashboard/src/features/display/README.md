# AI display

The Overview's second view (the switch at the top left; key `L`), in place of the former
equipment list (equipment records are in Engineering). It shows what the assistant
retrieved, so a question such as "Show me COP today" no longer moves the operator to
another screen.

## How data reaches it

1. The assistant calls one tool, `show_on_display`. Its MCP definition (name,
   description, JSON input schema) is `SHOW_ON_DISPLAY_TOOL` in
   [`lib/contracts/display.ts`](../../lib/contracts/display.ts); the schema is generated
   from the payload's own zod schema.
2. The harness streams each call as a `display` event (`lib/contracts/agent.ts`). The
   conversation session validates it and hands it to the app (`app/openTarget.ts`,
   `showOnDisplay`), which stores it here (`displayStore.ts`) and switches the Overview
   to the AI display, from any screen.
3. The chat shows "Shown on the AI display: …" with **Show** to bring it back.

The demo assistant (no language model) already calls the tool for trends, demand and
delivery, the forecast and electrical load by equipment. A local model harness exposes
the same tool through MCP; see `src/hvac_agent/agent/README.md`. That harness is not built.

## What it can show

| Kind | Drawn by |
|---|---|
| `line` | `TimeSeriesChart`: up to six series (dashed for estimates) and an optional band |
| `bar` | `BarChart`: one value per category |
| `table` | A data table; cells are text or numbers, never markup |
| `stats` | A few headline figures |
| `image` | A base64 PNG, JPEG or WebP `data:` URI, never a link to fetch |
| `html` | A page the model wrote, in an `<iframe sandbox="allow-scripts">` with no same-origin access and a content security policy that blocks the network |

The newest item replaces what is shown; the last 20 stay under "Shown earlier", kept for
the tab's session. With nothing shown the display says nothing has been queried yet.
