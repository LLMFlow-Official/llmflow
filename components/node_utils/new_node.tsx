import { Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { useState } from "react";
import { randomId } from "@/lib/utils";
import { useFlowStore } from "@/lib/store";
import { nodeDetails } from "@/lib/nodes";
import { useShallow } from "zustand/shallow";
import { useReactFlow } from "@xyflow/react";
import { track } from "@/lib/analytics";

export default function NewNode() {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const { pushNode } = useFlowStore(useShallow((state) => ({
        pushNode:state.pushNode
    })))

    const { screenToFlowPosition } = useReactFlow()
 

    const filteredNodes = nodeDetails.filter(node => !node.notAddable).filter(node =>
        node.name.toLowerCase().includes(search.toLowerCase()) ||
        node.tags.join(" ").toLowerCase().includes(search.toLowerCase())
    );

    const handleNodeClick = (node: typeof nodeDetails[number]) => {
        setOpen(false);

        const reactFlowDiv = document.querySelector(".react-flow")
        if (!reactFlowDiv) return
        const center = screenToFlowPosition({x: reactFlowDiv.clientWidth / 2, y: reactFlowDiv.clientHeight / 2})

        pushNode({
            id: `${node.type}_${randomId()}`,
            type: node.type,
            position: center,
            data: {
                thread: randomId(),
            }
        });

        track('node_created', { type: node.type })
    }

    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setSearch('') }}>
            <PopoverTrigger asChild>
                <Button variant={open ? 'secondary' : 'ghost'} className="h-10 gap-1.5 px-3" toolTip="Add a step" aria-label="Add step">
                    <Plus size={18} /> <span className="hidden @xl:inline">Add step</span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" alignOffset={-2} sideOffset={10} side="bottom" className="p-0">
                <input
                    type="text"
                    placeholder="Search nodes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 text-sm px-2 w-full outline-hidden bg-transparent"
                />
                <div className="flex flex-col bg-card rounded-b-md border-t-2 border-accent h-[60vh] overflow-y-auto select-none">
                    {filteredNodes.length > 0 ? (
                        filteredNodes.map((node, index) => {
                            const Node = node.node;
                            return (
                                <div 
                                    key={index} 
                                    className="flex flex-col gap-2 p-2 items-stretch rounded-md cursor-pointer hover:bg-muted transition-colors duration-200"
                                    onClick={() => handleNodeClick(node)}
                                >
                                    <div className="flex items-center justify-center p-5 w-full bg-accent border border-border rounded-md">
                                      <Node id={''} data={{state: 'idle',thread: 'main'}} dragging={false} draggable={false} selectable={false} deletable={false} selected={false} isConnectable={false} positionAbsoluteX={0} positionAbsoluteY={0} type={''} zIndex={0} />
                                    </div>
                                    <div className="flex flex-col py-2">
                                        <span className="text-sm font-medium">{node.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {node.description}
                                        </span>
                                    </div>
                                </div>
                            )
                        })
                    ) : (
                        <div className="text-sm text-muted-foreground p-2">
                            No results found
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}