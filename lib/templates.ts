import type { Edge } from '@xyflow/react'
import type { AppNode } from './store'
import { autoLayout } from './layout'

/** Starter flows offered when creating a new flow. Each one runs as is with the Test API turned on. */

type NodeSpec = { id: string, type: string, data: Record<string, unknown> }
type EdgeSpec = [string, string, string?]

function build(nodes: NodeSpec[], edges: EdgeSpec[]): { nodes: AppNode[], edges: Edge[] } {
    const appNodes = nodes.map(n => ({ id: n.id, type: n.type, position: { x: 0, y: 0 }, data: { thread: 'main', ...n.data } })) as unknown as AppNode[]
    const appEdges: Edge[] = edges.map(([source, target, label]) => ({ id: `edge_${source}_${target}`, source, target, ...(label ? { label } : {}) }))
    return { nodes: autoLayout(appNodes, appEdges), edges: appEdges }
}

const start = (inputs: [string, string, string?][]) => ({
    id: 'start', type: 'start',
    data: {
        properties: inputs.map(([name, type]) => ({ name, type })),
        propertyValues: Object.fromEntries(inputs.filter(x => x[2]).map(([name, , value]) => [name, value])),
    },
})

const prompt = (id: string, name: string, system: string, user: string, extra: Record<string, unknown> = {}) => ({
    id, type: 'prompt',
    data: { name, system_prompt: system, prompts: [{ role: 'user', content: user }], test_output: `(Test answer from ${name})`, ...extra },
})

const final = (id: string, value: string, name = 'Result') => ({ id, type: 'final_output', data: { name, value } })

export type FlowTemplate = { id: string, name: string, description: string, build: () => { nodes: AppNode[], edges: Edge[] } }

