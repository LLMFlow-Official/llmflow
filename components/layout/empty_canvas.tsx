import { MessageSquareText, Sparkles } from "lucide-react";
import { Panel } from "@xyflow/react";
import { useFlowStore } from "@/lib/store";
import { templates } from "@/lib/templates";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { createFromTemplate } from "./new_flow";
import { showPanelTab } from "../node_utils/panel_tab";

/** Shown while the flow has only a Start step: three ways to begin. */
export default function EmptyCanvasHint() {
    const empty = useFlowStore(s => s.nodes.length <= 1 && s.edges.length == 0)
    if (!empty) return null

    const describe = () => {
        showPanelTab('build')
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Describe the flow or the change"]')?.focus(), 50)
    }

    return (
        <Panel position="bottom-center" className="mb-24! pointer-events-auto">
            <Card className="p-4 flex flex-col gap-3 max-w-md shadow-md">
                <div>
                    <p className="text-sm font-semibold">Start building</p>
                    <p className="text-xs text-muted-foreground">Open an example, describe the flow you want, or add steps after Start with + Add step.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {templates.slice(0, 3).map(t => (
                        <Button key={t.id} size="sm" variant="outline" className="gap-1" onClick={() => createFromTemplate(t.id)}>
                            <Sparkles size={14} aria-hidden /> {t.name}
                        </Button>
                    ))}
                </div>
                <Button size="sm" className="self-start gap-1" onClick={describe}>
                    <MessageSquareText size={14} aria-hidden /> Describe it in Build
                </Button>
            </Card>
        </Panel>
    )
}
