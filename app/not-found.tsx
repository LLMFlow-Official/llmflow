import Link from "next/link";

/** Shown for addresses that don't exist (the app itself lives at the home page). */
export default function NotFound() {
  return (
    <main className="h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center bg-background text-foreground">
      <h1 className="text-xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="text-sm text-muted-foreground">Your flows are on the home page.</p>
      <Link href="/" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">Open LLM Flow</Link>
    </main>
  )
}
