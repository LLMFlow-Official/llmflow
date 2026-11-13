import { useEffect } from "react";
import { create } from "zustand";
import { Keyboard } from "lucide-react";
import { MOD_KEY } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";

/** Every keyboard shortcut, as shown in the Keyboard shortcuts dialog. */
export const SHORTCUTS: { keys: string, what: string, where?: string }[] = [
    { keys: `${MOD_KEY} Enter`, what: 'Run the flow, or stop it while it runs' },
    { keys: `${MOD_KEY} K`, what: 'Find a step' },
    { keys: `${MOD_KEY} Z`, what: 'Undo', where: 'canvas' },
    { keys: `${MOD_KEY} Shift Z`, what: 'Redo (also Ctrl Y)', where: 'canvas' },
    { keys: `${MOD_KEY} C / X / V`, what: 'Copy, cut and paste steps', where: 'canvas' },
    { keys: `${MOD_KEY} D`, what: 'Duplicate the selected steps', where: 'canvas' },
    { keys: 'Delete', what: 'Delete the selected steps or connections', where: 'canvas' },
    { keys: 'Shift drag', what: 'Select several steps', where: 'canvas' },
    { keys: 'Esc', what: 'Close the step settings' },
    { keys: '{', what: 'Insert a value from an earlier step', where: 'text fields' },
    { keys: '↑ ↓ Enter', what: 'Choose in the Add step list and value suggestions' },
    { keys: 'Enter / Shift Enter', what: 'Send / new line', where: 'Build chat' },
    { keys: '?', what: 'Show this list' },
]

export const useShortcutsDialog = create<{ open: boolean }>()(() => ({ open: false }))

/** True when a key press is typing (text box, editor) or happens inside a dialog. */
export function isTypingOrDialog(e: KeyboardEvent) {
    const target = e.target instanceof Element ? e.target : null
    return !!target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], .monaco-editor')
}

/** The Keyboard shortcuts dialog, opened with "?" or the keyboard button in the top bar. */
export function ShortcutsDialog() {
    const open = useShortcutsDialog(s => s.open)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key != '?' || e.ctrlKey || e.metaKey || e.altKey || isTypingOrDialog(e)) return
            e.preventDefault()
            useShortcutsDialog.setState({ open: true })
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])
    return (
        <Dialog open={open} onOpenChange={(o) => useShortcutsDialog.setState({ open: o })}>
            <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription>&quot;Canvas&quot; shortcuts work after clicking the canvas.</DialogDescription>
                </DialogHeader>
                <table className="text-sm w-full">
                    <tbody>
                        {SHORTCUTS.map(s => (
                            <tr key={s.keys + s.what} className="border-t border-border first:border-0">
                                <td className="py-1.5 pr-4 whitespace-nowrap"><kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">{s.keys}</kbd></td>
                                <td className="py-1.5">{s.what}{s.where ? <span className="text-muted-foreground"> ({s.where})</span> : null}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </DialogContent>
        </Dialog>
    )
}

export function ShortcutsButton() {
    return (
        <Button size="icon" variant="ghost" toolTip="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => useShortcutsDialog.setState({ open: true })}>
            <Keyboard size={18} />
        </Button>
    )
}
