import { Button } from "./button"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./alert-dialog"

type ConfirmAlertProps = {
    open: boolean,
    title: string,
    description: string,
    /** The action, e.g. "Delete flow" (default "Confirm"). */
    confirmLabel?: string
    /** Style the confirm button as a destructive action. */
    destructive?: boolean
    onConfirm: () => void
    onCancel: () => void
}

/** Asks before an action. Escape and Cancel both cancel. */
export default function ConfirmAlert({ open, title, description, confirmLabel = 'Confirm', destructive, onConfirm, onCancel }: ConfirmAlertProps) {
    return (
        <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
