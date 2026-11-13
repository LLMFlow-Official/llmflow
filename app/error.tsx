"use client"

import { Button } from "@/components/ui/button";

/** Shown when the page crashes while rendering. */
export default function Error({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <div role="alert" className="h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-semibold">Something went wrong.</p>
      <p className="text-xs text-muted-foreground max-w-md break-words">{error.message}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>Try again</Button>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
      <p className="text-xs text-muted-foreground">Your flows are saved in this browser and are not lost.</p>
    </div>
  )
}
