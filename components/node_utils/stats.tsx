import { sampleAnswersOn, useSettingStore } from "@/lib/store";
import { DollarSign, MoveUp, MoveDown, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { NormalizedUsage, totalInput } from "@/lib/openai/models";

export type StatsProps = {
    startTime?: number
    endTime?: number,
    /** Input (prompt) tokens */
    inToken: number,
    /** Output (completion) tokens, including reasoning tokens */
    outToken: number,
    cachedToken?: number,
    reasoningToken?: number,
    /** Null when the model's prices are unknown */
    amount: number | null,
    /** The amount is a lower bound because some requests had unknown prices */
    costIncomplete?: boolean
    /** Say that sample answers are on (once, at the top of the log). */
    testNotice?: boolean
}

/** "$0.0012", "$1.25"; tiny amounts as "<$0.0001". */
export function formatCost(amount: number): string {
    if (amount == 0) return '$0'
    if (amount < 0.0001) return '<$0.0001'
    return `$${amount.toFixed(amount < 1 ? 4 : 2)}`
}

export function Stats({ startTime, endTime, inToken, outToken, cachedToken, reasoningToken, amount, costIncomplete, testNotice }: StatsProps) {
    const isTestAPI = useSettingStore(sampleAnswersOn)
    const cost = amount === null ? 'Unknown' : `${formatCost(amount)}${costIncomplete ? '+' : ''}`
    const costTooltip = amount === null
        ? 'Cost in USD (unknown: this model is not in the price list)'
        : costIncomplete ? 'Cost in USD (lower bound: some requests used models with unknown prices)' : 'Cost in USD'

    const formatDuration = (start?: number, end?: number) => {
        if (!start || !end) return `00:00.000`
        const duration = Math.max(end - start, 0);
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);
        const milliseconds = Math.floor(duration % 1000);
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    }

    // While running, a timer updates "now" so the clock ticks; afterwards the fixed end time is shown.
    const running = !!startTime && !endTime
    const [now, setNow] = useState(0)
    useEffect(() => {
        if (!running) return
        const interval = setInterval(() => setNow(Date.now()), 50);
        return () => clearInterval(interval);
    }, [running]);
    const duration = formatDuration(startTime, running ? Math.max(now, startTime!) : endTime)

    return (
        <div className="mt-3">
            {isTestAPI && testNotice ? <span className="font-semibold text-warning text-xs">Sample answers: no real AI requests (turn off in Settings)</span> : null}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs bg-accent px-2 py-1.5 rounded-md border border-border">
                <span className="flex items-center gap-1" title={`Tokens sent to the model${cachedToken ? ` (${cachedToken} from cache)` : ''}`}><MoveUp size={14} aria-hidden /> {inToken} in</span>
                <span className="flex items-center gap-1" title={`Tokens the model wrote${reasoningToken ? ` (${reasoningToken} thinking)` : ''}`}><MoveDown size={14} aria-hidden /> {outToken} out</span>
                <span className="flex items-center gap-1" title={costTooltip}><DollarSign size={14} aria-hidden /> {cost}</span>
                <span className="flex items-center gap-1" title="Time taken"><Timer size={14} aria-hidden /> {duration}</span>
            </div>
        </div>
    )
}
/** Token, cost and time display for one AI request. */
export function UsageStats({ usage, amount, startTime, endTime, costIncomplete }: {
    usage: NormalizedUsage
    amount: number | null
    startTime?: number
    endTime?: number
    costIncomplete?: boolean
}) {
    return (
        <Stats
            amount={amount}
            costIncomplete={costIncomplete}
            inToken={totalInput(usage)}
            outToken={usage.output}
            cachedToken={usage.cachedInput || undefined}
            reasoningToken={usage.reasoning || undefined}
            startTime={startTime}
            endTime={endTime}
        />
    )
}

/** Links to the pages an answer cited (shown whenever web search was used, as providers require). */
export function CitationList({ citations }: { citations?: { url: string, title?: string }[] }) {
    if (!citations?.length) return null
    return (
        <div className='mt-2 flex flex-col gap-1 text-xs'>
            <span className='font-semibold'>Sources</span>
            {citations.map(x => (
                <a key={x.url} href={x.url} target='_blank' rel='noopener noreferrer' className='text-info underline break-all'>
                    {x.title || x.url}
                </a>
            ))}
        </div>
    )
}
