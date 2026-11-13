import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useReactFlow } from "@xyflow/react";
import { useFlowStore } from "@/lib/store";
import { getNodeDetails } from "@/lib/nodes";
import { MOD_KEY } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";

/** Search the nodes in the flow by name, type or id and jump to one (Ctrl/⌘ + K). */
export default function FindNode() {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const nodes = useFlowStore((s) => s.nodes)
    const { fitView } = useReactFlow()

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() == 'k') {
                e.preventDefault()
                setOpen(true)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const matches = useMemo(() => {
        const q = query.toLowerCase()
        return nodes
            .map(n => ({ node: n, typeName: getNodeDetails(n.type).name, name: (n.data.name as string) || '' }))
            .filter(x => !q || x.name.toLowerCase().includes(q) || x.typeName.toLowerCase().includes(q) || x.node.id.toLowerCase().includes(q))
            .slice(0, 30)
    }, [nodes, query])

    const focus = (id: string) => {
        setOpen(false)
        setQuery('')
        const { nodes, setNodes } = useFlowStore.getState()
        setNodes(nodes.map(n => ({ ...n, selected: n.id == id })))
        fitView({ nodes: [{ id }], maxZoom: 1.3, duration: 300 })
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button toolTip={`Find a node (${MOD_KEY}+K)`} aria-label="Find a node" variant="ghost" size="icon"><Search /></Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="p-0 w-72">
                <input
                    autoFocus
                    aria-label="Search nodes in this flow"
                    placeholder="Find a node by name or type…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key == 'Enter' && matches[0]) focus(matches[0].node.id) }}
                    className="h-9 text-sm px-3 w-full outline-hidden bg-transparent border-b border-border"
                />
                <div className="max-h-72 overflow-y-auto py-1">
                    {matches.length ? matches.map(x => (
                        <button key={x.node.id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex flex-col" onClick={() => focus(x.node.id)}>
                            <span className="font-medium">{x.name || x.typeName}</span>
                            <span className="text-xs text-muted-foreground">{x.typeName} · {x.node.id}</span>
                        </button>
                    )) : <p className="px-3 py-2 text-sm text-muted-foreground">No nodes match.</p>}
                </div>
            </PopoverContent>
        </Popover>
    )
}
