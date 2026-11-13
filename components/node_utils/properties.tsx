import { getNodeDetails } from "@/lib/nodes";
import { useFlowStore, useSettingStore } from "@/lib/store"
import { useMemo } from "react";
import { Card, CardTitle } from "../ui/card";
import OnErrorSettingsSection from "./on_error_settings";

/** Steps that call a model, a server or code, where retrying or carrying on after a failure makes sense. */
const CAN_FAIL = ['prompt', 'llm_router', 'web_search', 'image_generation', 'transcription', 'semantic_search', 'ai_decisions', 'model_compare', 'http_request', 'code', 'sub_flow', 'json_extract']

export default function Properties() {
    const selectedNode = useFlowStore((state) => state.selectedNode)
    const isDevMode = useSettingStore(state => state.devMode)

    const nodeDetails = useMemo(() => {
        return selectedNode ? getNodeDetails(selectedNode.type) : null;
    }, [selectedNode]);

    const PropertiesComponent = nodeDetails?.properties;

    if (!selectedNode) {
        return (
            <div className="flex flex-col items-center justify-center h-full">
                <p className="text-muted-foreground">No step selected</p>
                <p className="text-sm text-muted-foreground">Select a step on the canvas to change its settings</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="border-b border-border p-3">
                <h2 className="font-bold">{nodeDetails?.name}</h2>
                <p className="text-xs text-muted-foreground">{nodeDetails?.description}</p>
                {isDevMode ? (
                    // Ids are what references use ({id.output}); only needed when working with them directly.
                    <p className="mt-2 text-xs"><span className="font-semibold">Step id:</span> <span className="text-muted-foreground font-mono">{selectedNode.id}</span></p>
                ) : null}
            </div>
            <div className="flex-1 overflow-y-auto py-3">
                {isDevMode?.showPropData ? <div className="px-2 pb-2"><Card className="p-2">
                    <CardTitle className="text-sm">Node Data</CardTitle>
                    <p className="text-muted-foreground whitespace-pre-wrap text-xs mt-2">{JSON.stringify(selectedNode.data, null, 4)}</p>
                </Card></div> : null}
                {PropertiesComponent && <PropertiesComponent key={selectedNode.id} node={selectedNode} />}
                {CAN_FAIL.includes(selectedNode.type) || selectedNode.data.on_error ? <OnErrorSettingsSection key={`on-error-${selectedNode.id}`} node={selectedNode} /> : null}
            </div>
        </div>
    )
}