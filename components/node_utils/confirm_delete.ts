import { getNodeDetails } from "@/lib/nodes";
import { stepsUsing } from "@/lib/references";
import { AppNode, useFlowStore } from "@/lib/store";
import { askToConfirm } from "../ui/confirm_host";

const nameOf = (node: AppNode) => (node.data.name as string) || getNodeDetails(node.type).name

/** Before deleting steps that other steps use, says which ones and asks. Resolves true to delete. */
export async function confirmDeleteSteps(ids: string[]): Promise<boolean> {
    const nodes = useFlowStore.getState().nodes
    const deleting = nodes.filter(n => ids.includes(n.id))
    const users = stepsUsing(ids, nodes)
    if (!deleting.length || !users.length) return true
    const names = users.slice(0, 3).map(n => `"${nameOf(n)}"`).join(', ') + (users.length > 3 ? ` and ${users.length - 3} more` : '')
    return askToConfirm({
        title: deleting.length == 1 ? `Delete "${nameOf(deleting[0])}"?` : `Delete ${deleting.length} steps?`,
        description: `${names} ${users.length == 1 ? 'uses' : 'use'} ${deleting.length == 1 ? 'its' : 'their'} values. Those values will be empty until you change ${users.length == 1 ? 'that step' : 'those steps'}.`,
        confirmLabel: deleting.length == 1 ? 'Delete step' : 'Delete steps',
        destructive: true,
    })
}
