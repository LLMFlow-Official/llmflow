# LLM Flow: UI/UX improvement plan

## Context

You asked for a plan to improve the UI and UX. Three code audits (app shell and first run, node editing, run and results) and a walk through the app in Chrome found about 150 issues. Five patterns cause most of the trouble:

1. **Red means everything.** The logo, normal buttons, 15 of the 24 node types and errors all use the same red. A failed node is a red box with a slightly fainter red ring, so failures don't stand out.
2. **The canvas hides what happened.** A selected node has no visible style. Running nodes are dimmer than idle ones. Every run mark is wiped 3 seconds after a run (`lib/run_flow.ts:107-110`).
3. **New users hit dead ends.** After an 8-slide intro they see one Start node. The free Test API is hidden under "Developer mode". Templates default to OpenAI even when the user only has a Claude key.
4. **Building is guesswork.** A new node lands on top of the last one, unconnected. A refused connection gives no reason. References show raw ids such as `{prompt_9f3a1c2b4d5e.assistant_raw_output}`, and a broken one quietly becomes empty text.
5. **Selecting a node hides the Run log and the tabs.** There is no Back button and no Escape. On phones, the panel covers the Run/Stop button and dropdowns.

**Decisions you made:**
- Design for non-coders first. Technical details (ids, raw output names, thread names) move behind Developer mode.
- Red is for the logo only. Buttons become neutral, nodes become neutral cards with a colour accent per category, and red means only error, stop or delete.
- Ask for analytics consent on the first visit. Nothing is sent before the visitor answers.

Work goes on main with one commit per phase, as before. Phase 0 is small and should ship first. Phases 1–5 each work on their own.

---

## Phase 0. Bugs found during the audit

| Bug | Where | Fix |
|---|---|---|
| ⌘/Ctrl+Enter answers a human-input prompt and then also stops the run | `components/node_utils/human_input_panel.tsx:57` and the window listener in `components/layout/controllers.tsx:58-68` | Call `stopPropagation` in the panel. The global handler ignores events from editable fields and open dialogs (the full fix is in Phase 5) |
| Multi Thread probably fails when it runs: it writes to `context[node.id]`, which the engine never creates; its name falls back to `'hi'` | `components/nodes/multi_thread.tsx:22` (and the same pattern in `thread_merge.tsx`) | Reproduce with an engine test, then write `context[node.id] = { ...(context[node.id] \|\| {}), name }` |
| Undo/redo and copy/paste key handlers attach to `.react-flow` once, so they can be missing or stale after a flow switch (`<ReactFlow key={revision}>`) | `components/node_utils/undo_redo.tsx:11`, `components/node_utils/flow_context_menu.tsx:138-162` | Re-attach when `useLibraryStore.revision` changes (replaced by the central hook in Phase 5) |
| On phones, the drawer (`z-60`) covers dialogs, dropdowns and popovers (`z-50`), the Run/Stop button and the human-input card | `components/layout/base_layout.tsx:50` | Drawer `z-40`. Run button and human-input card above it. Portaled overlays stay on top |
| **Export file** keeps MCP tokens and secret headers; the share link removes them | `components/layout/flow_menu.tsx:188-199` | Reuse the cleaning code in `lib/share.ts` and say what was removed |
| Settings throws away a pasted key when the dialog is closed without Save | `components/layout/settings.tsx:83,174` | Save each field as it changes (see Phase 4) |
| Confirm dialogs don't close on Escape and use generic "Confirm" | `components/ui/confirm_alert.tsx` | Connect `onOpenChange`. Add `confirmLabel` and `destructive` props, e.g. "Delete flow" |
| `bg-opacity-80` does nothing in Tailwind 4 | `node_shell.tsx:19`, `decision.tsx:211` | Removed in Phase 1 |

## Phase 1. Colours and node states

**Tokens** (`app/globals.css`, light and dark):
- `--primary`: neutral; near-black in light mode, near-white in dark.
- `--brand`: red, logo only.
- `--danger` (currently `--destructive`), `--success`, `--warning`, `--info`, `--running`.
- Category accents: `--node-ai`, `--node-logic`, `--node-data`, `--node-io`, `--node-start`.

Map them in `@theme` so classes like `bg-success` and `text-danger` work.

