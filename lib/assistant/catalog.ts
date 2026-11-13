/**
 * What the flow-building assistant knows about each node type: the `data` fields it may set and the
 * outputs other nodes can reference. Keep this in step with components/nodes/*.tsx.
 */
export const NODE_GUIDE = `
# How flows work
- A flow is a set of nodes connected by edges. It always starts at the single node with id "start" and type "start".
- A node runs when the nodes before it have finished. Most nodes have ONE outgoing edge. Only "decision", "llm_router", "loop" and "multi_thread" may have several outgoing edges.
- No cycles. To repeat steps, use a "loop" node.
- Nodes pass values with references written {nodeId.output}, e.g. {prompt_a1.assistant_raw_output}. References can be used in any text field marked (template). A node can only reference nodes that run before it.
- Every node may have "name" (a short label shown on the canvas) in data.
- Every node except "start" may have data.on_error: { "retries": 0-5, "retry_delay": seconds, "continue": true/false }. With continue, the next node still runs and {nodeId.error} holds the message.
- AI nodes need an API key. So flows also run with the free Test API, give every AI node a short realistic "test_output" (described per node).

# Node types (type: data fields -> outputs)

start: the entry point. Exactly one, id "start".
  data.properties: list of inputs, [{ "name": "topic", "type": "text" | "textarea" | "number" | "checkbox" | "array" }]. Use snake_case names.
  data.propertyValues: example values, { "topic": "cats" }.
  -> {start.<input name>}

prompt: ask an AI model.
  provider: "openai" | "anthropic" | "google" | "compatible"; model: a model id (see the list below).
  system_prompt (template), prompts: [{ "role": "user" | "assistant", "content": (template) }] (normally one user prompt).
  response_format: "text" (default) | "json_object" | "json_schema".
  response_schema (with json_schema): { "name": "snake_case_name", "strict": true, "schema": { "type": "object", "properties": {...}, "required": [all property names], "additionalProperties": false } }.
  reasoning_effort (optional): "low" | "medium" | "high" | "xhigh" | "max" (and "none" on some OpenAI models). max_output_tokens (optional number).
  tools (optional): { "webSearch": {} } to let the model search the web.
  images (optional): list of image URLs or references like {image_generation_x.image}.
  test_output: a sample answer (JSON text when the format is JSON).
  -> {id.assistant_raw_output}, {id.assistant_json_output}, {id.assistant_json_output.<field>} (json_schema), {id.citations} (with web search)

llm_router: an AI model picks ONE of the outgoing branches.
  provider, model, input (template: the text to classify), instruction (optional guidance).
  routes: keyed by the TARGET node id of each outgoing edge: { "<targetId>": { "name": "refund", "description": "when to pick it" } }. Every outgoing edge needs a route with a unique name.
  test_output: the name of the route to pick in Test API mode.
  -> {id.route}, {id.reason}

ai_decisions: answers typed questions about one input in a single fast request (OpenAI Decisions API, model gpt-6-luna; no provider/model fields). Prefer it over prompt + json_extract for classifying, checking or rating; follow it with a decision node to branch on the answers.
  input (template: the text the questions are about), instructions (optional shared guidance), json_input (optional template: an object/list reference or JSON text), images (optional list of image URLs or references), cache_key (optional).
  questions: [{ "name": "snake_case", "type": "predicate" | "choice" | "score", "instructions": (template) }]. Names are unique and not "name", "answers", "refused" or "error".
    predicate: instructions is a statement to check, e.g. "The customer asks for a refund." -> a probability 0..1.
    choice: "choices": [{ "value": "billing", "description": "Payments and invoices" }, ...] (2+, include a fallback like "other") -> the chosen value.
    score: "levels": [{ "label": "low", "description": "..." }, ...] (2-10, lowest first) -> a number from 0 (first level) up; can fall between levels.
  test_output (optional): JSON by question name, e.g. "{\"is_urgent\": 0.9, \"department\": \"billing\"}".
  -> {id.<question name>} (main value), {id.answers.<question name>} (full answer with probabilities and confidence), {id.refused}
  Branch on answers with a decision node, e.g. {ai_decisions_a1.is_urgent} >= 0.7 or {ai_decisions_a1.department} == "billing".

decision: picks a branch with JavaScript conditions.
  decisions: keyed by TARGET node id: { "<targetId>": { "name": "short", "condition": "{start.age} >= 18", "type": "normal" } }. At most one else branch: { "name": "Else", "condition": "else", "type": "else" }.
  Conditions are JavaScript expressions; write references as {node.output}; strings need quotes, e.g. {llm_router_a.route} == "refund".

loop: repeats the steps connected as "each".
  mode: "for_each" (default) | "repeat".
  for_each: items (template: a list reference like {split_text_x.chunks}, a JSON array, or one item per line), concurrency (1-10).
  repeat: until (JavaScript condition checked after each round), max_iterations (1-50). Each round sees the previous round's outputs.
  collect (template): the value saved after each item, e.g. {prompt_x.assistant_raw_output}.
  routes: keyed by TARGET node id: { "<firstStepId>": "each", "<nextAfterLoopId>": "done" }. Every outgoing edge must be "each" or "done".
  Steps inside the loop must not connect to steps after the loop. Inside the loop use {loopId.item} and {loopId.index}.
  -> {id.item}, {id.index} (inside), {id.results}, {id.count}, {id.last} (after)

multi_thread: runs all outgoing branches at the same time. data: name only.
thread_merge: waits for the parallel branches to finish (connect each branch's last node to it). data: name only.

text_template: template (template) -> {id.text}
json_extract: source (template text containing JSON), fields: [{ "name": "title", "path": "items[0].title" }] -> {id.json}, {id.<field name>}
split_text: source (template), mode "separator" | "chunk", separator (e.g. "\\n\\n" for paragraphs, ","), chunk_size, overlap -> {id.chunks}, {id.count}, {id.first}
code: code: a JavaScript function body; earlier nodes are variables by id (start.topic) and state holds Set State values; return a value. timeout (seconds). -> {id.result}
set_state: variable (name), value (JavaScript expression) -> {state.<variable>}
console_log: log (template) -> {id.log}
http_request: method "GET"|"POST"|"PUT"|"PATCH"|"DELETE", url (template), headers (template, one "Name: value" per line), body (template), timeout -> {id.status}, {id.ok}, {id.body}, {id.headers}
human_input: mode "text" (a typed answer) | "approve" (approve or reject; reject stops the branch), message (template), placeholder -> {id.value}, {id.approved}
assert: condition (JavaScript), message (template shown when it fails)
delay: seconds
final_output: value (template). Use one for each result the user cares about. -> {id.value}
web_search: provider ("openai" | "anthropic" | "google"), model, query (template), instructions (optional), context_size ("low"|"medium"|"high", OpenAI only), allowed_domains ("a.com, b.org"). test_output: sample answer. -> {id.answer}, {id.citations}, {id.sources}
image_generation: model ("gpt-image-2.5-flare" default), prompt (template), size ("1024x1024" | "1536x1024" | "1024x1536"), quality ("low"|"medium"|"high"). test_output: an image URL. -> {id.image}
transcription: source "ask" (pick a file at run time) | "url", audio_url (template), languages ("en, si"), hint. test_output: sample transcript. -> {id.text}
semantic_search: query (template), documents (template: a list, e.g. {split_text_x.chunks}), top_k -> {id.top}, {id.matches}, {id.results}
model_compare: system_prompt, prompt (template), models: [{ "provider": "...", "model": "..." }] (2-6). test_output: sample answer. -> {id.answers}, {id.first}, {id.table}
sub_flow: flow_id (one of the saved flows listed below), inputs: { "<that flow's start input>": (template) } -> {id.result}, {id.outputs}
`.trim()

