import { NameField, NodeShell } from '../node_utils/node_shell';
import { CircleHelp, PenBox } from 'lucide-react';
import { Card } from '../ui/card';
import { AppContext, getNodeDetails, NodeConnectDisconnectPayload, NodeMetaData } from '@/lib/nodes';
import { useFlowStore, AppNode, AppNodeProp, UpdatePayload, createStopSignal } from '@/lib/store';
import { CodeStoppedError } from '@/lib/code_runner';
import { cloneDeep, get, set } from 'lodash';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { useMemo, useState } from 'react';

import { useShallow } from 'zustand/shallow';
import { getOutgoers } from '@xyflow/react';
import { runStatement } from '@/lib/logics';
import { Button } from '../ui/button';
import DynamicEditorPopup from '../node_utils/dynamic_editor_popup';
import { Textarea } from '../ui/textarea';

export const OnConnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    const edge = payload.connectedEdge
    if (!edge || payload.sourceNode.type != 'decision') return
    updates.edges[edge.id] = {
        animated: true,
        label: 'Name and Condition required',
        labelBgPadding: [5, 5]
    }
}

export const OnDisconnect = async (payload: NodeConnectDisconnectPayload, updates: UpdatePayload) => {
    if (payload.sourceNode.type != 'decision') return
    set(updates, `nodes.${payload.sourceNode.id}.data.decisions.${payload.targetNode.id}`, null)
}

export const Metadata: NodeMetaData = {
    type: 'decision',
    category: 'logic',
    icon: CircleHelp,
    name: 'Decision',
    description: 'Follow one branch based on conditions you write. The first true condition wins; add an Else branch for everything else.',
    tags: ['if', 'question', 'condition'],
    OnConnect,
    OnDisconnect,
}

export const Process = async (context: AppContext, node: AppNode, nextNodes: AppNode[]) => {

    const allDecisions = (node.data.decisions || {}) as {
        [key: string]: {
            name: string;
            condition: string;
        }
    }

    const { signal, dispose } = createStopSignal()
    try {
        for (const nextNode of nextNodes) {
            const decision = allDecisions[nextNode.id]
            if (!decision?.condition || decision.condition == 'else') continue
            if (await runStatement(decision.condition, context, signal)) return [nextNode]
        }
    } catch (error) {
        if (error instanceof CodeStoppedError) return []
        throw error
    } finally {
        dispose()
    }

    const elseNode = nextNodes.find(nextNode => allDecisions[nextNode.id]?.condition == 'else')
    return elseNode ? [elseNode] : []
}

