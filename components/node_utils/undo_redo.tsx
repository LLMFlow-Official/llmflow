import { useTemporalFlowStore } from "@/lib/store";
import { useEffect } from "react";
import { Toggle } from "../ui/toggle";
import { Redo, Undo } from "lucide-react";
import { MOD_KEY, onCanvas } from "@/lib/utils";

export default function UndoRedo() {
    const { undo, redo, futureStates, pastStates } = useTemporalFlowStore((state) => state);

    useEffect(() => {
      // Listen on the document and act only when the canvas has focus (the canvas element is
      // created after this component and replaced when another flow is opened).
      const keyPressHandler = (e: KeyboardEvent) => {
          if (!(e.ctrlKey || e.metaKey) || !onCanvas(e)) return
          const key = e.key.toLowerCase()
          // Ctrl/⌘+Shift+Z and Ctrl/⌘+Y redo; Ctrl/⌘+Z undoes.
          if ((key == 'z' && e.shiftKey) || key == 'y') {
            e.preventDefault()
            redo()
          } else if (key == 'z') {
            e.preventDefault()
            undo()
          }
      }

      document.addEventListener('keydown', keyPressHandler);

      return () => document.removeEventListener('keydown', keyPressHandler)
  }, [redo, undo])

    return <>
     <Toggle toolTip={`Undo (${MOD_KEY}+Z)`} aria-label="Undo" onClick={() => undo()} disabled={pastStates.length == 0} >
        <Undo/>
      </Toggle>
      <Toggle toolTip={`Redo (${MOD_KEY}+Shift+Z)`} aria-label="Redo" onClick={() => redo()} disabled={futureStates.length == 0} >
        <Redo/>
      </Toggle>
    </>
}