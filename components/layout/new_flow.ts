import { createFlow } from "@/lib/library";
import { templates, FlowTemplate } from "@/lib/templates";
import { availableProviders } from "@/lib/providers";
import { DEFAULT_MODELS, ProviderId, PROVIDERS } from "@/lib/openai/models";
import { sampleAnswersOn, useSettingStore } from "@/lib/store";
import { track } from "@/lib/analytics";

/** Steps that use the provider chosen for the flow (others call a fixed service, see templateNeeds). */
const CHAT_STEPS = ['prompt', 'llm_router', 'web_search']

/** The provider a new flow's AI steps should use: OpenAI if possible, else one the user has a key for. */
function preferredProvider(): ProviderId {
    if (sampleAnswersOn(useSettingStore.getState())) return 'openai'
    const usable = availableProviders()
    return (['openai', 'anthropic', 'google', 'compatible'] as ProviderId[]).find(p => usable.includes(p)) || 'openai'
}

const label = (id: ProviderId) => PROVIDERS.find(p => p.id == id)?.label.replace(/ \(.*\)$/, '') || id

/** What a template needs besides one AI provider, e.g. "Needs OpenAI (embeddings)". */
export function templateNeeds(template: FlowTemplate): string | undefined {
    const types = new Set(template.build().nodes.map(n => n.type))
    if (types.has('model_compare')) return 'Needs OpenAI and Claude keys (it compares models)'
    if (types.has('semantic_search')) return 'Needs an OpenAI key (for embeddings)'
    if (types.has('ai_decisions')) return 'Needs an OpenAI key (for the Decisions API)'
    if (types.has('image_generation')) return 'Needs an OpenAI key (for images)'
    if (types.has('transcription')) return 'Needs an OpenAI key (for transcription)'
    if (types.has('web_search')) return 'Needs OpenAI, Claude or Gemini (not your own server)'
    return undefined
}

/** Creates a flow from a template (or a blank one), with its AI steps on a provider the user can use. */
export async function createFromTemplate(templateId?: string, name?: string) {
    const template = templates.find(t => t.id == templateId)
    const built = template?.build()
    const provider = preferredProvider()
    const nodes = built?.nodes.map(n => {
        if (!CHAT_STEPS.includes(n.type) || n.data.provider || provider == 'openai') return n
        const usable = n.type == 'web_search' && provider == 'compatible' ? 'openai' : provider
        return { ...n, data: { ...n.data, provider: usable, model: DEFAULT_MODELS[usable] } }
    })
    await createFlow(name || template?.name || 'Untitled flow', nodes, built?.edges)
    track('flow_created', { template: templateId || 'blank', provider })
    return label(provider)
}
