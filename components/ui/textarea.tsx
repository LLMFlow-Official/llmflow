import dynamic from "next/dynamic"
import { ChangeEvent, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { PenBox, Route } from "lucide-react"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTrigger } from "./dialog"
import { DialogTitle } from "@radix-ui/react-dialog"
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

  const [key, setKey] = useState(Math.random() * 1000)

  useEffect(() => {
    if (!openValueSelector)
      setKey(Math.random() * 1000)
  }, [openValueSelector])

  return (
    <div className={cn('relative group overflow-hidden rounded-md', classNameFrame)}>
      <TemplateInput
        value={value?.toString() || ''}
        onChange={(text) => onChange && onChange({ target: { value: text } } as ChangeEvent<HTMLTextAreaElement>)}
        highlight={!withoutHighlights}
        nodeId={node?.id}
        className={cn("min-h-[80px] h-20 overflow-y-auto", className)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        id={id}
        readOnly={readOnly}
        disabled={disabled}
      />
      {node || !withoutRichText ? <div className="absolute -top-12 right-2 flex gap-1 p-1 bg-muted rounded-md transition-all duration-100 group-hover:top-1 z-10">
        {node ? <Button toolTip="Value Selector" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setOpenValueSelector(true)}>
          <Route size={16} />
        </Button> : null}
        {!withoutRichText ? <Dialog>
          <DialogTrigger asChild>
            <Button toolTip={type == 'text' ? "Rich Editor" : "JSON Editor"} variant="ghost" className="h-6 w-6" size="icon">
              <PenBox size={16} />
            </Button>
          </DialogTrigger>

          <DialogContent className={cn('overflow-y-auto', type =='json' ? "max-w-screen-md": "max-w-screen-xl")}>
            {type == 'text' ? <DialogHeader>
              <DialogTitle>
                <h2 className="text-lg font-medium">Rich Text Editor</h2>
              </DialogTitle>
              <DialogDescription>
                <p className="text-sm text-muted-foreground">Edit the content of the textarea using the rich text editor. also you can copy the content from docx file.</p>
              </DialogDescription>
            </DialogHeader> : <DialogHeader>
              <DialogTitle>
                <h2 className="text-lg font-medium">Json Editor</h2>
              </DialogTitle>
              <DialogDescription>
                <p className="text-sm text-muted-foreground">Edit the JSON content directly in the editor. Ensure the JSON structure is valid to avoid errors.</p>
              </DialogDescription>
            </DialogHeader>}
            {type == 'text' ?
              <RichTextEditor
                key={key}
                initialContent={value?.toString() || ''}
                onChange={(value) => onChange && onChange({ target: { value } } as ChangeEvent<HTMLTextAreaElement>)}
                withoutHighlights={withoutHighlights}
                nodeId={node?.id}
                extraToolButtons={node && (
                  <Button size="icon" variant="ghost" aria-label="Value selector" onClick={() => setOpenValueSelector(true)}>
                    <Route size={16} />
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
              onChange({ target: { value: (value || '') + s } } as ChangeEvent<HTMLTextAreaElement>);
            }
            setOpenValueSelector(false);
          }}
          onClose={() => setOpenValueSelector(false)}
        />
      ) : null}
    </div>
  )
}