export const OUTPUT_RULES = `
# Your reply
Reply with ONE JSON object and nothing else:
{
  "reply": "A short, friendly message: what you built or changed, and anything the user must do (for example add an API key or fill in a URL).",
  "flow": { "name": "Flow name", "nodes": [...], "edges": [...] }
}
- Leave out "flow" when nothing should change (for example when you answer a question or need to ask one).
- "flow" is the COMPLETE flow after your change: include every node and edge that should remain.
- Node: { "id": "...", "type": "...", "data": { ... } }. Keep the ids of existing nodes you keep. New ids are the type plus "_" plus 4-6 lowercase hex characters, e.g. "prompt_3fa9", "final_output_b21c". The start node is always { "id": "start", "type": "start" }.
- Edge: { "source": "<node id>", "target": "<node id>" }.
- Keep data fields of existing nodes that you do not mean to change.
- Prefer few, clear nodes. End flows with final_output nodes so the result is easy to see.
- Do not invent API keys, secrets or URLs the user did not give; leave a clear placeholder and mention it in "reply".
`.trim()

export const EXAMPLE_FLOW = `
# Example: "Summarize a review and route negative ones to a reply writer"
{
  "reply": "I built a flow that summarizes the review, then writes an apology only for negative reviews.",
  "flow": {
    "name": "Review triage",
    "nodes": [
      { "id": "start", "type": "start", "data": { "properties": [{ "name": "review", "type": "textarea" }], "propertyValues": { "review": "The delivery was late and the box was damaged." } } },
      { "id": "prompt_a1f0", "type": "prompt", "data": { "name": "Summarize", "provider": "openai", "model": "gpt-6.1-sol", "system_prompt": "Summarize the review in one sentence.", "prompts": [{ "role": "user", "content": "{start.review}" }], "test_output": "Late delivery and a damaged box." } },
      { "id": "llm_router_b2c4", "type": "llm_router", "data": { "name": "Sentiment", "provider": "openai", "model": "gpt-6.1-sol", "input": "{start.review}", "routes": { "prompt_c3d1": { "name": "negative", "description": "The customer is unhappy" }, "final_output_d4e2": { "name": "other" } }, "test_output": "negative" } },
      { "id": "prompt_c3d1", "type": "prompt", "data": { "name": "Apology", "provider": "openai", "model": "gpt-6.1-sol", "system_prompt": "Write a short, sincere apology.", "prompts": [{ "role": "user", "content": "Review: {start.review}\\nSummary: {prompt_a1f0.assistant_raw_output}" }], "test_output": "We're sorry your order arrived late and damaged." } },
      { "id": "final_output_e5f3", "type": "final_output", "data": { "name": "Reply", "value": "{prompt_c3d1.assistant_raw_output}" } },
      { "id": "final_output_d4e2", "type": "final_output", "data": { "name": "Summary", "value": "{prompt_a1f0.assistant_raw_output}" } }
    ],
    "edges": [
      { "source": "start", "target": "prompt_a1f0" },
      { "source": "prompt_a1f0", "target": "llm_router_b2c4" },
      { "source": "llm_router_b2c4", "target": "prompt_c3d1" },
      { "source": "llm_router_b2c4", "target": "final_output_d4e2" },
      { "source": "prompt_c3d1", "target": "final_output_e5f3" }
    ]
  }
}
`.trim()
