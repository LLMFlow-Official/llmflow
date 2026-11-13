import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useReactFlow } from "@xyflow/react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { NodeCategory, nodeDetails, NodeType } from "@/lib/nodes";
import { cn } from "@/lib/utils";
import { addStep } from "./add_step";

const CATEGORIES: { id: NodeCategory, label: string }[] = [
    { id: 'ai', label: 'AI' },
    { id: 'logic', label: 'Logic and branching' },
    { id: 'data', label: 'Text and data' },
    { id: 'io', label: 'Input and output' },
]

const ACCENT: Record<NodeCategory, string> = {
    start: 'text-node-start', //tw
    ai: 'text-node-ai', //tw
    logic: 'text-node-logic', //tw
    data: 'text-node-data', //tw
    io: 'text-node-io', //tw
}

const addable = nodeDetails.filter(n => !n.notAddable && n.type != 'start')

/** A searchable list of step types, grouped by category, usable with the arrow keys and Enter. */
export function StepPicker({ onPick }: { onPick: (type: NodeType) => void }) {
    const [query, setQuery] = useState('')
    const [active, setActive] = useState(0)
    const listId = useId()
    const listRef = useRef<HTMLDivElement>(null)

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase()
        const matches = addable.filter(n => !q || [n.name, n.description, ...n.tags, CATEGORIES.find(c => c.id == n.category)?.label || ''].join(' ').toLowerCase().includes(q))
        return CATEGORIES.map(c => ({ ...c, items: matches.filter(n => n.category == c.id) })).filter(g => g.items.length)
    }, [query])
    const flat = groups.flatMap(g => g.items)
    const current = Math.min(active, Math.max(flat.length - 1, 0))

    useEffect(() => {
        listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
    }, [current, query])

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key == 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(flat.length, 1)) }
        else if (e.key == 'ArrowUp') { e.preventDefault(); setActive((current - 1 + flat.length) % Math.max(flat.length, 1)) }
        else if (e.key == 'Home') { e.preventDefault(); setActive(0) }
        else if (e.key == 'End') { e.preventDefault(); setActive(flat.length - 1) }
        else if (e.key == 'Enter' && flat[current]) { e.preventDefault(); onPick(flat[current].type) }
    }

    return (
        <div className="flex flex-col w-80 max-w-[calc(100vw-2rem)]">
            <input
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={flat[current] ? `${listId}-${flat[current].type}` : undefined}
                aria-label="Search steps"
                placeholder="Search steps…"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                onKeyDown={onKeyDown}
                className="h-10 text-sm px-3 w-full outline-hidden bg-transparent border-b border-border"
            />
            <div ref={listRef} id={listId} role="listbox" aria-label="Steps" className="max-h-[min(60vh,28rem)] overflow-y-auto p-1 select-none">
                {groups.map(group => (
                    <div key={group.id} role="group" aria-label={group.label}>
                        <div className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground" aria-hidden>{group.label}</div>
                        {group.items.map(item => {
                            const index = flat.indexOf(item)
                            const Icon = item.icon
                            return (
                                <div
                                    key={item.type}
                                    id={`${listId}-${item.type}`}
                                    role="option"
                                    aria-selected={index == current}
                                    data-active={index == current}
                                    className={cn('flex gap-3 items-start rounded-md px-2 py-2 cursor-pointer', index == current ? 'bg-accent' : '')}
                                    onMouseMove={() => setActive(index)}
                                    onClick={() => onPick(item.type)}
                                >
                                    <Icon size={18} className={cn('mt-0.5 shrink-0', ACCENT[item.category])} aria-hidden />
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-sm font-medium">{item.name}</span>
                                        <span className="text-xs text-muted-foreground">{item.description}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ))}
                {!flat.length ? <p className="text-sm text-muted-foreground p-3">No step matches “{query}”.</p> : null}
            </div>
        </div>
    )
}

/** Set when a connection is dropped on empty canvas: the list opens there and connects the new step. */
export const useDropPicker = create<{ open: boolean, x: number, y: number, from?: string }>()(() => ({ open: false, x: 0, y: 0 }))

/** The step list at the point where a connection was dropped. */
function DropStepPicker() {
    const { open, x, y, from } = useDropPicker()
    const { screenToFlowPosition } = useReactFlow()
    const close = () => useDropPicker.setState({ open: false, from: undefined })
    return (
        <Popover open={open} onOpenChange={(o) => { if (!o) close() }}>
            {/* An invisible anchor at the drop point. */}
            <PopoverTrigger asChild>
                <span aria-hidden className="fixed w-px h-px pointer-events-none" style={{ left: x, top: y }} />
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" sideOffset={4} className="p-0 w-auto">
                <StepPicker onPick={(type) => {
                    close()
                    addStep(type, { from, position: screenToFlowPosition({ x: x - 70, y }) })
                }} />
            </PopoverContent>
        </Popover>
    )
}

export default function NewNode() {
    const [open, setOpen] = useState(false)
    return (
        <>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant={open ? 'secondary' : 'ghost'} className="h-10 gap-1.5 px-3" toolTip="Add a step after the selected one" aria-label="Add step">
                        <Plus size={18} /> <span className="hidden @xl:inline">Add step</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" alignOffset={-2} sideOffset={10} side="bottom" className="p-0 w-auto">
                    <StepPicker onPick={(type) => { setOpen(false); addStep(type) }} />
                </PopoverContent>
            </Popover>
            <DropStepPicker />
        </>
    )
}
