"use client"

import { ReactNode, useEffect } from "react";
import { useIsClient } from "@/hooks/use-browser";
import { Network } from "lucide-react";
import BaseLayout from "./base_layout";
import IntroSlider from "./intro_slider";
import { Toaster } from "../ui/toaster";
import ErrorBoundary from "../ui/error_boundary";
import { setupAnalytics } from "@/lib/analytics";
import { useSettingStore } from "@/lib/store";

/**
 * Everything that needs the browser. The app depends on what is saved in this browser (settings,
 * flows), so it renders after mounting; the pre-rendered page shows a short loading screen. This
 * avoids React hydration mismatches between the static HTML and the browser.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const mounted = useIsClient()
  const analyticsEnabled = useSettingStore((s) => s.analyticsEnabled)

  useEffect(() => {
    if (mounted) setupAnalytics(analyticsEnabled)
  }, [mounted, analyticsEnabled])

  if (!mounted) {
    return (
      <div className="h-dvh flex items-center justify-center bg-background text-muted-foreground" aria-busy="true">
        <Network className="animate-pulse mr-2" aria-hidden /> Loading LLM Flow…
      </div>
    )
  }

  return (
    <ErrorBoundary label="the app">
      <IntroSlider />
      <BaseLayout>{children}</BaseLayout>
      <Toaster />
    </ErrorBoundary>
  )
}
