# LLM Flow: improvement list and update plan

## Context

LLM Flow is a browser-only visual prompt-chain builder: a Next.js static export that calls OpenAI directly with a key kept in the browser. The last commit was on 4 November 2024. You asked for a list of everything that can be improved, with a focus on new models and new features. This file is that list, followed by the first batch I would implement.

**The urgent finding:** of the 21 models in the dropdown, 17 are already shut down by OpenAI. The other 4 (the `gpt-4o` and `gpt-4o-mini` family) are deprecated and shut down on **14 January 2027**. After that date no model in the app works.

**How this was checked**

- Code: three read-only exploration passes over all ~6.9k lines, plus my own reading of the LLM call path, the engine and the stores.
- OpenAI facts: the pricing, models, deprecations and Responses-migration pages, fetched on 13 November 2026 through a tool that summarises pages. Prices must be re-read from the pricing page when the registry is written.
- Not done: the app was not installed or run (`node_modules` is absent). Bugs marked "by reading" were not reproduced.

Each item has an ID so you can pick by ID (for example "do A, then E1 and B1").

---

## A. Models and the OpenAI API (urgent)

Current OpenAI text models, per the models and pricing pages (USD per 1M tokens, all with 1.05M context, 128K max output, text and image input):

| Model ID | Input | Cached input | Output | Reasoning effort values |
|---|---|---|---|---|
| `gpt-6-astra` (flagship) | 10.00 | 1.00 | 50.00 | low, medium, high, xhigh, max |
| `gpt-6.1-sol` | 2.00 | 0.10 | 10.00 | low, medium, high, xhigh, max |
| `gpt-6.1-terra` | 1.00 | 0.05 | 5.00 | none, low, medium, high, xhigh, max |
| `gpt-6-luna` | 0.10 | 0.01 | 0.50 | none, low, medium, high, xhigh, max |

