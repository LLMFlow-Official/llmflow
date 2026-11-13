/**
 * Share links: the whole flow is compressed into the link itself (after "#flow="), so no server is
 * needed. Things that look like secrets are removed first.
 */

type AnyNode = { id: string, type: string, data: object }

const SECRET_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key|x-goog-api-key|cookie)\s*:/i

/** Removes MCP access tokens and secret-looking HTTP headers. Returns what was removed, for the share dialog. */
export function sanitizeForSharing<T extends AnyNode>(nodes: T[]): { nodes: T[], removed: string[] } {
    const removed: string[] = []
    const clean = nodes.map(node => {
        const data = JSON.parse(JSON.stringify(node.data)) as Record<string, unknown>
        const name = (data.name as string) || node.id
        const tools = data.tools as { mcpServers?: { token?: string }[] } | undefined
        for (const server of tools?.mcpServers || []) {
            if (server.token) {
                delete server.token
                removed.push(`MCP access token in "${name}"`)
            }
        }
        if (typeof data.headers == 'string') {
            const lines = data.headers.split('\n')
            const kept = lines.map(line => SECRET_HEADER.test(line) ? `${line.split(':')[0]}: <add your own>` : line)
            if (kept.join('\n') != data.headers) {
                data.headers = kept.join('\n')
                removed.push(`Secret headers in "${name}"`)
            }
        }
        return { ...node, data, selected: undefined } as T
    })
    return { nodes: clean, removed }
}

const toBase64Url = (bytes: Uint8Array) => {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + 0x8000)))
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, c => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
    const output = new Blob([bytes]).stream().pipeThrough(stream)
    return new Uint8Array(await new Response(output).arrayBuffer())
}

export async function compressToParam(text: string): Promise<string> {
    return toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')))
}

export async function decompressParam(param: string): Promise<string> {
    try {
        return new TextDecoder().decode(await pipe(fromBase64Url(param), new DecompressionStream('deflate-raw')))
    } catch {
        throw new Error('This share link is damaged or incomplete')
    }
}

export const SHARE_PREFIX = '#flow='
