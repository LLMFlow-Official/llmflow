export type SseEvent = { event?: string, data: string }

/** Reads a Server-Sent Events stream and yields each event's data. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let index: number
            while ((index = buffer.search(/\r?\n\r?\n/)) != -1) {
                const raw = buffer.slice(0, index)
                buffer = buffer.slice(index).replace(/^\r?\n\r?\n/, '')
                const event = parseEvent(raw)
                if (event) yield event
            }
        }
        const last = parseEvent(buffer)
        if (last) yield last
    } finally {
        reader.releaseLock()
    }
}

export function parseEvent(raw: string): SseEvent | null {
    let event: string | undefined
    const data: string[] = []
    for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    return data.length ? { event, data: data.join('\n') } : null
}
