import Anthropic from "@anthropic-ai/sdk";
import { listAccountModels } from "../openai";
import { ProviderId } from "../openai/models";
import { providerFetch } from "./http";

/** Model IDs the user's key can use, from the provider's model list. */
export async function listProviderModels(provider: ProviderId, apiKey: string, baseUrl?: string): Promise<string[]> {
    if (provider == 'openai') return listAccountModels(apiKey)

    if (provider == 'anthropic') {
        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
        const ids: string[] = []
        for await (const model of client.models.list()) ids.push(model.id)
        return ids.sort()
    }

    if (provider == 'google') {
        const response = await providerFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
            headers: { 'x-goog-api-key': apiKey },
        }, 'Google')
        const body = await response.json() as { models?: { name: string, supportedGenerationMethods?: string[] }[] }
        return (body.models || [])
            .filter(x => x.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(x.name))
            .map(x => x.name.replace(/^models\//, ''))
            .sort()
    }

    if (!baseUrl) throw new Error("Set the server address in Settings first")
    const response = await providerFetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    }, 'the server')
    const body = await response.json() as { data?: { id: string }[] }
    return (body.data || []).map(x => x.id).sort()
}
