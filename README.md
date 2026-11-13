# LLM Flow

Build, test and compare AI workflows in the browser, without code. Connect prompts, branches, loops
and tools on a canvas, run them against OpenAI, Anthropic (Claude), Google (Gemini) or any
OpenAI-compatible server, and see the tokens, cost and time of every step.

Everything runs in your browser. Flows, run history and API keys stay on your device; requests go
straight from the browser to the AI provider you chose.

## Features

- **Providers:** OpenAI (Responses API), Anthropic (Messages API, official SDK), Google Gemini, and
  OpenAI-compatible servers such as Ollama, OpenRouter, Groq or Azure.
- **Nodes:**
  - AI and tools: AI Prompt (with images, tools, structured JSON output), LLM Router, Web Search,
    Image Generation, Transcription, Semantic Search, Model Compare
  - Flow control: Decision, Loop, Multi Thread, Thread Merge, Human Input, Assert, Delay, Sub-flow
  - Data: Text Template, JSON Extract, Split Text, Code (sandboxed JavaScript), HTTP Request,
    Set State, Console Log, Final Output
- **Running:** answers stream in live; Stop cancels requests in flight; rate limits and server errors
  are retried; per-node retries and continue-on-error; a parallel request limit.
- **Testing:** a free Test API (Developer mode) that returns fixed answers; test cases from CSV
  with pass/fail checks; run history with side-by-side comparison.
- **Organising:** many flows with autosave, templates, `.flow` file import/export, share links,
  and "View as code" (cURL, TypeScript, Python) for prompts.

## Getting started

Requires [Bun](https://bun.sh) (or Node.js 20+ with npm).

```bash
bun install
bun dev            # http://localhost:3000
```

Open Settings to add an API key, or turn on **Developer mode → Use Test API** to try everything
without one.

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Development server |
| `bun run build` | Static export to `out/` |
| `bun run lint` / `bun run lint:ci` | ESLint (the first one fixes what it can) |
| `bun run typecheck` | TypeScript |
| `bun run test` | Unit tests (Vitest) |
| `bun run test:e2e` | Browser tests (Playwright) against `out/`, served with the `netlify.toml` headers. Run `bun run build` first; `bunx playwright install chromium` once. |
| `ANALYZE=true bun run build` | Bundle size report |

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_MIXPANEL_TOKEN` | Mixpanel project token for anonymous usage analytics (see `.env`). Leave empty to turn analytics off. Users can also opt out in Settings. |

## Deploying

The app is a static site (`output: 'export'`); any static host works. The output is the `out/`
folder.

On Netlify, `netlify.toml` adds the security headers, including a Content Security Policy that
allows the AI providers, the Monaco editor CDN and Google Fonts. If you serve the site elsewhere,
copy those headers to your host's configuration.

## Project layout

| Path | Contents |
| --- | --- |
| `app/` | Next.js entry: layout, metadata, error screens |
| `components/nodes/` | One file per node type: its settings panel, canvas look and `Process` function |
| `components/layout/`, `components/node_utils/` | Top bar, flows menu, side panel, run log, history, dialogs |
| `lib/engine.ts` | Runs a flow: branching, skipping, joins, retries, loops |
| `lib/run_flow.ts` | Runs the open flow in the editor, sub-flows and test cases |
| `lib/providers/` | Requests to each AI provider, streaming, retries, cost |
| `lib/openai/models.ts` | Model list, prices, deprecations |
| `lib/library.ts` | Flow library and run history (IndexedDB) |
| `lib/code_runner.ts` | Sandboxed JavaScript (Web Worker) for Code nodes and conditions |
| `e2e/` | Browser tests |

### Adding a node type

Create `components/nodes/<name>.tsx` exporting `Metadata`, `Node`, `Properties`, `Process` (and
optionally `Outputs` and `LogView`), then register it in `lib/nodes.ts`. The helpers in
`components/node_utils/node_shell.tsx` cover the canvas look and common fields.

## Keeping models and prices current

Model IDs, prices and shutdown dates live in `lib/openai/models.ts`, with the date and source
pages they were read from. Check those pages when updating.
