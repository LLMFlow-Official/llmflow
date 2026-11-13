import { buildOpenAiBody } from './providers/openai'
import { buildAnthropicParams } from './providers/anthropic'
import { buildGeminiBody } from './providers/google'
import { buildCompatibleBody } from './providers/compatible'
import type { ChatRequest } from './providers/types'

/**
 * Code that sends the same request as an AI Prompt node, for using a prompt outside LLM Flow.
 * {node.value} placeholders are kept as written, for the reader to fill in.
 */

export type CodeSample = { language: 'curl' | 'typescript' | 'python', label: string, code: string }

const json = (value: unknown) => JSON.stringify(value, null, 2)

/** JSON value as a Python literal. */
export function toPython(value: unknown, indent = 0): string {
    const pad = '    '.repeat(indent + 1)
    const end = '    '.repeat(indent)
    if (value === null || value === undefined) return 'None'
    if (value === true) return 'True'
    if (value === false) return 'False'
    if (typeof value == 'number') return String(value)
    if (typeof value == 'string') return JSON.stringify(value)
    if (Array.isArray(value)) {
        if (!value.length) return '[]'
        return `[\n${value.map(v => pad + toPython(v, indent + 1)).join(',\n')},\n${end}]`
    }
    const entries = Object.entries(value as Record<string, unknown>)
    if (!entries.length) return '{}'
    return `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${toPython(v, indent + 1)}`).join(',\n')},\n${end}}`
}

/** Keyword arguments for a Python call, e.g. model="x", max_tokens=100. */
const pythonKwargs = (params: Record<string, unknown>) =>
    Object.entries(params).map(([k, v]) => `    ${k}=${toPython(v, 1)},`).join('\n')

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`

export function codeSamples(request: ChatRequest, options: { baseUrl?: string } = {}): CodeSample[] {
    if (request.provider == 'openai') {
        const body = buildOpenAiBody(request)
        return [
            { language: 'curl', label: 'cURL', code: `curl https://api.openai.com/v1/responses \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -d ${shellQuote(json(body))}` },
            { language: 'typescript', label: 'TypeScript', code: `import OpenAI from "openai";\n\nconst client = new OpenAI(); // reads OPENAI_API_KEY\n\nconst response = await client.responses.create(${json(body)});\n\nconsole.log(response.output_text);` },
            { language: 'python', label: 'Python', code: `from openai import OpenAI\n\nclient = OpenAI()  # reads OPENAI_API_KEY\n\nresponse = client.responses.create(\n${pythonKwargs(body)}\n)\n\nprint(response.output_text)` },
        ]
    }

    if (request.provider == 'anthropic') {
        const params = buildAnthropicParams(request) as Record<string, unknown>
        const { betas, ...body } = params as { betas?: string[] } & Record<string, unknown>
        const hasBetas = !!betas?.length
        const ns = hasBetas ? 'client.beta.messages' : 'client.messages'
        return [
            {
                language: 'curl', label: 'cURL',
                code: `curl https://api.anthropic.com/v1/messages \\\n  -H "content-type: application/json" \\\n  -H "x-api-key: $ANTHROPIC_API_KEY" \\\n  -H "anthropic-version: 2026-10-21" \\\n${hasBetas ? `  -H "anthropic-beta: ${betas!.join(',')}" \\\n` : ''}  -d ${shellQuote(json(body))}`,
            },
            {
                language: 'typescript', label: 'TypeScript',
                code: `import Anthropic from "@anthropic-ai/sdk";\n\nconst client = new Anthropic(); // reads ANTHROPIC_API_KEY\n\n// Streaming avoids HTTP timeouts on long answers; finalMessage() returns the whole message.\nconst message = await ${ns}.stream(${json(params)}).finalMessage();\n\nif (message.stop_reason === "refusal") {\n  console.error("Claude declined this request");\n} else {\n  for (const block of message.content) {\n    if (block.type === "text") console.log(block.text);\n  }\n}`,
            },
            {
                language: 'python', label: 'Python',
                code: `import anthropic\n\nclient = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY\n\n# Streaming avoids HTTP timeouts on long answers.\nwith ${ns}.stream(\n${pythonKwargs(params)}\n) as stream:\n    message = stream.get_final_message()\n\nif message.stop_reason == "refusal":\n    print("Claude declined this request")\nelse:\n    for block in message.content:\n        if block.type == "text":\n            print(block.text)`,
            },
        ]
    }

    if (request.provider == 'google') {
        const body = buildGeminiBody({ ...request, images: [] })
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`
        return [
            { language: 'curl', label: 'cURL', code: `curl "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "x-goog-api-key: $GEMINI_API_KEY" \\\n  -d ${shellQuote(json(body))}` },
            { language: 'typescript', label: 'TypeScript', code: `const response = await fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },\n  body: JSON.stringify(${json(body)}),\n});\nconst data = await response.json();\nconsole.log(data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join(""));` },
            { language: 'python', label: 'Python', code: `import os\nimport requests\n\nresponse = requests.post(\n    "${url}",\n    headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},\n    json=${toPython(body, 1)},\n)\ndata = response.json()\nprint("".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"]))` },
        ]
    }

    const { stream, stream_options, ...body } = buildCompatibleBody(request)
    void stream; void stream_options
    const url = `${(options.baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '')}/chat/completions`
    return [
        { language: 'curl', label: 'cURL', code: `curl ${url} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $API_KEY" \\\n  -d ${shellQuote(json(body))}` },
        { language: 'typescript', label: 'TypeScript', code: `const response = await fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", Authorization: \`Bearer \${process.env.API_KEY}\` },\n  body: JSON.stringify(${json(body)}),\n});\nconst data = await response.json();\nconsole.log(data.choices[0].message.content);` },
        { language: 'python', label: 'Python', code: `import os\nimport requests\n\nresponse = requests.post(\n    "${url}",\n    headers={"Authorization": f"Bearer {os.environ.get('API_KEY', '')}"},\n    json=${toPython(body, 1)},\n)\nprint(response.json()["choices"][0]["message"]["content"])` },
    ]
}
