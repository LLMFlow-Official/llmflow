import { Copy, Maximize2 } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { track } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";

/** Shows model output as formatted Markdown, with a copy button and a larger view. */
export default function MarkdownViewer({ text }: { text: string }) {
    const { toast } = useToast()
    const copy = async () => {
        await navigator.clipboard.writeText(text)
        toast({ title: 'Copied', duration: 1500 })
    }

    return (
        <div className='rounded-md relative group'>
            <div className="bg-accent px-2 py-1 text-xs rounded-md max-h-40 overflow-y-auto border border-border RichEditor-root markdown-inline wrap-break-word">
                <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            </div>
            <div className="absolute top-1 right-1 flex gap-0.5 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                <Button toolTip="Copy" aria-label="Copy text" variant="ghost" className="h-6 w-6" size="icon" onClick={copy}>
                    <Copy size={10} />
                </Button>
                <Dialog onOpenChange={(open) => { if (open) track('markdown_viewer_opened') }}>
                    <DialogTrigger asChild>
                        <Button toolTip="Open larger" aria-label="Open larger" variant="ghost" className="h-6 w-6" size="icon">
                            <Maximize2 size={10} />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-(--breakpoint-xl) overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Output</DialogTitle>
                            <DialogDescription>Formatted as Markdown.</DialogDescription>
                        </DialogHeader>
                        <div className="border border-border p-3 max-h-[65vh] overflow-y-auto rounded-md RichEditor-root">
                            <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
                        </div>
                        <DialogFooter>
                            <Button onClick={copy}>Copy</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    )
}
