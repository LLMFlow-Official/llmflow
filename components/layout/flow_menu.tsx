import { useEffect, useState } from "react";
import { ChevronDown, Copy, FilePlus2, FileUp, Download, Link2, ListChecks, Trash, FolderOpen } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { Edge } from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics";
import { AppNode, useFlowStore } from "@/lib/store";
import { nodeMetaDetails } from "@/lib/nodes";
import { parseFlow, ParsedFlow, riskyNodes, serializeFlow } from "@/lib/flow_file";
import { createFlow, deleteFlow, duplicateFlow, flushSave, openFlow, renameCurrent, useLibraryStore } from "@/lib/library";
import { compressToParam, decompressParam, sanitizeForSharing, SHARE_PREFIX } from "@/lib/share";
import { templates } from "@/lib/templates";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import ConfirmAlert from "../ui/confirm_alert";
import TestCasesDialog from "./test_cases";

const timeAgo = (ms: number) => {
    const s = Math.round((Date.now() - ms) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)} min ago`
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`
    return new Date(ms).toLocaleDateString()
}

/** Opens flows from files or share links: validates them, asks before opening flows that run code, and adds them to the library. */
function useFlowOpener() {
    const { toast } = useToast()
    const [pending, setPending] = useState<ParsedFlow & { risky: ReturnType<typeof riskyNodes>, fallbackName: string }>()

    const add = async (flow: ParsedFlow, fallbackName: string) => {
        setPending(undefined)
        // parseFlow has checked node types, ids and connections, so the data matches the editor's shape.
        await createFlow(flow.name || fallbackName, flow.nodes as unknown as AppNode[], flow.edges as Edge[])
        toast({ title: `Opened "${flow.name || fallbackName}"`, duration: 3000 })
    }

    const open = (text: string, fallbackName: string) => {
        try {
            const flow = parseFlow(text, nodeMetaDetails.map(x => x.type))
            if (flow.warnings.length) toast({ title: 'Some parts of the flow were fixed', description: flow.warnings.join('\n'), duration: 5000 })
            const risky = riskyNodes(flow.nodes)
            if (risky.length) setPending({ ...flow, risky, fallbackName })
            else add(flow, fallbackName)
        } catch (error) {
            toast({ title: 'This flow could not be opened', description: (error as Error).message, duration: 5000 })
        }
    }

    const dialog = (
        <ConfirmAlert
            open={!!pending}
            title="This flow runs code"
            description={pending ? `${pending.risky.map(x => `"${x.name}" ${x.reason}`).join(', ')} when you run it. Only open flows from people you trust.` : ''}
            confirmLabel="Open anyway"
            onConfirm={() => pending && add(pending, pending.fallbackName)}
            onCancel={() => setPending(undefined)}
        />
    )
    return { open, dialog }
}

function NewFlowDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const [name, setName] = useState('')
    const create = async (templateId?: string) => {
        const template = templates.find(t => t.id == templateId)
        const built = template?.build()
        await createFlow(name || template?.name || 'Untitled flow', built?.nodes, built?.edges)
        track('flow_created', { template: templateId || 'blank' })
        setName('')
        onOpenChange(false)
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-(--breakpoint-md) max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>New flow</DialogTitle>
                    <DialogDescription>Start from scratch or from an example. Examples run with the Test API too.</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="new-flow-name">Name</Label>
                    <Input id="new-flow-name" value={name} placeholder="Untitled flow" onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                    <button className="text-left border-2 border-dashed border-border rounded-md p-3 hover:bg-muted" onClick={() => create()}>
                        <span className="font-semibold text-sm">Blank flow</span>
                        <p className="text-xs text-muted-foreground">Just a Start node.</p>
                    </button>
                    {templates.map(t => (
                        <button key={t.id} className="text-left border border-border rounded-md p-3 hover:bg-muted" onClick={() => create(t.id)}>
                            <span className="font-semibold text-sm">{t.name}</span>
                            <p className="text-xs text-muted-foreground">{t.description}</p>
                        </button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function ShareDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
    const { toast } = useToast()
    const [link, setLink] = useState('')
    const [removed, setRemoved] = useState<string[]>([])

    // Build the link each time the dialog opens (the effect only starts the async work).
    useEffect(() => {
        if (!open) return
        const { nodes, edges } = useFlowStore.getState()
        const clean = sanitizeForSharing(nodes)
        Promise.resolve().then(() => setRemoved(clean.removed))
        compressToParam(serializeFlow(clean.nodes, edges, useLibraryStore.getState().currentName))
            .then(param => setLink(`${location.origin}${location.pathname}${SHARE_PREFIX}${param}`))
            .catch(error => toast({ title: 'Could not create a link', description: error.message }))
    }, [open, toast])

    const copy = async () => {
        await navigator.clipboard.writeText(link)
        track('share_link_copied')
        toast({ title: 'Link copied', duration: 2000 })
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) setLink(''); onOpenChange(o) }}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Share this flow</DialogTitle>
                    <DialogDescription>The whole flow is inside the link; nothing is uploaded. Anyone with the link can open a copy. API keys are never included.</DialogDescription>
                </DialogHeader>
                <div className="flex gap-1">
                    <Input aria-label="Share link" readOnly value={link || 'Creating link…'} onFocus={(e) => e.target.select()} />
                    <Button onClick={copy} disabled={!link} aria-label="Copy link"><Copy size={16} /></Button>
                </div>
                {removed.length ? <p className="text-xs text-muted-foreground">Removed from the link: {removed.join('; ')}.</p> : null}
                {link.length > 8000 ? <p className="text-xs text-amber-700 dark:text-amber-300">This link is long ({Math.round(link.length / 1000)}k characters). Some chat apps cut long links; use Export file instead if it does not open.</p> : null}
                <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function FlowMenu() {
    const { flows, currentId, currentName, ready } = useLibraryStore(useShallow(s => ({ flows: s.flows, currentId: s.currentId, currentName: s.currentName, ready: s.ready })))
    const [menuOpen, setMenuOpen] = useState(false)
    const [dialog, setDialog] = useState<'new' | 'share' | 'tests' | undefined>()
    const [deleting, setDeleting] = useState<{ id: string, name: string }>()
    const [name, setName] = useState(currentName)
    const opener = useFlowOpener()
    const { open: openText } = opener
    const { toast } = useToast()

    // Show the new name when another flow is opened or the flow is renamed elsewhere.
    const [shownName, setShownName] = useState(currentName)
    if (shownName !== currentName) {
        setShownName(currentName)
        setName(currentName)
    }

    // Open a flow from a share link once the library is ready.
    useEffect(() => {
        if (!ready || !location.hash.startsWith(SHARE_PREFIX)) return
        const param = location.hash.slice(SHARE_PREFIX.length)
        history.replaceState(null, '', location.pathname + location.search)
        decompressParam(param)
            .then(text => openText(text, 'Shared flow'))
            .catch(error => toast({ title: 'This share link could not be opened', description: error.message, duration: 5000 }))
    }, [ready, openText, toast])

    const choose = (action: () => void) => () => { setMenuOpen(false); action() }

    const importFile = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.flow,application/json'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (file) {
                openText(await file.text(), file.name.replace(/\.flow$|\.json$/i, ''))
                track('import_a_file')
            }
        }
        input.click()
    }

    const exportFile = async () => {
        await flushSave()
        const { nodes: all, edges } = useFlowStore.getState()
        // Files get passed around like share links, so the same secrets are left out.
        const { nodes, removed } = sanitizeForSharing(all)
        const data = serializeFlow(nodes, edges, currentName)
        const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `${currentName.replace(/[^\w-]+/g, '_') || 'flow'}.flow`
        a.click()
        URL.revokeObjectURL(url)
        if (removed.length) toast({ title: 'Secrets were left out of the file', description: `${removed.join(', ')}. Add them again after importing.`, duration: 6000 })
        track('export_a_file')
    }

    const commitName = () => { if (name.trim() && name != currentName) renameCurrent(name) }

    return (
        <Card className="p-1 flex items-center gap-1 pointer-events-auto max-w-[min(18rem,40vw)]">
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <PopoverTrigger asChild>
                    <Button variant="ghost" className="h-10 px-2 gap-1 min-w-0" aria-label={`${currentName || 'Loading'}, flows menu`}>
                        <span className="truncate font-semibold text-sm">{currentName || 'Loading…'}</span>
                        <ChevronDown size={16} className="shrink-0" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="p-2 w-80 flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                        <Label htmlFor="flow-name" className="text-xs">Flow name</Label>
                        <Input id="flow-name" className="h-8" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key == 'Enter') { commitName(); setMenuOpen(false) } }} />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(() => setDialog('new'))}><FilePlus2 size={14} /> New flow</Button>
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(() => currentId && duplicateFlow(currentId))}><Copy size={14} /> Duplicate</Button>
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(importFile)}><FileUp size={14} /> Import file</Button>
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(exportFile)}><Download size={14} /> Export file</Button>
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(() => setDialog('share'))}><Link2 size={14} /> Share link</Button>
                        <Button variant="outline" size="sm" className="justify-start gap-2" onClick={choose(() => setDialog('tests'))}><ListChecks size={14} /> Test cases</Button>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-semibold flex items-center gap-1 px-1 py-1"><FolderOpen size={12} /> Your flows</span>
                        <div className="max-h-64 overflow-y-auto flex flex-col">
                            {flows.map(f => (
                                <div key={f.id} className={`group flex items-center rounded-md ${f.id == currentId ? 'bg-muted' : 'hover:bg-muted'}`}>
                                    <button className="flex-1 text-left px-2 py-1.5 min-w-0" onClick={choose(() => openFlow(f.id))}>
                                        <span className="block text-sm truncate">{f.name}</span>
                                        <span className="block text-[11px] text-muted-foreground">{timeAgo(f.updatedAt)}</span>
                                    </button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-60 group-hover:opacity-100" aria-label={`Delete ${f.name}`} onClick={() => setDeleting({ id: f.id, name: f.name })}>
                                        <Trash size={14} />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            <NewFlowDialog open={dialog == 'new'} onOpenChange={(o) => setDialog(o ? 'new' : undefined)} />
            <ShareDialog open={dialog == 'share'} onOpenChange={(o) => setDialog(o ? 'share' : undefined)} />
            <TestCasesDialog open={dialog == 'tests'} onOpenChange={(o) => setDialog(o ? 'tests' : undefined)} />
            <ConfirmAlert
                open={!!deleting}
                title={`Delete "${deleting?.name}"?`}
                description="The flow and its run history are removed from this browser. This cannot be undone. Export it first if you may need it."
                confirmLabel="Delete flow"
                destructive
                onConfirm={() => { if (deleting) deleteFlow(deleting.id); setDeleting(undefined) }}
                onCancel={() => setDeleting(undefined)}
            />
            {opener.dialog}
        </Card>
    )
}
