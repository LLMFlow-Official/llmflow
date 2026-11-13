/**
 * Finds and parses JSON inside text: plain JSON, a ```json fenced block, or the first {...} / [...] span.
 * Throws when nothing parses.
 */
export function extractJson(text: string): unknown {
    const trimmed = (text || '').trim()
    if (!trimmed) throw new Error("There is no text to read JSON from")

    const candidates: string[] = [trimmed]

    const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(trimmed)
    if (fenced) candidates.push(fenced[1].trim())

    for (const [open, close] of [['{', '}'], ['[', ']']]) {
        const start = trimmed.indexOf(open)
        const end = trimmed.lastIndexOf(close)
        if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1))
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate)
        } catch {
            // try the next candidate
        }
    }
    throw new Error(`No valid JSON found in: ${trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed}`)
}

export type SplitOptions =
    | { mode: 'separator', separator: string }
    | { mode: 'chunk', size: number, overlap?: number }

/** Splits text by a separator (empty pieces removed) or into fixed-size character chunks with optional overlap. */
export function splitText(text: string, options: SplitOptions): string[] {
    if (!text) return []

    if (options.mode === 'separator') {
        const separator = options.separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
        if (!separator) throw new Error("Separator is required")
        return text.split(separator).map(x => x.trim()).filter(Boolean)
    }

    const size = Math.floor(options.size)
    const overlap = Math.floor(options.overlap ?? 0)
    if (!(size > 0)) throw new Error("Chunk size must be greater than 0")
    if (overlap < 0 || overlap >= size) throw new Error("Overlap must be at least 0 and smaller than the chunk size")

    const chunks: string[] = []
    for (let start = 0; start < text.length; start += size - overlap) {
        chunks.push(text.slice(start, start + size))
        if (start + size >= text.length) break
    }
    return chunks
}

/** Parses a list of domains or values written one per line or comma-separated. */
export function parseList(value?: string): string[] {
    return (value || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean)
}

/** Parses "Name: value" lines into a headers object. Blank lines and lines without ":" are ignored. */
export function parseHeaders(value?: string): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const line of (value || '').split('\n')) {
        const index = line.indexOf(':')
        if (index <= 0) continue
        const name = line.slice(0, index).trim()
        if (name) headers[name] = line.slice(index + 1).trim()
    }
    return headers
}
