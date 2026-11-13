/**
 * Runs user JavaScript (Code node bodies and Decision / Set State / Assert expressions) in a Web
 * Worker. The worker has no access to the page, its DOM or its storage (where API keys are kept),
 * and it is terminated on timeout or when the flow stops.
 *
 * Every node's outputs are available both as `context.<nodeId>` and as a variable named after the
 * node id, so `{prompt_x.assistant_raw_output}` in an expression becomes `prompt_x.assistant_raw_output`.
 */

const identifier = /^[A-Za-z_$][\w$]*$/
const reserved = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
    'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
    'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let',
    'static', 'enum', 'await', 'implements', 'package', 'protected', 'interface', 'private', 'public', 'arguments', 'eval',
    'context',
])

/** Context keys that can be exposed as variables, plus `state` (always defined). */
export function exposedNames(context: Record<string, unknown>): string[] {
    const names = Object.keys(context).filter(x => identifier.test(x) && !reserved.has(x))
    if (!names.includes('state')) names.push('state')
    return names
}

/** Arguments matching exposedNames(). */
export function exposedValues(context: Record<string, unknown>, names: string[]): unknown[] {
    return names.map(name => name == 'state' ? (context.state ?? {}) : context[name])
}

/** Function body for an expression, e.g. `a.b == 1` becomes `return (a.b == 1)`. */
export function expressionBody(expression: string): string {
    return `return (\n${expression}\n)`
}

/**
 * Checks that an expression compiles, without running it. Uses the Function constructor only to
 * parse: the returned function is never called.
 */
export function isValidExpression(expression: string): boolean {
    if (!expression.trim()) return false
    try {
        // Parsed as a default parameter value, where statements (";", "return", blocks) are not
        // allowed, so text like `1); doSomething(); (1` cannot sneak extra statements in.
        new Function(`__value = (\n${expression}\n)`, '')
        return true
    } catch {
        return false
    }
}

const workerSource = `
self.onmessage = async (event) => {
    const { code, context, names } = event.data
    const logs = []
    const format = (args) => args.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x) } catch { return String(x) } })()).join(' ')
    self.console = { ...self.console, log: (...a) => logs.push(format(a)), info: (...a) => logs.push(format(a)), warn: (...a) => logs.push(format(a)), error: (...a) => logs.push(format(a)) }
    try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        const fn = new AsyncFunction('context', ...names, '"use strict";\\n' + code)
        const values = names.map(name => name === 'state' ? (context.state ?? {}) : context[name])
        const value = await fn(context, ...values)
        const result = value === undefined ? null : JSON.parse(JSON.stringify(value))
        self.postMessage({ ok: true, result, logs })
    } catch (error) {
        self.postMessage({ ok: false, error: (error && error.message) || String(error), logs })
    }
}
`

export type CodeResult = { result: unknown, logs: string[] }

export class CodeStoppedError extends Error {
    constructor() {
        super('Stopped')
    }
}

export function runCodeInWorker(code: string, context: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<CodeResult> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new CodeStoppedError())

        const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
        const worker = new Worker(url)

        const cleanup = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            worker.terminate()
            URL.revokeObjectURL(url)
        }
        const onAbort = () => {
            cleanup()
            reject(new CodeStoppedError())
        }
        const timer = setTimeout(() => {
            cleanup()
            reject(new Error(`The code ran longer than ${timeoutMs / 1000} seconds and was stopped`))
        }, timeoutMs)

        signal?.addEventListener('abort', onAbort)

        worker.onmessage = (event: MessageEvent<{ ok: boolean, result?: unknown, error?: string, logs: string[] }>) => {
            cleanup()
            if (event.data.ok) resolve({ result: event.data.result, logs: event.data.logs })
            else reject(Object.assign(new Error(event.data.error || 'The code failed'), { logs: event.data.logs }))
        }
        worker.onerror = (event) => {
            cleanup()
            reject(new Error(event.message || 'The code could not run'))
        }

        try {
            worker.postMessage({ code, context, names: exposedNames(context) })
        } catch (error) {
            cleanup()
            reject(new Error(`Values could not be passed to the code: ${(error as Error).message}`))
        }
    })
}
