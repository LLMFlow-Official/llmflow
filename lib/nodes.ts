import type React from "react";
import * as StartNode from "@/components/nodes/start";
import * as PromptNode from "@/components/nodes/prompt";
import * as MultiThreadNode from "@/components/nodes/multi_thread";
import * as ThreadMergeNode from "@/components/nodes/thread_merge";
import * as DecisionNode from "@/components/nodes/decision";
import * as ConsoleLogNode from "@/components/nodes/console_log";
import * as SetStateNode from "@/components/nodes/set_state";
import * as LlmRouterNode from "@/components/nodes/llm_router";
import * as WebSearchNode from "@/components/nodes/web_search";
import * as ImageGenerationNode from "@/components/nodes/image_generation";
import * as TextTemplateNode from "@/components/nodes/text_template";
import * as JsonExtractNode from "@/components/nodes/json_extract";
import * as SplitTextNode from "@/components/nodes/split_text";
import * as CodeNode from "@/components/nodes/code";
import * as HttpRequestNode from "@/components/nodes/http_request";
import * as HumanInputNode from "@/components/nodes/human_input";
import * as AssertNode from "@/components/nodes/assert";
import * as DelayNode from "@/components/nodes/delay";
import * as FinalOutputNode from "@/components/nodes/final_output";
import * as LoopNode from "@/components/nodes/loop";
import * as TranscriptionNode from "@/components/nodes/transcription";
import * as SemanticSearchNode from "@/components/nodes/semantic_search";
import * as ModelCompareNode from "@/components/nodes/model_compare";
import * as SubFlowNode from "@/components/nodes/sub_flow";

import { AppNode, FinalOutput, NodeLogs, UpdatePayload } from "./store";
import Decimal from "decimal.js-light";
import { Edge } from "@xyflow/react";

export type NodeType = "start" | "prompt" | "multi_thread" | "thread_merge" | "decision" | "console_log" | "set_state"
    | "llm_router" | "web_search" | "image_generation" | "text_template" | "json_extract" | "split_text"
    | "code" | "http_request" | "human_input" | "assert" | "delay" | "final_output" | "loop" | "transcription" | "semantic_search" | "model_compare" | "sub_flow"

const nodes = [
    StartNode,
    PromptNode,
    MultiThreadNode,
    ThreadMergeNode,
    DecisionNode,
    ConsoleLogNode,
    SetStateNode,
    LlmRouterNode,
    WebSearchNode,
    ImageGenerationNode,
    TextTemplateNode,
    JsonExtractNode,
    SplitTextNode,
    CodeNode,
    HttpRequestNode,
    HumanInputNode,
    AssertNode,
    DelayNode,
    FinalOutputNode,
    LoopNode,
    TranscriptionNode,
    SemanticSearchNode,
    ModelCompareNode,
    SubFlowNode,
];

export type NodeState = 'idle' | 'faded' | 'waiting' | 'running' | 'completed' | 'failed' | 'skipped';

export type OutputExtra =  {
    [key: string] : string | number | object | unknown | undefined
}

export type AppContext = {
    [key: string]: {
        [key: string] : string | number | object | undefined
    }
}

export type Controller = {
    log: <T=unknown>(payload:NodeLogs<T>) => void;
    /** Where Final Output nodes send their value (a sub-flow collects them instead of showing them). */
    addFinalOutput?: (output: FinalOutput) => void;
    increaseInToken: (amount: number) => void;
    increaseOutToken: (amount: number) => void;
    increaseAmount:(amount: Decimal | null) => void;
}

export type NodeOutput = {
    [key: string]: {
        title: string
        description?: string
        value?: string | number 
    }
}

export type NodeLogViewProps<T = unknown> = {
    node?: AppNode;
    payload: T
}

export type NodeLogView = (props: NodeLogViewProps) => React.JSX.Element
export type NodeOutputs = ( node: AppNode, extra: OutputExtra ) => NodeOutput
export type NodeProcess = (context: AppContext, node: AppNode, nextNodes: AppNode[], Controller: Controller) => Promise<AppNode[]>

export type NodeConnectDisconnectPayload = {
    nodes: AppNode[]
    edges: Edge[]
    sourceNode: AppNode
    targetNode: AppNode
    connectedEdge?: Edge 
}
export type NodeOnConnectDisconnect = (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => Promise<void>

/** Groups steps in the Add step list and gives each its colour on the canvas. */
export type NodeCategory = 'start' | 'ai' | 'logic' | 'data' | 'io'

export type NodeMetaData<T = unknown> = {
    type: NodeType;
    name: string;
    description: string;
    category: NodeCategory;
    tags: string[],
    notAddable?: boolean;
    defaultData?: T,
    valueIdentifier?: (node: AppNode) => string;
    OnConnect?: NodeOnConnectDisconnect;
    OnDisconnect?: NodeOnConnectDisconnect;
    /** For loop nodes: the targets the node runs itself, once per item (see lib/engine.ts). */
    bodyTargets?: (node: AppNode) => string[];
}

export type NodeDetails = NodeMetaData & {
    node: typeof StartNode.Node;
    properties: typeof StartNode.Properties;
    process: NodeProcess;
    outputs?: NodeOutputs;
    logView?: NodeLogView;
}

export const nodeMetaDetails = nodes.map(x => x.Metadata);

export const nodeDetails: NodeDetails[] = nodes.map(x => ({
    ...(x.Metadata as unknown as NodeMetaData),
    node: x.Node,
    properties: x.Properties,
    process: x.Process,
    outputs: 'Outputs' in x ? x.Outputs as NodeOutputs : undefined,
    logView: 'LogView' in x ? x.LogView as NodeLogView : undefined
} as NodeDetails));

export const nodeMap = Object.fromEntries(nodeDetails.map(node => [node.type, node.node]));

export const getNodeDetails = (type: NodeType) => {
    const node = nodeDetails.find(node => node.type === type);
    if (!node) {    
        throw new Error(`Node with type ${type} not found`);
    }
    return node;
}
