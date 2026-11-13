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
    const inputRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        setValue('')
        if (request?.mode == 'text') inputRef.current?.focus()
    }, [request?.nodeId, request?.mode])

    if (!request) return null

    return (
        <Card className='absolute bottom-24 left-1/2 -translate-x-1/2 z-50 w-[min(520px,calc(100%-2rem))] p-4 flex flex-col gap-3 shadow-lg border-blue-600 border-2'>
            <div className='flex items-center gap-2 text-blue-600'>
                <UserRound className='w-5 h-5' />
                <span className='font-semibold text-sm'>{request.title}</span>
                {pending.length > 1 ? <span className='ml-auto text-xs text-gray-500'>{pending.length} waiting</span> : null}
            </div>
            {request.message ? (
                <div className='text-sm whitespace-pre-wrap max-h-48 overflow-y-auto bg-accent rounded-md p-2 border border-gray-300'>{request.message}</div>
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
                        value={value}
                        placeholder={request.placeholder || 'Type your answer…'}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key == 'Enter' && (e.metaKey || e.ctrlKey)) request.respond(value)
                        }}
                        className='min-h-[80px] rounded-md border border-input p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    />
                    <div className='flex items-center gap-2'>
                        <span className='text-xs text-gray-500'>⌘/Ctrl + Enter to send</span>
                        <Button className='ml-auto' onClick={() => request.respond(value)}>Continue</Button>
                    </div>
                </>
            ) : (
                <div className='flex gap-2 justify-end'>
                    <Button variant='outline' onClick={() => request.respond(null)}>Reject</Button>
                    <Button onClick={() => request.respond('approved')}>Approve</Button>
                </div>
            )}
        </Card>
    )
}