**Migration:**
- `components/ui/badge.tsx`, `toast.tsx` (with a working error style), `button.tsx`, `logo.tsx`, the Run button in `controllers.tsx`.
- Then the 136 hard-coded palette classes. The largest groups are in `model_select.tsx`, `schema_editor.tsx`, `prompt.tsx`, `start.tsx`, `set_state.tsx`, `flow_assistant_panel.tsx` and `test_cases.tsx`.
- Add a Vitest check that greps `components/` and `app/` for `(red|green|blue|amber|orange)-\d{3}` and allows only a short list of exceptions, so new hard-coded colours fail the tests.
- Also fix the hex scrollbar colours (`globals.css:141-151`, which ignore dark mode) and set the browser `themeColor` from the in-app theme.

**One node shell.**
- Move prompt, decision, multi_thread, thread_merge, start, console_log and set_state onto `components/node_utils/node_shell.tsx` and delete their 7 copied style tables.
- Each node type's `Metadata` gets a `category` (`ai | logic | data | io | start`) in `lib/nodes.ts`.

| State | Look |
|---|---|
| Idle | Neutral card, coloured left stripe and icon for its category, node name plus one short summary line (e.g. the model) |
| Selected | 2px ring in the foreground colour |
| Waiting | Slightly faded (70%) |
| Running | Full opacity with an animated `--running` ring; the animation is turned off when the system asks for reduced motion |
| Done | Small green check badge |
| Failed | `--danger` border, red tint and an error badge, at full opacity |
| Skipped | Dashed border, muted |
| Needs setup | Amber warning badge, from the pre-run check in Phase 3 |

**Run marks stay** until the next run starts or the flow is edited. Remove the 3-second reset (`lib/run_flow.ts:107-110`) and clear marks on the next run start or the next `onNodesChange`. Marks live in `useRuntimeStore.nodeStates`, not in the saved flow, so saving, undo and share links are not affected.

## Phase 2. Panel, top bar, feedback

**Side panel** (`components/layout/base_layout.tsx:25`, `components/node_utils/side_panel.tsx`):
- The tabs are always visible: **Build | Run log | History**, plus a **Step** tab that appears and is selected when a node is selected.
- You can switch to Run log without deselecting.
- Escape deselects the node.
- The "show this node" button in the Run log centres and highlights the node without leaving the log.
- What History is showing (the open run, the compare view) is kept in the existing tab store, so selecting a node doesn't reset it.
- A collapsed panel gets a reopen button, and its width is remembered with `autoSaveId`.
- On phones, the floating button says "Panel" and opens the Run log while a run is going.

**Top bar** (`components/layout/topbar.tsx`, `controllers.tsx`, `flow_menu.tsx`, `settings.tsx`):
- A labelled **"+ Add step"** button.
- A **Run** button with text, plus a ▾ for run inputs (Phase 4).
- **Share** and **Test cases** get their own buttons instead of hiding in the flow-name menu.
- Settings gets a gear icon instead of the lightning bolt.
- A save indicator next to the flow name: "Saved", "Saving…" or "Couldn't save" with Retry. Today save failures only go to the console (`lib/library.ts:162`).
- One icon size (18px) and one button size.
- The bar adapts to its panel's width (container queries), not the window's.

**Toasts** (`hooks/use-toast.ts`, `components/ui/toast.tsx`):
- Up to 3 at a time.
- Errors use the danger style and stay until closed.
- Optional action button, e.g. "Open Settings" for a missing key.
- Shown at the top centre so they never cover Run or the Build composer.
- The close button is always visible, which matters on touch screens.

## Phase 3. Building flows

**Add step** (`components/node_utils/new_node.tsx`):
- A compact list grouped by category (AI, Logic, Data, Input and output).
- Keyboard: arrow keys and Enter, with proper listbox roles.
- Search also matches the description.
- The new step goes below the selected node (or the last node in the chain), connects to it automatically when the connection rules allow, and is selected.
- Dragging a connection onto empty canvas opens the same list (`onConnectEnd` in `app/page.tsx`) and connects the chosen step.

