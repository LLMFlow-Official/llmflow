import { useMemo, useState } from "react";
import { Code2, Copy } from "lucide-react";
import { codeSamples } from "@/lib/code_export";
import { ChatRequest } from "@/lib/providers/types";
import { useSettingStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";

/** Shows the node's request as cURL, TypeScript and Python. */
export default function ViewAsCode({ request }: { request: () => ChatRequest }) {
    const { toast } = useToast()
    const [open, setOpen] = useState(false)
    const [tab, setTab] = useState(0)
    const baseUrl = useSettingStore(s => s.compatibleBaseUrl)

    const result = useMemo(() => {
        if (!open) return { samples: [] }
        try {
            return { samples: codeSamples(request(), { baseUrl }) }
        } catch (error) {
            return { samples: [], error: (error as Error).message }
        }
    }, [open, request, baseUrl])

    const sample = result.samples[tab]
    return (
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) track('view_as_code') }}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 w-fit"><Code2 size={14} /> View as code</Button>
            </DialogTrigger>
            <DialogContent className="max-w-(--breakpoint-md) max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>This prompt as code</DialogTitle>
                    <DialogDescription>The same request this node sends. Values like {'{start.topic}'} are filled in by the flow; replace them in your code. Keys are read from environment variables.</DialogDescription>
                </DialogHeader>
                {result.error ? <p className="text-sm text-red-600">{result.error}</p> : <>
                    <div className="flex gap-1 border-b border-border" role="tablist">
                        {result.samples.map((s, i) => (
                            <button key={s.language} role="tab" aria-selected={tab == i} className={`px-3 py-1 text-sm -mb-px border-b-2 ${tab == i ? 'border-primary font-semibold' : 'border-transparent text-muted-foreground'}`} onClick={() => setTab(i)}>{s.label}</button>
                        ))}
                        <Button variant="ghost" size="sm" className="ml-auto gap-1 h-7" disabled={!sample} onClick={async () => { await navigator.clipboard.writeText(sample.code); toast({ title: 'Copied', duration: 1500 }) }}>
                            <Copy size={14} /> Copy
                        </Button>
                    </div>
                    <pre className="flex-1 min-h-0 overflow-auto bg-gray-900 text-gray-100 text-xs p-3 rounded-md"><code>{sample?.code}</code></pre>
                </>}
            </DialogContent>
        </Dialog>
    )
}
