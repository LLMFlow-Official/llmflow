import { useSettingStore } from "@/lib/store";
import { ArrowUpDown, DollarSign, MoveUp, MoveDown, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
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
}

export function Stats({ startTime, endTime, inToken, outToken, cachedToken, reasoningToken, amount, costIncomplete }: StatsProps) {
    const isTestAPI = useSettingStore((state) => state.devMode?.testOpenAPI || false)
    const covetedAmount = amount === null ? 'Unknown' : `${String(amount.toFixed(6)).padStart(7, '0')}${costIncomplete ? '+' : ''}`
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
            {isTestAPI ? <span className="font-semibold text-warning text-xs">Currently you are using Test API</span> : null}
            <div className="grid sm:grid-cols-3 xl:grid-cols-5 gap-2 text-xs bg-accent p-2 rounded-md flex-wrap border border-border">
                <Tooltip><TooltipTrigger><div className="flex items-center gap-1"><MoveUp size={16} /> {inToken}</div></TooltipTrigger><TooltipContent>Input Token Count{cachedToken ? ` (${cachedToken} cached)` : ''}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger><div className="flex items-center gap-1"><MoveDown size={16} /> {outToken}</ div></TooltipTrigger><TooltipContent>Output Token Count{reasoningToken ? ` (${reasoningToken} reasoning)` : ''}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger><div className="flex items-center gap-1"><ArrowUpDown size={16} /> {inToken + outToken}</ div></TooltipTrigger><TooltipContent>Total Token Count</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger><div className="flex items-center gap-1"><DollarSign size={16} /> {covetedAmount}</div></TooltipTrigger><TooltipContent>{costTooltip}</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger><div className="flex items-center gap-1"><Timer size={16} /> {duration}</div></TooltipTrigger><TooltipContent>Duration</TooltipContent></Tooltip>
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