**Connections** (`components/node_utils/thread_handle.tsx`, `lib/store.ts` `processNodeThread`):
- A refused connection shows a short reason, e.g. "Only Decision, Router, Loop and Run in parallel can have more than one next step".
- When the thread logic removes connections, a toast says how many and offers Undo.

**Plain names** (labels only; type ids stay the same so saved flows keep working):
- Multi Thread → "Run in parallel".
- Thread Merge → "Wait for all".
- Output labels such as `assistant_raw_output` → "Answer".
- The Node ID line in the settings header and the ids on log cards show only in Developer mode.

**References** (`components/ui/template_input.tsx`, `reference_suggestions.tsx`, `textarea.tsx`, `lib/references.ts`):
- Suggestions show "Summarize → Answer" first, with the raw path underneath.
- In the overlay, a reference to a missing or unconnected node is red.
- A "Uses:" line under each field lists every reference by node name, with broken ones flagged.
- The "Insert value" button shows when the field has focus (not only on hover) and inserts at the cursor instead of the end.
- Deleting a node that others use asks first: "Used by 2 steps".
- Start inputs can be referenced before they have a value (`start.tsx:46`).
- New nodes get short readable ids (`prompt_2`); existing flows keep theirs.

The overlay text must stay identical to the field value, so references remain visible as text and are not turned into chips.

**Pre-run check**, a new `lib/flow_check.ts` with `checkFlow(nodes, edges, settings)`:
- Each node module may export a `validate(node)` that returns problems. This replaces the "… is required" errors that today only fire inside `Process` (about 17 of them, e.g. `llm_router.tsx:75-82`).
- Graph checks:
  - `validateGraph` (`lib/engine.ts`)
  - nodes that can't be reached from Start
  - references to unknown or later nodes (reuse the reference matching in `lib/assistant/flow_assistant.ts`)
  - empty Start inputs that are used somewhere
  - a missing API key for any provider the flow uses
- Shown live as a warning badge on each affected node and a "2 problems" chip next to Run; clicking a problem jumps to the node. Problems are worked out again for nodes whose data changed only, so it stays cheap.
- On Run, problems block the run with a list. Warnings, such as an empty optional input, let it run.
- The Build assistant can call the same function later.

**Step settings forms:**
- AI Prompt starts with one empty user message. The order becomes Prompt → Model → **Advanced** (collapsed: format, reasoning, processing, max tokens, sampling, images, tools).
- One `ModelSelect` for every AI node, including image, transcription, embeddings and compare. Providers that can't do the task are disabled, e.g. web search on a compatible server.
- "On failure" appears only on nodes that call something that can fail.
- Mark "Optional" the same way everywhere.
- Link all 33 unlinked labels to their inputs, and fix the duplicate `id="prompt"`.
- Every text field can be resized and opened in the larger editor. The larger editor keeps plain text plain instead of converting it to Markdown.
- The Code node uses Monaco, following the light or dark theme.
- Fix the wording issues found in the audit (e.g. "Please add a your initial values", "Log has send", "threads ends", "Json Editor").

## Phase 4. Running and results

**Before a run.**
- If Start has inputs, Run ▾ opens a small form with them, filled in from the last values.
- The pre-run check from Phase 3 runs first.
- Provider errors become advice (`lib/providers/http.ts`):
  - 401/403 → "Your key was rejected", with an Open Settings button.
  - 429 → "Rate limit or quota reached", with a link to retry settings.
  - 5xx → "The provider had a problem, try again".

**During a run.**
- The human-input card becomes a focused dialog in every mode, with a labelled text box.
- Approve uses the neutral primary button; Reject stops that branch and is recorded as "Rejected", not as a failure.
- The Run log shows an unread dot when it isn't the visible tab.
- A loop shows "3 of 10" on its node.

**After a run.**
- A summary at the top of the Run log: Completed / Failed at "Node" (with a link) / Stopped / Waiting for your input, plus cost and time. It is a live region, so screen readers announce it.
- A toast when a run finishes.
- Final Output cards use normal-size text and taller boxes, with labelled Copy and Download buttons.
- The log scrolls to new entries.
- Cost is shown as "$0.0012" instead of six zero-padded decimals.