- **A1. Replace the model list.** Add the four models above and the older ones still on the pricing page (`gpt-6-sol`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`). Remove the 17 dead ones and the completions-only models (`davinci-002`, `babbage-002`, `gpt-3.5-turbo-instruct`) that never worked on the chat endpoint.
- **A2. Model registry with real metadata.** Today each model is only `{title, name, tokenPrice}` in [lib/openai/index.ts](lib/openai/index.ts), and two models appear twice with different prices. Store input, cached and output prices, context window, max output, allowed reasoning efforts and parameter support.
- **A3. Stop the list going stale again.** Add a "custom model ID" field, and load the models the key can use from `GET /v1/models`.
- **A4. Fix the cost calculation.** It multiplies one price by total tokens. Example: `gpt-4o` is costed at $2.50 per 1M for every token, but its output tokens cost $10. Use separate input, cached and output prices, plus the higher long-context rates above 272K input tokens. Unknown models should show "unknown", not $0.
- **A5. Move from Chat Completions to the Responses API.** OpenAI recommends it for all new work, `gpt-6-astra` and `gpt-6.1-sol` require it for tool calling, and built-in tools exist only there. Responses stores requests by default, so the app must send `store: false` to keep its "nothing is saved on servers" promise.
- **A6. New parameters.** Add reasoning effort (options per model) and max output tokens. The app always sends `temperature` and `top_p`; send them only when changed, and hide them for models that reject them (to confirm per model in the API reference).
- **A7. Bugs in the call path** (all in [components/nodes/prompt.tsx](components/nodes/prompt.tsx) unless noted):
  - A temperature or top_p of 0 is sent as 1 (`|| 1`, lines 146-147).
  - Prompt and completion token counts are shown under each other's labels (lines 61, 180-181 against [stats.tsx](components/node_utils/stats.tsx) lines 42-43).
  - Every single `=` in a prompt is rewritten to `==` before it is sent, because prompts share `filterStatement` with condition code ([lib/logics.ts](lib/logics.ts) lines 14-26).
  - Any literal `{...}` in a prompt, such as a JSON example, is replaced by the text `undefined`, and object values become `[object Object]`.
  - `response_format` carries `json_schema` even when the type is text or `json_object`.
  - `JSON.parse` of the model output is unguarded, and `json_object` output fields never reach the value selector.
- **A8. Handle more response states.** Refusals, truncated output and empty output are not checked; only the first choice's text is read.
- **A9. Old flows that use dead models.** Show a warning on the node with the replacement OpenAI suggests, instead of a raw API error at run time.
- **A10. Sensible defaults.** New prompt nodes have no model and fail with "Model type is required"; the system prompt is mandatory. Give a default model and make the system prompt optional.

## B. New LLM features

- **B1. Streaming output** into the log panel and node, instead of waiting for the whole response.
- **B2. Real cancel, timeout and retry.** Stop only flips a flag; requests in flight keep running and still cost money. Add `AbortController`, a timeout, retry with backoff on 429 and 5xx, and a limit on parallel requests.
- **B3. More providers.** Anthropic Claude (`claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`), Google Gemini, and any OpenAI-compatible base URL (Ollama, OpenRouter, Azure, Groq). The intro slide already promises this. Needs a provider interface, per-provider keys and a `provider` field on the node.
- **B4. Image and file input** in prompts. All current models accept images; message content is string-only today.
- **B5. Tools.** Function calling, the built-in web search, file search and code interpreter, and remote MCP servers.
- **B6. Structured output upgrades.** Check OpenAI's strict-mode rules in the schema editor, expose nested fields in the value selector, add the missing description field, and offer a form-based schema builder next to the raw JSON.
- **B7. Usage detail.** Show cached and reasoning tokens in the stats.
- **B8. Flex tier option.** About half price for slower responses.
- **B9. Other model types as nodes:** image generation, speech, transcription, embeddings.

## C. Flow engine and node types (bugs here found by reading)

- **C1. Move the engine out of the React component.** It lives inside [components/layout/controllers.tsx](components/layout/controllers.tsx), so it can't be unit-tested or reused.
- **C2. Thread Merge can wait forever.** A node on a decision branch that wasn't taken stays `waiting`, so a merge fed by it polls every 200 ms with no end, and Stop does not break the loop ([thread_merge.tsx](components/nodes/thread_merge.tsx) lines 22-36).
- **C3. Condition errors are silent.** A broken decision or Set State expression is logged to the console and treated as `false` ([lib/logics.ts](lib/logics.ts) lines 49-52). Show it in the runtime log.
- **C4. Outputs that are advertised but never written:** Console Log's `name` and `log`, and Set State's `name`.
- **C5. Start node.** The checkbox input never shows as checked (it stores `"on"` but tests for `"yes"`), and the delete guard checks id `startNode` while the node's id is `start` ([lib/store.ts](lib/store.ts) lines 227, 248).
- **C6. Loop node.** For-each over a list, and repeat-until. There is no iteration today, and cycles are neither blocked nor supported.
- **C7. HTTP request node** to call other APIs.
- **C8. Code or transform node** (sandboxed in a Web Worker) and a plain text-template node.
- **C9. More control nodes:** sub-flow, delay, human approval or input, final output.
- **C10. Failure handling:** per-node retry and an on-error branch.

## D. Product features

- **D1. Multiple flows.** There is one canvas, with no names or list.
- **D2. Templates and example flows.** None exist.
- **D3. Run history.** Logs are wiped at each run; keep past runs and compare them.
- **D4. Compare models side by side.** The same prompt on several models with cost and latency.
- **D5. Test cases and evals.** Run a flow over a set of inputs (CSV) with checks on the output.
- **D6. Sharing and export.** Share a flow by link, and export a flow as code (TypeScript, Python, curl).
- **D7. Storage and file format.** Move from localStorage to IndexedDB, and add a version field and migrations to `.flow` files.
- **D8. Editor UX.** Auto-layout, minimap and zoom controls, node actions in the context menu (duplicate, delete, rename), a run shortcut, Cmd+Shift+Z for redo, node search, and inline markdown in logs.
- **D9. Dark mode.** The CSS variables exist but nothing toggles them, and components hardcode `bg-white`.
- **D10. Small screens.** No handling at all.
- **D11. Onboarding.** It cannot be closed before the last slide, and loads about 2 MB of GIFs on first visit.
- **D12. Typos:** "Multi Tread", "Show Tread Names".

## E. Security and privacy

- **E1. Replace `safe-eval`.** Decision and Set State expressions, including those from an imported `.flow` file, run as JavaScript through `safe-eval`, which has publicly reported sandbox escapes and no maintained fix (from memory, not re-checked today). A flow file from someone else could run code in the page and read the API key. Use an expression evaluator that does not call `eval`.
- **E2. API key handling.** The key is typed into a plain text field and kept in plain text in localStorage. Use a password field, and offer "this session only".
- **E3. Analytics.** Provider error messages are sent to Mixpanel (`flow_error`), there is no opt-out, and the settings dialog says nothing is saved on servers. Remove error text from events, add an opt-out, and move the token to an env var.
- **E4. Validate imported `.flow` files** with a schema before loading them.
- **E5. Content Security Policy** headers in a `netlify.toml`.

## F. Code health

- **F1. Tests.** There are none. Add Vitest for templating, cost and the engine, and a Playwright smoke test that uses the built-in Test API mode.
- **F2. CI.** There is none. Add lint, typecheck, test and build on GitHub Actions.
- **F3. Upgrades.** Next 14.2.13, React 18, Tailwind 3, ESLint 8 and zustand 5.0.0-rc.2 (a pre-release) are all behind. As a static export, most server-side Next advisories do not apply, so this is maintenance.
- **F4. Dependency cleanup.** Unused: `@krhsiung/react-flow-smart-edge`, `react-draft-wysiwyg` and its types, `@next/bundle-analyzer`. Six `@types/*` packages are in `dependencies`. `reactflow` (v11 types) and `monaco-editor` are imported but not declared.
- **F5. Replace draft-js,** which Meta has archived, with a maintained editor. That also allows variable chips and autocomplete when typing `{`.
- **F6. Deploy and docs.** `output: 'export'` is combined with `@netlify/plugin-nextjs`, there is no `netlify.toml`, and the README is the create-next-app text that says to deploy on Vercel.
- **F7. Performance.** Lazy-load Monaco and the rich editor, import lodash per method, and fix [components/ui/icon.tsx](components/ui/icon.tsx), which creates a new dynamic component on every render.
- **F8. Error boundary.** None exists, so one render error blanks the app.
- **F9. Metadata.** `og:image` points to `/logo.svg`, which is not in `public/`.
- **F10. Types.** `PromptData.response_schema` does not match `SchemaType`, and `temperature` and `top_p` are untyped.
- **F11. Accessibility.** Almost no ARIA labels outside the shadcn components.

---

## First batch to implement on approval: A1 to A10

Scope: OpenAI only, still browser-only and static. No new runtime dependencies. One dev dependency, Vitest, because this batch changes money and prompt handling and there are no tests.

1. **Registry** in a new `lib/openai/models.ts`: the model table from A1 and A2, `findModel(id)`, a map from dead model IDs to OpenAI's suggested replacement, and `usageToCost(usage, modelId)` using the existing `decimal.js-light`. Re-read prices from the pricing page at this step.
2. **Client** in [lib/openai/index.ts](lib/openai/index.ts): replace `chat` with a Responses call (`POST /responses`) and add `listModels()`. Mapping:
   - system prompt to `instructions`; the other messages to `input`
   - `response_format` to `text.format`, with the schema flattened to `{type: 'json_schema', name, strict, schema}` and omitted for text
   - `reasoning: {effort}`, `max_output_tokens`, `store: false`
   - read text from the `message` items in `output`; detect refusal and incomplete status
   - usage from `input_tokens`, `output_tokens` and their details (field names to confirm in the API reference)
   - update `OpenAiFaker` to return the same shape, so Test API mode keeps working
3. **Prompt node** in [components/nodes/prompt.tsx](components/nodes/prompt.tsx): build the new payload, fix `|| 1` with `??`, fix the token mapping, guard `JSON.parse`, expose `json_object` fields, add the reasoning effort select and max output input, show temperature and top_p only where supported, default model, optional system prompt, warning for dead models, custom model ID field.
4. **Templating** in [lib/logics.ts](lib/logics.ts): give prompts their own replace function that skips `filterStatement`, only replaces `{path}` when it is a reference path, stringifies objects as JSON, and leaves other braces untouched. Conditions and Set State keep the current behaviour.
5. **Stats** in [components/node_utils/stats.tsx](components/node_utils/stats.tsx) and the prompt `LogView`: correct labels, cost from the new function.
6. **Tests** in `lib/**/*.test.ts`: cost for each price tier, payload builder, output parser (text, JSON, refusal, incomplete), prompt templating with `=`, JSON braces and missing references.

Edge case to test: a node with a system prompt and no user message, which Chat Completions accepted.

## Verification

- `bun install`, then `bun run lint`, `bunx tsc --noEmit`, `bun run test`, `bun run build`.
- `bun dev` with Developer Mode and Test API on: run a flow with a text node and a `json_schema` node, and check the stats labels, the cost, and that a prompt containing `x = 1` and a JSON example is unchanged in the request.
- Live check, which needs your OpenAI key in Settings: one run on `gpt-6-luna` (text) and one on `gpt-6.1-sol` (`json_schema`, low effort). Confirm in the Network tab that the request goes to `/v1/responses` with `store: false`, and that the cost matches a hand calculation from the returned usage.

## Suggested order after this batch

1. E1, E2, E4, with F1 and F2 as the safety net.
2. B1 and B2 (streaming and cancel share the same request code), plus C2.
3. B3 (providers), then B4 and B5.
4. Pick from C6 to C10 and D by what you want the product to become.

## Sources

- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/deprecations
- https://developers.openai.com/api/docs/guides/migrate-to-responses
