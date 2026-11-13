import { useToast } from "@/hooks/use-toast";
import { AppNode, useFlowStore, useTemporalFlowStore } from "@/lib/store";
import { Edge, useReactFlow } from "@xyflow/react";
import { PropsWithChildren, useCallback, useEffect } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from "../ui/context-menu";
import { Clipboard, Copy, CopyPlus, Redo, Scissors, Trash, Undo } from "lucide-react";
import { MOD_KEY, onCanvas } from "@/lib/utils";

type ClipboardData = {
    node: AppNode[],
    edge: Edge[]
}

/**
 * Adds copies of nodes (and the connections between them) to the flow, centred on `at`. Ids are
 * renewed everywhere in the copied data, so routes and {node.value} references point at the copies.
 */
export function insertCopies(copied: AppNode[], copiedEdges: Edge[], at: { x: number, y: number }) {
    const { nodes, edges, setEdges, setNodes } = useFlowStore.getState()
    const source = copied.filter(x => x.id != 'start')
    if (!source.length) return
    const centerX = source.reduce((c, x) => c + x.position.x, 0) / source.length
    const centerY = source.reduce((c, x) => c + x.position.y, 0) / source.length
    const threadPostfix = Math.random().toString(16).slice(2).substring(0, 3)

    const idMap = Object.fromEntries(source.map(x => [x.id, `${x.type}_${Math.random().toString(16).slice(2)}`]))
    const renew = (value: unknown) => {
        let text = JSON.stringify(value)
        for (const [oldId, newId] of Object.entries(idMap)) text = text.split(oldId).join(newId)
        return JSON.parse(text)
    }

    const copies = source.map(x => {
        const data = renew(x.data)
        data.state = 'idle'
        data.parentId = data.parentId && Object.values(idMap).includes(data.parentId) ? data.parentId : undefined
        data.thread = `${data.thread}_${threadPostfix}`
        return {
            ...x,
            id: idMap[x.id],
            data,
            selected: true,
            position: { x: x.position.x - centerX + at.x, y: x.position.y - centerY + at.y },
        } as AppNode
    })

    const copiedEdgeList = copiedEdges
        .filter(x => idMap[x.source] && idMap[x.target])
        .map(x => ({ ...renew(x), id: `edge_${Math.random().toString(16).slice(2)}`, source: idMap[x.source], target: idMap[x.target], selected: false } as Edge))

    setNodes([...nodes.map(x => ({ ...x, selected: false })), ...copies])
    setEdges([...edges.map(x => ({ ...x, selected: false })), ...copiedEdgeList])
}

