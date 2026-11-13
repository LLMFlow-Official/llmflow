/** An HTTP error from a provider, with what the retry logic needs. */
export class ProviderHttpError extends Error {
    constructor(message: string, public status: number, public retryAfterMs?: number) {
        super(message)
    }

    get retryable() {
        return this.status == 408 || this.status == 409 || this.status == 429 || this.status >= 500
    }
}

/** Builds a ProviderHttpError from a failed fetch Response, using the provider's error message when there is one. */
export async function errorFromResponse(response: Response, provider: string): Promise<ProviderHttpError> {
    let message = ''
    try {
        const text = await response.text()
        try {
            const body = JSON.parse(text)
            const err = Array.isArray(body) ? body[0]?.error : body?.error
            message = (typeof err == 'string' ? err : err?.message) || body?.message || text
        } catch {
            message = text
        }
    } catch {
        // ignore
    }
    const retryAfter = Number(response.headers.get('retry-after'))
    return new ProviderHttpError(
        `${provider} returned ${response.status}${message ? `: ${message.slice(0, 500)}` : ''}`,
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    )
}

/** fetch() that turns network failures into a readable error. */
export async function providerFetch(url: string, init: RequestInit, provider: string): Promise<Response> {
    let response: Response
    try {
        response = await fetch(url, init)
    } catch (error) {
        if (init.signal?.aborted) throw error
        throw new ProviderHttpError(`Could not reach ${provider}. Check your connection${provider == 'the server' ? ', the server address, and that it allows browser requests (CORS)' : ''}.`, 0)
    }
    if (!response.ok) throw await errorFromResponse(response, provider)
    return response
}