export const Properties = ({ node }: { node: AppNode }) => {
    const [conditionEditorNode, setConditionEditorNode] = useState<{
        nodeId: string
        condition?: string
    }>()

    const { updateNode, updateEdge, nodes, edges } = useFlowStore(useShallow(state => ({
        updateNode: state.updateNode,
        updateEdge: state.updateEdge,
        nodes: state.nodes,
        edges: state.edges
    })));


    const updateDecisionEdge = (clonedNode: AppNode, targetNodeId: string) => {
        const currentEdge = edges.find(x => x.source == node.id && x.target == targetNodeId)
        if (!currentEdge) return;
        const clonedEdge = cloneDeep(currentEdge);
        const haveLogic = !!get(clonedNode, `data.decisions.${targetNodeId}.condition`);
        const haveName = !!get(clonedNode, `data.decisions.${targetNodeId}.name`);
        const label = get(clonedNode, `data.decisions.${targetNodeId}.name`);

        const error = haveLogic && haveName ? "" : (haveName ? " (Condition required)" : haveLogic ? " (Name required)" : "Name and Condition required")

        clonedEdge.animated = !haveLogic;
        clonedEdge.label = `${label || ''}${error}`;

        updateEdge(clonedEdge);
    }

    const setNodeValue = (nodeId: string, key: string, value: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.decisions.${nodeId}.${key}`, value);
        set(clonedNode, `data.decisions.${nodeId}.type`, 'normal');
        updateNode(clonedNode);
        updateDecisionEdge(clonedNode, nodeId);
    }

    const outgoers = useMemo(() => getOutgoers(node, nodes, edges).map(x => ({
        oNode: x,
        oNodeDetails: getNodeDetails(x.type)
    })), [node, nodes, edges])

    const alreadyHaveElse = useMemo(() => outgoers.some(({ oNode }) => get(node, `data.decisions.${oNode.id}.type`) == 'else'), [node, outgoers])

    const markAsElse = (nodeId: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.decisions.${nodeId}.type`, 'else');
        set(clonedNode, `data.decisions.${nodeId}.name`, 'Else');
        set(clonedNode, `data.decisions.${nodeId}.condition`, 'else');
        updateNode(clonedNode);
        updateDecisionEdge(clonedNode, nodeId);
    }

    const clearElse = (nodeId: string) => {
        const clonedNode = cloneDeep(node);
        set(clonedNode, `data.decisions.${nodeId}`, {});
        updateNode(clonedNode);
        updateDecisionEdge(clonedNode, nodeId);
    }

    const onChangeConditionEditorPopup = (condition: string) => {
        if (!conditionEditorNode) return
        setNodeValue(conditionEditorNode.nodeId, 'condition', condition)
        setConditionEditorNode(undefined)
    }

    return (
        <div className='flex flex-col gap-3 px-3'>
            <NameField node={node as AppNode} placeholder={Metadata.name} />
            <div>
                <Label>Decisions</Label>
                {outgoers.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Connect this step to the steps it can choose between.</div>
                ) : (
                    outgoers.map(({ oNode, oNodeDetails }, index) => (
                        <Card key={index} className="flex flex-col mb-2 p-3 border-b border-border">
                            <span className='text-sm font-semibold'>{oNode.data.name ? `${oNode.data.name} (${oNodeDetails.name})` : `${oNodeDetails.name} (${oNode.id})`}</span>

                            {get(node, `data.decisions.${oNode.id}.type`) == 'else' ?
                                (<div className='mt-2'>
                                    <Button variant='outline' className='w-full' onClick={() => clearElse(oNode.id)}>Turn off Else for this branch</Button>
                                </div>)
                                :
                                (<>
                                    <div className="flex flex-col mb-1 gap-2 mt-2">
                                        <Label className='text-sm' htmlFor={`branch-name-${oNode.id}`}>Branch name</Label>
                                        <Input
                                            id={`branch-name-${oNode.id}`}
                                            name="name"
                                            disabled={get(node, `data.decisions.${oNode.id}.type`) == 'else'}
                                            value={get(node, `data.decisions.${oNode.id}.name`, '')}
                                            onChange={(e) => setNodeValue(oNode.id, 'name', e.target.value)}
                                        />
                                    </div>
                                    <div className="flex flex-col mb-1 gap-2">
                                        <Label className='text-sm' htmlFor={`branch-condition-${oNode.id}`}>Condition</Label>
                                        <div className='flex gap-2 items-start'>
                                            <Textarea
                                                id={`branch-condition-${oNode.id}`}
                                                name="condition"
                                                readOnly
                                                disabled={get(node, `data.decisions.${oNode.id}.type`) == 'else'}
                                                value={get(node, `data.decisions.${oNode.id}.condition`, '')}
                                                withoutRichText
                                                classNameFrame='flex-1'
                                            />
                                            <Button toolTip="Edit the condition" aria-label="Edit the condition" size={'icon'} variant="outline" onClick={() => setConditionEditorNode({
                                                nodeId: oNode.id,
                                                condition: get(node, `data.decisions.${oNode.id}.condition`, '')
                                            })}>
                                                <PenBox size={16} />
                                            </Button>
                                        </div>
                                    </div>
                                </>)}
                            {!alreadyHaveElse && outgoers.length > 1 && (!get(node, `data.decisions.${oNode.id}.name`) && !get(node, `data.decisions.${oNode.id}.condition`)) ? <Button className='mt-2' variant={'ghost'} onClick={() => markAsElse(oNode.id)}>Use as Else (when no other condition is true)</Button> : null}
                        </Card>
                    ))
                )}
            </div>
            <DynamicEditorPopup type='condition' open={!!conditionEditorNode} value={conditionEditorNode?.condition} baseNode={node} onChange={(condition) => onChangeConditionEditorPopup(condition)} onClose={() => setConditionEditorNode(undefined)} />
        </div>
    )
}

export function Node(props: AppNodeProp) {
    return <NodeShell {...props} icon={Metadata.icon} defaultName={Metadata.name} category={Metadata.category} sourceType='multi' />
}