**History** (`components/node_utils/run_history.tsx`):
- "Run again with these inputs" and "Copy inputs to Start".
- Each run saves a copy of the flow, with "Restore this version".
- Compare opens in a wide dialog, shows each run's inputs and highlights differences.
- Deleting a run asks first.

**Test cases** (`components/layout/test_cases.tsx`):
- Show the real reason a run couldn't start (today `notify` does nothing there).
- Keep results until the next test run.
- Link each result row to its log.
- Explain that flows with a human-input step can't run as tests.

**Build assistant:**
- Save chats per flow in IndexedDB, next to run history.
- If the flow was changed after the assistant's edit, Undo warns before throwing those changes away.
- On error, put the request back in the box and show Retry.
- List the changed steps as clickable names.
- When there's no key, show "Open Settings" and "Use sample answers" buttons.

## Phase 5. First visit, settings, shortcuts

**Sample answers mode.**
- Rename the Test API to "Sample answers (free)" and move it out of Developer mode.
- A switch for it in Settings, the Build panel and the missing-key error.
- A badge in the top bar while it's on.

**Intro** (`components/layout/intro_slider.tsx`):
- 4 slides with a step indicator and Skip on every slide.
- Sentence case and plain wording.
- The last slide offers "Try an example", "Describe it in Build" and "Start from scratch", plus the analytics question.
- `lib/analytics.ts` sends nothing until the visitor answers.
- Move the GIFs to smaller video files, and cap the dialog's height so it fits short screens.

**Empty canvas.** A card next to Start with three example flows, "Describe it in Build →" and "+ Add step".

**Templates** (`lib/templates.ts`):
- Use the provider the user has a key for, through the same choice code as `assistantModel()` in `lib/assistant/run_assistant.ts`.
- Each template card says what it needs, e.g. "Needs OpenAI (embeddings)" or "Needs 3 providers".

**Settings** (`components/layout/settings.tsx`):
- Fields save as you change them, with a small "Saved" note.
- Each provider gets a "Get a key" link and a "Test key" button.
- Sections are clearly separated: Keys, Running, Privacy, Appearance (theme moves here), Developer.
- The help text for "Remember keys" explains that keys are stored on this device.

**Shortcuts.** A new `hooks/use_shortcuts.ts` with one registry.
- By default a shortcut is ignored while a dialog is open or focus is in an editable field; a shortcut can opt in.
- It replaces the handlers in `controllers.tsx`, `undo_redo.tsx`, `flow_context_menu.tsx` and `find_node.tsx`.
- A "Keyboard shortcuts" dialog opens with `?` and from the help menu.

**Also:**
- An `app/not-found.tsx` page.
- Apply the dark theme before the first paint (a small inline script in `app/layout.tsx`).
- Serve the font locally (`next/font`) instead of calling Google Fonts.
- Accessibility:
  - names on the icon-only buttons the audit listed
  - `asChild` on the Stats tooltips
  - calmer live regions (the streaming card and the assistant list)
  - reduced-motion styles

---

## Verification

Each phase:
- `bun run lint`, `bunx tsc --noEmit`, `bun run test`, `bun run build`, `bunx playwright test`.
- A manual pass in Chrome at 1440×900, 1024×768 and 375×812, in light and dark mode, using Sample answers and the local fake server from earlier for the Claude/OpenAI paths.

New tests:
- **Unit:**
  - `checkFlow`: missing fields, unreachable node, broken reference, missing key
  - shortcut scoping (ignored in text fields and dialogs)
  - Export cleaning
  - short id generation
  - the Multi Thread run
  - the colour-class check
- **e2e** (`e2e/smoke.spec.ts`; existing role names such as "Run the flow", "Flows menu" and the tab names are kept or updated in the same commit):
  - add a step with the keyboard; it is connected and selected
  - the pre-run check blocks a run and jumps to the node
  - ⌘+Enter in a human-input prompt doesn't stop the run
  - a failed mark stays after the run
  - the Step tab plus Escape
  - on a phone viewport, Run and dropdowns are usable with the panel open
  - the first visit: consent, then "Try an example", then a run with sample answers, with no key
- Turn the axe colour-contrast rule back on (`e2e/smoke.spec.ts:82`) once Phase 1 lands.

Not covered: real provider keys. Phase 4's error advice is tested against the local fake server's 401/429/500 responses.