export default function FlowContextMenu({ children }: PropsWithChildren) {
    const { toast } = useToast();
    const { screenToFlowPosition } = useReactFlow()
    const hasSelection = useFlowStore((state) => state.nodes.some(x => x.selected && x.id != 'start'))
    const { undo, redo, futureStates, pastStates } = useTemporalFlowStore((state) => state);

    const cut = useCallback(() => {
        const { nodes, edges, setEdges, setNodes } = useFlowStore.getState()

        const selectedNode = nodes.filter(x => x.selected && x.id != 'start')
        const selectedEdge = edges.filter(x => x.selected && x.source != 'start' && x.target != 'start')
        const selectedNodeIds = selectedNode.map(x => x.id)

        if (selectedNode.length == 0 && selectedEdge.length == 0) return

        setNodes(nodes.filter(x => !x.selected || x.id == 'start'))
        setEdges(edges.filter(x => !selectedNodeIds.includes(x.source) && !selectedNodeIds.includes(x.target)))

        navigator.clipboard.writeText(JSON.stringify({
            node: selectedNode,
            edge: selectedEdge
        } as ClipboardData));
    }, [])

    const copy = useCallback(() => {
        const { nodes, edges } = useFlowStore.getState()

        const selectedNode = nodes.filter(x => x.selected && x.id != 'start')
        const selectedEdge = edges.filter(x => x.selected && x.source != 'start' && x.target != 'start')

        if (selectedNode.length == 0 && selectedEdge.length == 0) return

        navigator.clipboard.writeText(JSON.stringify({
            node: selectedNode,
            edge: selectedEdge
        } as ClipboardData));
    }, [])

    const past = useCallback(async () => {
        try {
            const permission = await navigator.permissions.query({ name: 'clipboard-read' } as unknown as PermissionDescriptor);
            if (permission.state === 'denied') {
                throw new Error('Not allowed to read clipboard.');
            }

            const clipboardData = JSON.parse(await navigator.clipboard.readText()) as ClipboardData

            const reactFlowDiv = document.querySelector(".react-flow")
            if (!reactFlowDiv) return
            const center = screenToFlowPosition({ x: reactFlowDiv.clientWidth / 2, y: reactFlowDiv.clientHeight / 2 })

            const filteredNodes = clipboardData.node.filter(x => x.id != 'start')
            const filteredEdges = clipboardData.edge.filter(x => x.source != 'start' && x.target != 'start')

            insertCopies(filteredNodes, filteredEdges, center)
        } catch (error) {
            toast({
                title: `Something went wrong`,
                description: (error as Error).message,
                duration: 3000
            })
        }
    }, [screenToFlowPosition, toast])

    const duplicate = useCallback(() => {
        const { nodes, edges } = useFlowStore.getState()
        const selected = nodes.filter(x => x.selected && x.id != 'start')
        if (!selected.length) return
        const ids = new Set(selected.map(x => x.id))
        const cx = selected.reduce((c, x) => c + x.position.x, 0) / selected.length
        const cy = selected.reduce((c, x) => c + x.position.y, 0) / selected.length
        insertCopies(selected, edges.filter(e => ids.has(e.source) && ids.has(e.target)), { x: cx + 40, y: cy + 40 })
    }, [])

    const remove = useCallback(() => {
        const { nodes, edges, onNodesChange, onEdgesChange } = useFlowStore.getState()
        const nodeIds = nodes.filter(x => x.selected && x.id != 'start').map(x => x.id)
        const edgeIds = edges.filter(x => x.selected || nodeIds.includes(x.source) || nodeIds.includes(x.target)).map(x => x.id)
        onEdgesChange(edgeIds.map(id => ({ type: 'remove', id })))
        onNodesChange(nodeIds.map(id => ({ type: 'remove', id })))
    }, [])

    useEffect(() => {
        // Listen on the document and act only when the canvas has focus: the canvas element is
        // created later than this component and replaced when another flow is opened.
        const keyPressHandler = (e: KeyboardEvent) => {
            if (!onCanvas(e)) return
            if ((e.ctrlKey || e.metaKey) && e.key == 'x') {
                cut()
            }

            if ((e.ctrlKey || e.metaKey) && e.key == 'c') {
                copy()
            }

            if ((e.ctrlKey || e.metaKey) && e.key == 'v') {
                past()
            }

            if ((e.ctrlKey || e.metaKey) && e.key == 'd') {
                e.preventDefault()
                duplicate()
            }
        }

        document.addEventListener('keydown', keyPressHandler);

        return () => document.removeEventListener('keydown', keyPressHandler)
    }, [copy, cut, past, duplicate])

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
                <ContextMenuItem disabled={pastStates.length == 0} onClick={() => undo()}>
                    <Undo size={16} className="mr-2" /> Undo
                    <ContextMenuShortcut>{MOD_KEY}+Z</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={futureStates.length == 0} onClick={() => redo()}>
                    <Redo size={16} className="mr-2" /> Redo
                    <ContextMenuShortcut>{MOD_KEY}+⇧+Z</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasSelection} onClick={duplicate}>
                    <CopyPlus size={16} className="mr-2" /> Duplicate
                    <ContextMenuShortcut>{MOD_KEY}+D</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasSelection} onClick={cut}>
                    <Scissors size={16} className="mr-2" /> Cut
                    <ContextMenuShortcut>{MOD_KEY}+X</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasSelection} onClick={copy}>
                    <Copy size={16} className="mr-2" /> Copy
                    <ContextMenuShortcut>{MOD_KEY}+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onClick={past}>
                    <Clipboard size={16} className="mr-2" /> Paste
                    <ContextMenuShortcut>{MOD_KEY}+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem disabled={!hasSelection} onClick={remove} className="text-red-600">
                    <Trash size={16} className="mr-2" /> Delete
                    <ContextMenuShortcut>Del</ContextMenuShortcut>
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}