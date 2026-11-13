/**
 * Runs user JavaScript in a Web Worker. The worker has no access to the page, its DOM or its
 * storage (where the API key is kept), and it is terminated on timeout or when the flow stops.
 */

const workerSource = `
self.onmessage = async (event) => {
    const { code, context } = event.data
    const logs = []
    const format = (args) => args.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x) } catch { return String(x) } })()).join(' ')
    self.console = { ...self.console, log: (...a) => logs.push(format(a)), info: (...a) => logs.push(format(a)), warn: (...a) => logs.push(format(a)), error: (...a) => logs.push(format(a)) }
    try {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        const fn = new AsyncFunction('context', 'state', '"use strict";\\n' + code)
        const value = await fn(context, context.state || {})
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

export function runCodeInWorker(code: string, context: unknown, timeoutMs: number, signal?: AbortSignal): Promise<CodeResult> {
    return new Promise((resolve, reject) => {
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
            worker.postMessage({ code, context })
        } catch (error) {
            cleanup()
            reject(new Error(`Values could not be passed to the code: ${(error as Error).message}`))
        }
    })
}