export const templates: FlowTemplate[] = [
    {
        id: 'summarize',
        name: 'Summarize a text',
        description: 'Paste any text and get a three-point summary.',
        build: () => build([
            start([['text', 'textarea', 'Paste the text to summarize here.']]),
            prompt('prompt_a1', 'Summarize', 'Summarize the text in three short bullet points.', '{start.text}'),
            final('final_output_a2', '{prompt_a1.assistant_raw_output}'),
        ], [['start', 'prompt_a1'], ['prompt_a1', 'final_output_a2']]),
    },
    {
        id: 'route_support',
        name: 'Route support emails',
        description: 'An AI Router sends each email to the right reply writer.',
        build: () => build([
            start([['email', 'textarea', 'Hi, I was charged twice for my order. Can I get a refund?']]),
            {
                id: 'llm_router_b1', type: 'llm_router',
                data: {
                    name: 'What does the customer need?', input: '{start.email}', test_output: 'refund',
                    routes: { prompt_b2: { name: 'refund', description: 'Wants money back' }, prompt_b3: { name: 'bug', description: 'Reports something broken' }, prompt_b4: { name: 'other' } },
                },
            },
            prompt('prompt_b2', 'Refund reply', 'Write a short, kind reply explaining how refunds work.', '{start.email}'),
            prompt('prompt_b3', 'Bug reply', 'Thank the customer and ask for steps to reproduce the problem.', '{start.email}'),
            prompt('prompt_b4', 'General reply', 'Write a short, helpful reply.', '{start.email}'),
            final('final_output_b5', '{prompt_b2.assistant_raw_output}', 'Refund reply'),
            final('final_output_b6', '{prompt_b3.assistant_raw_output}', 'Bug reply'),
            final('final_output_b7', '{prompt_b4.assistant_raw_output}', 'General reply'),
        ], [['start', 'llm_router_b1'], ['llm_router_b1', 'prompt_b2', 'refund'], ['llm_router_b1', 'prompt_b3', 'bug'], ['llm_router_b1', 'prompt_b4', 'other'],
        ['prompt_b2', 'final_output_b5'], ['prompt_b3', 'final_output_b6'], ['prompt_b4', 'final_output_b7']]),
    },
    {
        id: 'research',
        name: 'Research with web search',
        description: 'Search the web, then write a short report with sources.',
        build: () => build([
            start([['question', 'text', 'What changed in web accessibility rules this year?']]),
            { id: 'web_search_c1', type: 'web_search', data: { name: 'Search', query: '{start.question}', test_output: '(Test search answer)' } },
            prompt('prompt_c2', 'Write report', 'Write a short report for a busy reader. Keep the source links.', 'Question: {start.question}\n\nFindings:\n{web_search_c1.answer}'),
            final('final_output_c3', '{prompt_c2.assistant_raw_output}'),
        ], [['start', 'web_search_c1'], ['web_search_c1', 'prompt_c2'], ['prompt_c2', 'final_output_c3']]),
    },
    {
        id: 'rag',
        name: 'Answer from a document',
        description: 'Split a document, find the most relevant parts, and answer from them.',
        build: () => build([
            start([['document', 'textarea', 'Our office is open 9 to 5 on weekdays.\n\nParking is free for visitors.\n\nThe cafe closes at 3 pm.'], ['question', 'text', 'When does the cafe close?']]),
            { id: 'split_text_d1', type: 'split_text', data: { name: 'Split into paragraphs', source: '{start.document}', separator: '\\n\\n' } },
            { id: 'semantic_search_d2', type: 'semantic_search', data: { name: 'Find relevant parts', query: '{start.question}', documents: '{split_text_d1.chunks}', top_k: 2 } },
            prompt('prompt_d3', 'Answer', 'Answer only from the given excerpts. Say so if they do not contain the answer.', 'Excerpts:\n{semantic_search_d2.matches}\n\nQuestion: {start.question}'),
            final('final_output_d4', '{prompt_d3.assistant_raw_output}'),
        ], [['start', 'split_text_d1'], ['split_text_d1', 'semantic_search_d2'], ['semantic_search_d2', 'prompt_d3'], ['prompt_d3', 'final_output_d4']]),
    },
    {
        id: 'each_item',
        name: 'Process a list item by item',
        description: 'A Loop rewrites every line of a list, then collects the results.',
        build: () => build([
            start([['items', 'textarea', 'make coffee\nanswer emails\nwalk the dog']]),
            { id: 'loop_e1', type: 'loop', data: { name: 'For each line', items: '{start.items}', collect: '{prompt_e2.assistant_raw_output}', routes: { prompt_e2: 'each', final_output_e3: 'done' } } },
            prompt('prompt_e2', 'Rewrite', 'Rewrite the task as a friendly reminder in one sentence.', '{loop_e1.item}'),
            final('final_output_e3', '{loop_e1.results}'),
        ], [['start', 'loop_e1'], ['loop_e1', 'prompt_e2', 'Each item'], ['loop_e1', 'final_output_e3', 'After loop']]),
    },
    {
        id: 'review',
        name: 'Human review before finishing',
        description: 'Draft with AI, approve it yourself, then finish.',
        build: () => build([
            start([['topic', 'text', 'Announcing our new opening hours']]),
            prompt('prompt_f1', 'Draft', 'Write a short, friendly announcement.', '{start.topic}'),
            { id: 'human_input_f2', type: 'human_input', data: { name: 'Approve draft', mode: 'approve', message: 'Publish this?\n\n{prompt_f1.assistant_raw_output}' } },
            final('final_output_f3', '{prompt_f1.assistant_raw_output}', 'Approved text'),
        ], [['start', 'prompt_f1'], ['prompt_f1', 'human_input_f2'], ['human_input_f2', 'final_output_f3']]),
    },
    {
        id: 'compare',
        name: 'Compare models',
        description: 'Send one prompt to several models and compare answers, cost and speed.',
        build: () => build([
            start([['question', 'text', 'Explain recursion to a 10 year old.']]),
            {
                id: 'model_compare_g1', type: 'model_compare',
                data: {
                    name: 'Compare', system_prompt: 'Answer in under 80 words.', prompt: '{start.question}', test_output: '(Test answer)',
                    models: [{ provider: 'openai', model: 'gpt-6.1-sol' }, { provider: 'anthropic', model: 'claude-opus-5-5' }, { provider: 'google', model: 'gemini-4-hydrogen' }],
                },
            },
            final('final_output_g2', '{model_compare_g1.table}'),
        ], [['start', 'model_compare_g1'], ['model_compare_g1', 'final_output_g2']]),
    },
]
