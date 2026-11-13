import { ListChecks, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import Decimal from 'decimal.js-light';
import { AppContext, Controller, NodeLogViewProps, NodeMetaData, NodeOutput, OutputExtra } from '@/lib/nodes';
import { AppNode, AppNodeProp, NodeData } from '@/lib/store';
import { renderTextTemplate, resolveTemplateValue } from '@/lib/logics';
import {
    buildDecisionsPayload, createDecisions, DecisionAnswer, DecisionQuestion, decisionsCost, MAX_LEVELS, MAX_QUESTIONS,
    nearestLevel, normalizeDecisionsUsage, parseDecisionsResponse, QuestionType, sampleDecisions,
} from '@/lib/openai/decisions';
import { NormalizedUsage, totalInput } from '@/lib/openai/models';
import { getProviderKey, isTestApi, runRequest } from '@/lib/providers';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { UsageStats } from '../node_utils/stats';
import { NameField, NodeShell, TemplateField, TestOutputField, useNodeSetter } from '../node_utils/node_shell';

type DecisionsData = NodeData & {
    /** The text to decide about (template). */
    input?: string
    /** Shared guidance for every question (template). */
    instructions?: string
    /** A reference to an object or list, or JSON text (template). */
    json_input?: string
    images?: string[]
    questions?: DecisionQuestion[]
    cache_key?: string
    /** JSON: question name -> sample value. */
    test_output?: string
}

export const Metadata: NodeMetaData = {
    type: 'ai_decisions',
    category: 'ai',
    icon: ListChecks,
    name: 'AI Decisions',
    description: 'Ask yes/no, pick-one and rating questions about text, JSON or images, all in one fast request (OpenAI Decisions API)',
    tags: ['decisions', 'classify', 'yes no', 'predicate', 'choice', 'score', 'rate', 'grade', 'moderate', 'triage', 'judge', 'OpenAI'],
}

const TYPE_LABELS: Record<QuestionType, string> = { predicate: 'Yes or no', choice: 'Pick one', score: 'Rating' }

function valueDescription(q: DecisionQuestion): string {
    switch (q.type) {
        case 'predicate': return 'Probability (0 to 1) that the answer is yes'
        case 'choice': return `The chosen value: ${(q.choices || []).map(c => c.value).filter(Boolean).join(', ')}`
        case 'score': return `Score from 0 to ${Math.max((q.levels || []).length - 1, 1)} (${(q.levels || []).map(l => l.label).filter(Boolean).join(' → ')}); can fall between levels`
    }
}

export const Outputs = (node: AppNode<DecisionsData>, extra: OutputExtra) => {
    const outputs: NodeOutput = { name: { title: 'Step name', value: node.data.name } }
    for (const q of node.data.questions || []) {
        const name = q.name?.trim()
        if (!name) continue
        outputs[name] = { title: name, description: valueDescription(q), value: (extra as Record<string, string>)[name] }
    }
    outputs.answers = { title: 'All answers', description: 'Every answer by question name, with probabilities and confidence', value: extra.answers as string }
    outputs.refused = { title: 'Refused', description: 'Names of the questions the model declined to answer', value: extra.refused as string }
    return outputs
}

type LogPayload = { answers: DecisionAnswer[], usage: NormalizedUsage, amount: number | null, startTime: number, endTime: number }

const percent = (p: number) => `${Math.round(p * 100)}%`

function AnswerLine({ answer }: { answer: DecisionAnswer }) {
    switch (answer.type) {
        case 'predicate':
            return <><b>{answer.name}:</b> {percent(answer.probability)} yes</>
        case 'choice':
            return <><b>{answer.name}:</b> {answer.choice} <span className='text-muted-foreground'>({percent(answer.confidence)} confident; {answer.probabilities.map(p => `${p.value} ${percent(p.probability)}`).join(', ')})</span></>
        case 'score':
            return <><b>{answer.name}:</b> {answer.score.toFixed(2)} ≈ {nearestLevel(answer)} <span className='text-muted-foreground'>({percent(answer.confidence)} confident)</span></>
        case 'refusal':
            return <><b>{answer.name}:</b> <span className='text-danger'>refused{answer.refusal ? `: ${answer.refusal}` : ''}</span></>
    }
}

export function LogView({ payload }: NodeLogViewProps<LogPayload>) {
    return <>
        <ul className='bg-accent p-2 text-xs rounded-md border border-border flex flex-col gap-1'>
            {payload.answers.map(a => <li key={a.name}><AnswerLine answer={a} /></li>)}
        </ul>
        <UsageStats usage={payload.usage} amount={payload.amount} startTime={payload.startTime} endTime={payload.endTime} />
    </>
}

/** The JSON data input: a referenced object or list as is, or JSON text. Undefined when not set. */
function resolveJson(template: string | undefined, context: AppContext): object | undefined {
    if (!template?.trim()) return undefined
    const value = resolveTemplateValue(template, context)
    if (value && typeof value == 'object') return value as object
    const text = String(value ?? '').trim()
    if (!text) throw Error('JSON data is empty')
    try {
        return JSON.parse(text)
    } catch {
        throw Error(`JSON data is not valid JSON: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`)
    }
}

export const Process = async (context: AppContext, node: AppNode<DecisionsData>, nextNodes: AppNode[], controller: Controller) => {
    const fill = (text?: string) => renderTextTemplate(text || '', context)
    const questions: DecisionQuestion[] = (node.data.questions || []).map(q => ({
        ...q,
        name: q.name?.trim() || '',
        instructions: fill(q.instructions),
        image: q.image ? fill(q.image) : undefined,
    }))
    const payload = buildDecisionsPayload({
        text: fill(node.data.input),
        instructions: fill(node.data.instructions),
        json: resolveJson(node.data.json_input, context),
        images: (node.data.images || []).map(fill),
        questions,
        cacheKey: fill(node.data.cache_key),
    })

    const startTime = Date.now()
    const testMode = isTestApi()
    let response
    if (testMode) {
        let sample: Record<string, unknown> = {}
        if (node.data.test_output?.trim()) {
            try {
                sample = JSON.parse(node.data.test_output)
            } catch {
                throw Error('Sample answers must be JSON, e.g. {"is_urgent": 0.9, "department": "billing"}')
            }
        }
        response = sampleDecisions(questions, sample)
    } else {
        const apiKey = getProviderKey('openai')
        response = await runRequest(signal => createDecisions(apiKey, payload, signal), controller, { nodeId: node.id, nodeType: node.type })
    }
    const endTime = Date.now()

    const parsed = parseDecisionsResponse(response, questions)
    const usage = normalizeDecisionsUsage(response.usage)
    const cost = testMode ? new Decimal(0) : decisionsCost(usage)
    controller.increaseInToken(totalInput(usage))
    controller.increaseAmount(cost)

    // Each question's main value is its own output, so conditions can read {step.question} directly.
    context[node.id] = {
        name: node.data.name,
        ...(parsed.values as Record<string, string | number>),
        answers: parsed.answers,
        refused: parsed.refused,
    }

    const answered = questions.length - parsed.refused.length
    controller.log({
        id: node.id,
        type: parsed.refused.length ? 'warning' : 'success',
        title: parsed.refused.length
            ? `Answered ${answered} of ${questions.length}; refused: ${parsed.refused.join(', ')}`
            : `Answered ${questions.length} question${questions.length == 1 ? '' : 's'}`,
        nodeType: node.type,
        payload: {
            answers: questions.map(q => parsed.answers[q.name]),
            usage,
            amount: cost === null ? null : cost.toNumber(),
            startTime,
            endTime,
        } as LogPayload,
    })
    return nextNodes
}

/* ---------------- Settings panel ---------------- */

const newQuestion = (index: number): DecisionQuestion => ({ name: `question_${index + 1}`, type: 'predicate', instructions: '' })

function withType(q: DecisionQuestion, type: QuestionType): DecisionQuestion {
    const next: DecisionQuestion = { ...q, type }
    if (type == 'choice' && !q.choices?.length) next.choices = [{ value: '' }, { value: '' }, { value: 'other', description: 'None of the above' }]
    if (type == 'score' && !q.levels?.length) next.levels = [{ label: 'low' }, { label: 'medium' }, { label: 'high' }]
    return next
}

type OptionRow = { key: string, description?: string }

/** Editable list of choices (value + description) or levels (label + description). */
function OptionList({ title, rows, keyPlaceholder, max, onChange, help }: {
    title: string
    rows: OptionRow[]
    keyPlaceholder: string
    max?: number
    help: string
    onChange: (rows: OptionRow[]) => void
}) {
    return (
        <div className='flex flex-col gap-1'>
            <div className='flex items-center'>
                <Label className='text-xs font-semibold'>{title}</Label>
                {max === undefined || rows.length < max ? (
                    <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip={`Add ${keyPlaceholder.toLowerCase()}`} aria-label={`Add ${keyPlaceholder.toLowerCase()}`} onClick={() => onChange([...rows, { key: '' }])}>
                        <Plus className='w-4 h-4' />
                    </Button>
                ) : null}
            </div>
            {rows.map((row, index) => (
                <div key={index} className='flex gap-1 items-center'>
                    <Input
                        className='w-28 shrink-0'
                        value={row.key}
                        placeholder={keyPlaceholder}
                        aria-label={`${keyPlaceholder} ${index + 1}`}
                        onChange={(e) => onChange(rows.map((x, i) => i == index ? { ...x, key: e.target.value } : x))}
                    />
                    <Input
                        value={row.description || ''}
                        placeholder='Meaning (optional)'
                        aria-label={`Meaning of ${keyPlaceholder.toLowerCase()} ${index + 1}`}
                        onChange={(e) => onChange(rows.map((x, i) => i == index ? { ...x, description: e.target.value } : x))}
                    />
                    <Button variant='ghost' size='sm' aria-label={`Remove ${keyPlaceholder.toLowerCase()} ${index + 1}`} className='text-danger hover:text-danger/80 p-0.5 h-6 w-6 shrink-0' onClick={() => onChange(rows.filter((_, i) => i != index))}>
                        <Trash className='w-4 h-4' />
                    </Button>
                </div>
            ))}
            <p className='text-xs text-muted-foreground'>{help}</p>
        </div>
    )
}

function QuestionCard({ node, index, question, onChange, onRemove }: {
    node: AppNode<DecisionsData>
    index: number
    question: DecisionQuestion
    onChange: (q: DecisionQuestion) => void
    onRemove: () => void
}) {
    const [showImage, setShowImage] = useState(!!question.image)
    return (
        <Card className='flex flex-col gap-2 p-3'>
            <div className='flex gap-1 items-center'>
                <Input
                    value={question.name}
                    placeholder='Name, e.g. is_urgent'
                    aria-label={`Question ${index + 1} name`}
                    onChange={(e) => onChange({ ...question, name: e.target.value.replace(/[^\w]/g, '_') })}
                />
                <Select value={question.type} onValueChange={(type) => onChange(withType(question, type as QuestionType))}>
                    <SelectTrigger className='w-32 shrink-0' aria-label={`Question ${index + 1} type`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {(Object.keys(TYPE_LABELS) as QuestionType[]).map(t => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Button variant='ghost' size='sm' aria-label={`Remove question ${index + 1}`} className='text-danger hover:text-danger/80 p-0.5 h-6 w-6 shrink-0' onClick={onRemove}>
                    <Trash className='w-4 h-4' />
                </Button>
            </div>
            <TemplateField
                node={node as AppNode}
                field={`questions[${index}].instructions`}
                label='What to decide'
                className='h-16'
                placeholder={question.type == 'predicate'
                    ? 'e.g. The customer asks for a refund.'
                    : question.type == 'choice' ? 'e.g. Which team should handle this ticket?' : 'e.g. How severe is the reported bug?'}
                help={question.type == 'predicate' ? 'Write a statement the model checks is true. The answer is the probability that it is.' : undefined}
            />
            {question.type == 'choice' ? (
                <OptionList
                    title='Choices'
                    keyPlaceholder='Value'
                    rows={(question.choices || []).map(c => ({ key: c.value, description: c.description }))}
                    onChange={(rows) => onChange({ ...question, choices: rows.map(r => ({ value: r.key, description: r.description })) })}
                    help='Give each a distinct meaning. Keep a fallback such as "other".'
                />
            ) : null}
            {question.type == 'score' ? (
                <OptionList
                    title='Levels (lowest first)'
                    keyPlaceholder='Label'
                    max={MAX_LEVELS}
                    rows={(question.levels || []).map(l => ({ key: l.label, description: l.description }))}
                    onChange={(rows) => onChange({ ...question, levels: rows.map(r => ({ label: r.key, description: r.description })) })}
                    help={`2 to ${MAX_LEVELS} levels, clearly different from each other. The score is 0 for the first level, 1 for the next, and so on.`}
                />
            ) : null}
            {showImage || question.image ? (
                <div className='flex flex-col gap-1'>
                    <Label className='text-xs font-semibold'>Image for this question</Label>
                    <Textarea
                        value={question.image || ''}
                        className='h-12 min-h-0'
                        placeholder='https://… or {node.image}'
                        aria-label={`Question ${index + 1} image`}
                        onChange={(e) => onChange({ ...question, image: e.target.value || undefined })}
                        node={node as AppNode}
                        withoutRichText
                    />
                    <p className='text-xs text-muted-foreground'>E.g. a candidate to compare with a reference image in the input.</p>
                </div>
            ) : (
                <Button variant='ghost' size='sm' className='self-start h-6 px-1 text-xs' onClick={() => setShowImage(true)}>Add an image to this question</Button>
            )}
        </Card>
    )
}

function ImageInputs({ node }: { node: AppNode<DecisionsData> }) {
    const setValue = useNodeSetter(node)
    const images = node.data.images || []
    const setImages = (next: string[]) => setValue('images', next)
    return (
        <div className='flex flex-col gap-1'>
            <div className='flex items-center'>
                <Label className='text-sm font-semibold'>Images</Label>
                <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add image' aria-label='Add image' onClick={() => setImages([...images, ''])}>
                    <Plus className='w-4 h-4' />
                </Button>
            </div>
            {images.length == 0 ? <p className='text-xs text-muted-foreground'>Optional. Image URLs or images from earlier steps, checked along with the input.</p> : null}
            {images.map((image, index) => (
                <div key={index} className='flex gap-1 items-start'>
                    <Textarea
                        name={`image_${index}`}
                        value={image}
                        className='h-12 min-h-0'
                        classNameFrame='flex-1'
                        placeholder='https://… or {node.image}'
                        onChange={(e) => setImages(images.map((x, i) => i == index ? e.target.value : x))}
                        node={node as AppNode}
                        withoutRichText
                    />
                    <Button variant='ghost' size='sm' aria-label={`Remove image ${index + 1}`} className='text-danger hover:text-danger/80 p-0.5 h-6 w-6' onClick={() => setImages(images.filter((_, i) => i != index))}>
                        <Trash className='w-4 h-4' />
                    </Button>
                </div>
            ))}
        </div>
    )
}

export const Properties = ({ node }: { node: AppNode<DecisionsData> }) => {
    const setValue = useNodeSetter(node)
    const questions = node.data.questions || []
    const setQuestions = (next: DecisionQuestion[]) => setValue('questions', next)
    const hasAdvanced = !!(node.data.instructions || node.data.json_input || node.data.images?.length || node.data.cache_key)
    const [advancedOpen, setAdvancedOpen] = useState(hasAdvanced)

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <TemplateField
                node={node as AppNode}
                field='input'
                label='Input'
                placeholder='{start.message}'
                help='What every question is about. JSON data and images can be added under Advanced.'
            />
            <div className='flex flex-col gap-2'>
                <div className='flex items-center'>
                    <Label className='text-sm font-semibold'>Questions</Label>
                    {questions.length < MAX_QUESTIONS ? (
                        <Button variant='ghost' size='icon' className='h-6 w-6 p-1 ml-auto' toolTip='Add question' aria-label='Add question' onClick={() => setQuestions([...questions, newQuestion(questions.length)])}>
                            <Plus className='w-4 h-4' />
                        </Button>
                    ) : null}
                </div>
                {questions.length == 0 ? (
                    <p className='text-xs text-muted-foreground'>Add one or more questions. Each answer becomes an output named after the question, e.g. a Decision step can check {'{'}this_step.is_urgent{'}'} &gt; 0.8.</p>
                ) : questions.map((q, index) => (
                    <QuestionCard
                        key={index}
                        node={node}
                        index={index}
                        question={q}
                        onChange={(next) => setQuestions(questions.map((x, i) => i == index ? next : x))}
                        onRemove={() => setQuestions(questions.filter((_, i) => i != index))}
                    />
                ))}
                {questions.length ? (
                    <Button variant='outline' size='sm' className='gap-1 self-start' onClick={() => setQuestions([...questions, newQuestion(questions.length)])}><Plus className='w-4 h-4' /> Question</Button>
                ) : null}
            </div>
            <details className='rounded-md border border-border' open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
                <summary className='cursor-pointer select-none px-3 py-2 text-sm font-semibold'>Advanced <span className='font-normal text-muted-foreground'>(shared instructions, JSON, images, caching)</span></summary>
                <div className='flex flex-col gap-3 p-3 pt-1'>
                    <TemplateField
                        node={node as AppNode}
                        field='instructions'
                        label='Shared instructions'
                        placeholder='e.g. You review support tickets for an online shop.'
                        help='Optional background that applies to every question.'
                    />
                    <TemplateField
                        node={node as AppNode}
                        field='json_input'
                        label='JSON data'
                        placeholder='{http_request_x.body}'
                        help='Optional. An object or list from an earlier step, or JSON text, read as data (not as instructions).'
                    />
                    <ImageInputs node={node} />
                    <div className='flex flex-col gap-1'>
                        <Label className='text-sm font-semibold' htmlFor={`cache_key-${node.id}`}>Cache key</Label>
                        <Input id={`cache_key-${node.id}`} value={node.data.cache_key || ''} placeholder='e.g. ticket-triage' onChange={(e) => setValue('cache_key', e.target.value || undefined)} />
                        <p className='text-xs text-muted-foreground'>Optional. Input of 1,024 tokens or more is cached automatically; requests with the same key share a cache.</p>
                    </div>
                </div>
            </details>
            <p className='text-xs text-muted-foreground'>Uses gpt-6-luna with your OpenAI key. Input costs $0.10 per million tokens; answers are free.</p>
            <TestOutputField
                node={node as AppNode}
                type='json'
                label='Sample answers'
                help='Optional. JSON by question name: a probability for yes/no, a value for pick one, a score for ratings. Others get 0.8, the first choice or the middle level.'
            />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    const count = ((props.data as DecisionsData).questions || []).length
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} summary={`${count} question${count == 1 ? '' : 's'}`} />
}
