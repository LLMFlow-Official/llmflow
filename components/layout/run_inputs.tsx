import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { useFlowStore } from "@/lib/store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Property = { name: string, type: string }
type Values = Record<string, string | number | undefined>

/**
 * The flow's inputs next to the Run button: change them and run without opening the Start step.
 * The values are saved in the Start step, like when they are typed there.
 */
export function RunInputs({ onRun, disabled }: { onRun: () => void, disabled?: boolean }) {
    const start = useFlowStore(s => s.nodes.find(n => n.type == 'start'))
    const [open, setOpen] = useState(false)
    const props = ((start?.data.properties as Property[] | undefined) || []).filter(p => p.name)
    if (!start || !props.length) return null
    const values = (start.data.propertyValues as Values | undefined) || {}

    const setValue = (name: string, value: string) => {
        const { nodes, updateNode } = useFlowStore.getState()
        const current = nodes.find(n => n.id == start.id)
        if (!current) return
        updateNode({ ...current, data: { ...current.data, propertyValues: { ...((current.data.propertyValues as Values) || {}), [name]: value } } })
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-12 w-10 rounded-full shadow-lg bg-card" disabled={disabled} toolTip="Inputs for this run" aria-label="Inputs for this run">
                    <ChevronUp size={18} />
                </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-3">
                <div>
                    <p className="text-sm font-semibold">Inputs</p>
                    <p className="text-xs text-muted-foreground">Saved in the Start step.</p>
                </div>
                <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); setOpen(false); onRun() }}>
                    {props.map((prop, i) => {
                        const id = `run-input-${i}`
                        const value = values[prop.name] ?? ''
                        if (prop.type == 'checkbox') {
                            return (
                                <label key={prop.name} htmlFor={id} className="flex items-center gap-2 text-sm">
                                    <input id={id} type="checkbox" checked={value === 'yes'} onChange={(e) => setValue(prop.name, e.target.checked ? 'yes' : '')} />
                                    {prop.name}
                                </label>
                            )
                        }
                        return (
                            <div key={prop.name} className="flex flex-col gap-1">
                                <Label htmlFor={id} className="text-sm font-semibold">{prop.name}</Label>
                                {prop.type == 'textarea' || prop.type == 'array' ? (
                                    <textarea
                                        id={id}
                                        className="min-h-20 max-h-60 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                                        placeholder={prop.type == 'array' ? 'One item per line' : undefined}
                                        value={String(value)}
                                        onChange={(e) => setValue(prop.name, e.target.value)}
                                    />
                                ) : (
                                    <Input id={id} type={prop.type == 'number' ? 'number' : 'text'} value={String(value)} onChange={(e) => setValue(prop.name, e.target.value)} />
                                )}
                            </div>
                        )
                    })}
                    <Button type="submit" className="self-end">Run with these inputs</Button>
                </form>
            </PopoverContent>
        </Popover>
    )
}
