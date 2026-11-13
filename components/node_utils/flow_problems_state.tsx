import { create } from "zustand";
import { AlertTriangle } from "lucide-react";
import type { FlowProblem } from "@/lib/flow_check";

/**
 * The result of the pre-run check (kept up to date by flow_problems.tsx). This module imports no
 * other stores, so steps on the canvas can read it without import cycles.
 */
type ProblemsState = {
    problems: FlowProblem[]
    byNode: Record<string, FlowProblem[]>
    errors: number
    /** The list next to Run is open (also opened when Run is pressed with errors). */
    open: boolean
}

export const useFlowProblems = create<ProblemsState>()(() => ({ problems: [], byNode: {}, errors: 0, open: false }))

/** The "needs setup" mark on a step that has errors. */
export function ProblemBadge({ nodeId }: { nodeId: string }) {
    const problems = useFlowProblems(s => s.byNode[nodeId])
    const errors = problems?.filter(p => p.severity == 'error') || []
    if (!errors.length) return null
    return (
        <span
            className="absolute -top-2 -left-2 flex items-center justify-center rounded-full w-5 h-5 bg-warning text-warning-foreground border-2 border-background"
            title={errors.map(e => e.message).join('\n')}
            aria-label={`Needs setup: ${errors.map(e => e.message).join(' ')}`}
        >
            <AlertTriangle size={11} strokeWidth={2.5} />
        </span>
    )
}
