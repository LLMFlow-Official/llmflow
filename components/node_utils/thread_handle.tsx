import { useFlowStore } from "@/lib/store";
import { connectionProblem } from "@/lib/connections";
import { Handle, Position, Edge, Connection } from "@xyflow/react";

/** Node types whose source handle may connect to several nodes. */
export { BRANCHING_TYPES as multiSourceTypes } from "@/lib/connections";

type ThreadHandleProp = {
    active?: boolean
    type?: 'normal' | 'multi'
}

/** Whether a connection may be made (the reason is shown when it is dropped; see app/page.tsx). */
const isValidConnection = (connection: Edge | Connection) => {
    const { nodes, edges } = useFlowStore.getState()
    return connectionProblem(connection.source, connection.target, nodes, edges) == null
}

const HANDLE_CLASS = 'rounded-md! w-1/5! h-2! max-w-auto max-h-auto bg-muted-foreground! border-0!'

export function ThreadTargetHandle({ active = true }: ThreadHandleProp) {
    return active ? (<Handle
        type="target"
        position={Position.Top}
        className={HANDLE_CLASS}
        isValidConnection={isValidConnection}
    />) : null
}

export function ThreadSourceHandle({ active = true }: ThreadHandleProp) {
    return active ? (<Handle
        type="source"
        position={Position.Bottom}
        className={HANDLE_CLASS}
        isValidConnection={isValidConnection}
    />) : null
}
