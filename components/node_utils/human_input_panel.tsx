import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { useRuntimeStore } from '@/lib/store';
import { Card } from '../ui/card';
import { Button } from '../ui/button';

/** Floating card that answers Human Input nodes while a run waits for them. */
export default function HumanInputPanel() {
    const pending = useRuntimeStore((s) => s.pendingInputs)
    const request = pending[0]
    const [value, setValue] = useState('')
    const card = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)

    const requestKey = request ? `${request.nodeId}:${request.mode}` : ''
    const [shownKey, setShownKey] = useState(requestKey)
    if (shownKey !== requestKey) {
        setShownKey(requestKey)
        setValue('')
    }
    // Move focus to the question in every mode, so it can't be missed (or answered by accident).
    useEffect(() => {
        if (!requestKey) return
        if (requestKey.endsWith(':text')) inputRef.current?.focus()
        else card.current?.querySelector<HTMLElement>('input, button[data-primary]')?.focus()
    }, [requestKey])

    if (!request) return null

    return (
        <Card
            ref={card}
            role='dialog'
            aria-labelledby='human-input-title'
            aria-describedby={request.message ? 'human-input-message' : undefined}
            data-own-shortcuts
            className='absolute bottom-24 left-1/2 -translate-x-1/2 z-50 w-[min(520px,calc(100%-2rem))] p-4 flex flex-col gap-3 shadow-lg border-info border-2'
        >
            <div className='flex items-center gap-2 text-info'>
                <UserRound className='w-5 h-5' aria-hidden />
                <span id='human-input-title' className='font-semibold text-sm'>The flow needs you: {request.title}</span>
                {pending.length > 1 ? <span className='ml-auto text-xs text-muted-foreground'>{pending.length} waiting</span> : null}
            </div>
            {request.message ? (
                <div id='human-input-message' className='text-sm whitespace-pre-wrap max-h-48 overflow-y-auto bg-accent rounded-md p-2 border border-border'>{request.message}</div>
            ) : null}
            {request.mode == 'file' ? (
                <div className='flex flex-col gap-2'>
                    <input
                        type='file'
                        aria-label='Choose a file'
                        accept={request.accept}
                        className='text-sm'
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) request.respond(file) }}
                    />
                    <div className='flex justify-end'>
                        <Button variant='outline' onClick={() => request.respond(null)}>Skip</Button>
                    </div>
                </div>
            ) : request.mode == 'text' ? (
                <>
                    <textarea
                        ref={inputRef}
                        aria-label='Your answer'
                        value={value}
                        placeholder={request.placeholder || 'Type your answer…'}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key == 'Enter' && (e.metaKey || e.ctrlKey)) {
                                // Keep the app-wide ⌘/Ctrl+Enter (run / stop) from also stopping the run.
                                e.preventDefault()
                                e.stopPropagation()
                                request.respond(value)
                            }
                        }}
                        className='min-h-[80px] rounded-md border border-input p-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'
                    />
                    <div className='flex items-center gap-2'>
                        <span className='text-xs text-muted-foreground'>⌘/Ctrl + Enter to send</span>
                        <Button data-primary className='ml-auto' onClick={() => request.respond(value)}>Continue</Button>
                    </div>
                </>
            ) : (
                <div className='flex gap-2 justify-end'>
                    <Button variant='outline' onClick={() => request.respond(null)}>Reject (skip the next steps)</Button>
                    <Button data-primary onClick={() => request.respond('approved')}>Approve</Button>
                </div>
            )}
        </Card>
    )
}
