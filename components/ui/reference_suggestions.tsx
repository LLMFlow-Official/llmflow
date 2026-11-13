import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useFlowStore } from "@/lib/store";
import { filterReferences, referenceOptions, ReferenceOption } from "@/lib/references";
import { cn } from "@/lib/utils";

/** The references available to a node (recomputed when the flow changes). */
export function useReferenceOptions(nodeId?: string): ReferenceOption[] {
    const { nodes, edges } = useFlowStore(useShallow(s => ({ nodes: s.nodes, edges: s.edges })))
    return useMemo(() => nodeId ? referenceOptions(nodeId, nodes, edges) : [], [nodeId, nodes, edges])
}

/** The suggestion list shown while typing "{". */
export function ReferenceSuggestions({ options, query, active, onPick }: {
    options: ReferenceOption[]
    query: string
    active: number
    onPick: (option: ReferenceOption) => void
}) {
    const matches = filterReferences(options, query)
    if (!matches.length) return null
    return (
        <div role="listbox" aria-label="Values from earlier steps" className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1">
            {matches.map((o, i) => (
                <button
                    key={o.path}
                    role="option"
                    aria-selected={i == active}
                    className={cn("w-full text-left px-2 py-1 text-xs flex flex-col", i == active ? "bg-muted" : "hover:bg-muted")}
                    // Keep focus in the editor while picking.
                    onMouseDown={(e) => { e.preventDefault(); onPick(o) }}
                >
                    <span className="font-medium">{o.label}</span>
                    <span className="font-mono text-muted-foreground">{`{${o.path}}`}</span>
                </button>
            ))}
        </div>
    )
}

export const suggestionCount = (options: ReferenceOption[], query: string) => filterReferences(options, query).length
export { filterReferences }
