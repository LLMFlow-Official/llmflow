import { useEffect, useRef } from "react"
import { Loader } from "lucide-react"
import { useShallow } from "zustand/shallow"
import { useFlowStore, useRuntimeStore } from "@/lib/store"
import { Card } from "../ui/card"

function StreamingCard({ name, text }: { name: string, text: string }) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
    }, [text])
    return (
        <Card className="p-3 border-info border-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-bold">
                <Loader size={14} className="animate-spin" /> {name} is writing…
            </div>
            <div ref={ref} className="mt-2 bg-accent p-2 text-xs rounded-md whitespace-pre-wrap max-h-40 overflow-y-auto border border-border">
                {text}
            </div>
        </Card>
    )
}

/** Streams are keyed by node id, or "nodeId::index::label" when one node runs several models. */
function streamName(id: string, nodes: { id: string, data: Record<string, unknown> }[]) {
    const [nodeId, , label] = id.split('::')
    const name = (nodes.find(x => x.id == nodeId)?.data.name as string) || nodeId
    return label ? `${name} · ${label}` : name
}

/** Text that AI nodes are writing right now, shown live at the top of the runtime log. */
export default function StreamingCards() {
    const streaming = useRuntimeStore(useShallow((s) => s.streaming))
    const nodes = useFlowStore((s) => s.nodes)
    const entries = Object.entries(streaming).filter(([, text]) => text)
    if (!entries.length) return null
    return (
        <>
            {entries.map(([id, text]) => (
                <StreamingCard key={id} name={streamName(id, nodes)} text={text} />
            ))}
        </>
    )
}
