import dynamic from "next/dynamic"
import { ChangeEvent, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Braces, PenBox } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog"

import { Button } from "./button"
import { AppNode } from "@/lib/store"
import { TemplateInput } from "./template_input"
import DynamicEditorPopup from "../node_utils/dynamic_editor_popup"

// Monaco and TipTap are large; they load only when an editor dialog opens.
const JsonEditor = dynamic(() => import("./json_editor"), { ssr: false, loading: () => <div className="h-[30vh] rounded-md bg-muted animate-pulse" /> })
const RichTextEditor = dynamic(() => import("./rich_text_editor"), { ssr: false, loading: () => <div className="h-[60vh] rounded-md bg-muted animate-pulse" /> })


export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  node?: AppNode
  type?: 'text' | 'json'
  schema?: object
  withoutHighlights?: boolean
  withoutRichText?: boolean
  classNameFrame?: string
}

export function Textarea({ className, classNameFrame, withoutRichText, type = 'text', schema, withoutHighlights, node, value, onChange, placeholder, id, readOnly, disabled, 'aria-label': ariaLabel }: TextareaProps) {
  const [openValueSelector, setOpenValueSelector] = useState(false)
  // Where the cursor was, so a picked value goes there instead of at the end.
  const cursor = useRef<number | null>(null)

  // Remount the rich editor after the value selector closes, so it shows the inserted value.
  const [key, setKey] = useState(0)
  const closeValueSelector = () => { setOpenValueSelector(false); setKey(k => k + 1) }

  return (
    <div className={cn('relative group rounded-md', classNameFrame)}>
      <TemplateInput
        value={value?.toString() || ''}
        onChange={(text) => onChange && onChange({ target: { value: text } } as ChangeEvent<HTMLTextAreaElement>)}
        highlight={!withoutHighlights}
        nodeId={node?.id}
        onCursor={(position) => { cursor.current = position }}
        className={cn("min-h-[80px] h-20 overflow-y-auto", className)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        id={id}
        readOnly={readOnly}
        disabled={disabled}
      />
      {node || !withoutRichText ? <div className="absolute top-1 right-2 flex gap-1 p-1 bg-muted rounded-md transition-opacity duration-100 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto z-10">
        {node ? <Button toolTip="Insert a value from an earlier step" aria-label="Insert a value from an earlier step" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpenValueSelector(true)}>
          <Braces size={16} />
        </Button> : null}
        {!withoutRichText ? <Dialog>
          <DialogTrigger asChild>
            <Button toolTip={type == 'text' ? "Open a larger editor" : "Edit as JSON"} aria-label={type == 'text' ? "Open a larger editor" : "Edit as JSON"} variant="ghost" className="h-6 w-6" size="icon">
              <PenBox size={16} />
            </Button>
          </DialogTrigger>

          <DialogContent className={cn('overflow-y-auto', type =='json' ? "max-w-(--breakpoint-md)": "max-w-(--breakpoint-xl)")}>
            {type == 'text' ? <DialogHeader>
              <DialogTitle>Larger editor</DialogTitle>
              <DialogDescription>Changes are saved as you type. You can format with headings, lists and bold text, and paste from a Word document.</DialogDescription>
            </DialogHeader> : <DialogHeader>
              <DialogTitle>Edit JSON</DialogTitle>
              <DialogDescription>Changes are saved as you type. Problems in the JSON are listed under the editor.</DialogDescription>
            </DialogHeader>}
            {type == 'text' ?
              <RichTextEditor
                key={key}
                initialContent={value?.toString() || ''}
                onChange={(value) => onChange && onChange({ target: { value } } as ChangeEvent<HTMLTextAreaElement>)}
                withoutHighlights={withoutHighlights}
                nodeId={node?.id}
                extraToolButtons={node && (
                  <Button size="icon" variant="ghost" toolTip="Insert a value from an earlier step" aria-label="Insert a value from an earlier step" onClick={() => setOpenValueSelector(true)}>
                    <Braces size={16} />
                  </Button>
                )}
              />
              :
              <JsonEditor
                defaultValue={value?.toString() || ''}
                schema={schema}
                onChange={(value) => onChange && onChange({ target: { value } } as ChangeEvent<HTMLTextAreaElement>)}
              />
            }
            <DialogFooter>
              <DialogClose asChild>
                <Button onClick={() =>
                  onChange && onChange({
                    target: {
                      value: value
                    }
                  } as React.ChangeEvent<HTMLTextAreaElement>)
                }>Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog> : null}
      </div> : null}
      {node ? (
        <DynamicEditorPopup
          type="value"
          open={openValueSelector}
          baseNode={node}
          onChange={(s) => {
            if (onChange) {
              const text = value?.toString() || ''
              const at = Math.min(cursor.current ?? text.length, text.length)
              onChange({ target: { value: text.slice(0, at) + s + text.slice(at) } } as ChangeEvent<HTMLTextAreaElement>);
              cursor.current = at + s.length
            }
            closeValueSelector();
          }}
          onClose={closeValueSelector}
        />
      ) : null}
    </div>
  )
}
