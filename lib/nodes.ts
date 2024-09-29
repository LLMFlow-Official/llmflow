import * as StartNode from "@/components/nodes/start";
import * as PromptNode from "@/components/nodes/prompt";
import * as MultiTreadNode from "@/components/nodes/multi_thread";
import * as TreadMergeNode from "@/components/nodes/thread_merge";
import * as DecisionNode from "@/components/nodes/decision";
import { AppNode } from "./store";

export type NodeType = 'start' | 'prompt' | 'multi_thread' | 'thread_merge' | 'decision'

const nodes = [
    StartNode,
    PromptNode,
    MultiTreadNode,
    TreadMergeNode,
    DecisionNode
];

export type NodeState = 'idle' | 'faded' | 'waiting' | 'running' | 'completed' | 'failed';

export type OutputExtra =  {
    [key: string] : string | number | object | undefined
}

export type AppContext = {
    [key: string]: {
        [key: string] : string | number | object | undefined
    }
}

export type StatsUpdater = {
    log: (...logs:unknown[]) => void;
    increaseInToken: (amount: number) => void;
    increaseOutToken: (amount: number) => void;
    increaseAmount:(amount: number) => void;
}

export type NodeOutput = {
    [key: string]: {
        title: string
        description?: string
        value?: string | number 
    }
}

export type NodeOutputs = ( node: AppNode, extra: OutputExtra ) => NodeOutput
export type NodeProcess = (context: AppContext, node: AppNode, nextNodes: AppNode[], statsUpdater: StatsUpdater) => Promise<AppNode[]>
export type NodeOnDisconnect = (node: AppNode, otherNode: AppNode, updates: { [key: string]: unknown }) => Promise<void>

export type NodeMetaData = {
    type: NodeType;
    name: string;
    description: string;
    tags: string[],
    notAddable?: boolean;
    OnDisconnect?: NodeOnDisconnect;
}

export type NodeDetails = NodeMetaData & {
    node: typeof StartNode.Node;
    properties: typeof StartNode.Properties;
    process: NodeProcess;
    outputs?: NodeOutputs;
}

export const nodeDetails: NodeDetails[] = nodes.map(x => ({
    ...x.Metadata,
    node: x.Node,
    properties: x.Properties,
    process: x.Process,
    outputs: 'Outputs' in x ? x.Outputs as NodeOutputs : undefined
}));

export const nodeTypes = Object.fromEntries(nodeDetails.map(node => [node.type, node.node]));

export const getNodeDetails = (type: NodeType) => {
    const node = nodeDetails.find(node => node.type === type);
    if (!node) {    
        throw new Error(`Node with type ${type} not found`);
    }
    return node;
}
