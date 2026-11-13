/* eslint-disable @next/next/no-img-element */
'use client'

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCallback, useEffect, useState } from "react"
import { versionData } from "./logo"
import { track } from "@/lib/analytics";
import { MessageSquareText, Plus, Sparkles } from "lucide-react";
import { useSettingStore } from "@/lib/store";
import { availableProviders } from "@/lib/providers";
import { templates } from "@/lib/templates";
import { createFromTemplate } from "./new_flow";
import { showPanelTab } from "../node_utils/panel_tab";

export default function IntroSlider() {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(1)
  const [count, setCount] = useState(4)
  const [shareUsage, setShareUsage] = useState(false)
  const [open, setOpen] = useState(() => {
    let seen: string | null = null
    try { seen = localStorage.getItem('introVersion') } catch { /* ignore */ }
    return versionData.introVersion != seen
  })

  useEffect(() => {
    if (!api) return
    const onSelect = () => {
      setCount(api.scrollSnapList().length)
      setCurrent(api.selectedScrollSnap() + 1)
    }
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => { api.off("select", onSelect); api.off("reInit", onSelect) }
  }, [api])

  // Closing at any point (a button, Escape, clicking outside) counts as seen, and as the answer to
  // the analytics question (off unless the box was ticked).
  const handleClose = useCallback((how: string = 'closed') => {
    setOpen(false)
    try { localStorage.setItem('introVersion', versionData.introVersion) } catch { /* ignore */ }
    const settings = useSettingStore.getState()
    if (!settings.analyticsAsked) settings.setSettings({ analyticsEnabled: shareUsage, analyticsAsked: true })
    track('intro_finished', { how, slide: current })
  }, [shareUsage, current])

  const noKey = () => !availableProviders().length

  const tryExample = async () => {
    if (noKey()) useSettingStore.getState().setSettings({ sampleAnswers: true })
    handleClose('example')
    await createFromTemplate(templates[0]?.id)
  }

  const describe = () => {
    handleClose('build')
    if (noKey()) useSettingStore.getState().setSettings({ sampleAnswers: true })
    showPanelTab('build')
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Describe the flow or the change"]')?.focus(), 100)
  }

  const slides = [
    {
      title: "Build AI workflows without code",
      content: "Connect steps on a canvas: ask a model, branch on its answer, go through a list, call an API. Each step shows its result, cost and time.",
      image: "/idea.svg",
    },
    {
      title: "Start the way you like",
      content: "Pick an example, describe what you want in the Build tab and let the assistant build it, or add steps yourself with + Add step.",
      image: "/bulb.svg",
    },
    {
      title: "Try it for free",
      content: "With sample answers on, every step returns a sample result, so you can build and run flows without an API key. Add a key for OpenAI, Claude or Gemini in Settings when you are ready. Keys stay in this browser.",
      image: "/list.svg",
    },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="sr-only">Welcome to LLM Flow</DialogTitle>
        </DialogHeader>
        <div className="mx-auto max-w-xl w-full">
          <Carousel setApi={setApi} className="w-full max-w-lg mx-auto">
            <CarouselContent>
              {slides.map((slide, index) => (
                <CarouselItem key={index}>
                  <img src={slide.image} alt="" className="w-full h-40 sm:h-56 object-contain mb-4 rounded-md" />
                  <h3 className="text-lg font-semibold mb-1">{slide.title}</h3>
                  <p className="text-sm text-muted-foreground">{slide.content}</p>
                </CarouselItem>
              ))}
              <CarouselItem>
                <h3 className="text-lg font-semibold mb-1">Ready to start?</h3>
                <p className="text-sm text-muted-foreground mb-4">You can always come back to these from the flow menu and the Build tab.</p>
                <div className="flex flex-col gap-2">
                  <Button onClick={tryExample} className="justify-start gap-2"><Sparkles size={16} /> Try an example</Button>
                  <Button variant="outline" onClick={describe} className="justify-start gap-2"><MessageSquareText size={16} /> Describe a flow in Build</Button>
                  <Button variant="outline" onClick={() => handleClose('blank')} className="justify-start gap-2"><Plus size={16} /> Start from scratch</Button>
                </div>
                <label className="mt-5 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={shareUsage} onChange={(e) => setShareUsage(e.target.checked)} />
                  <span>
                    Share anonymous usage data to help improve LLM Flow
                    <span className="block text-xs text-muted-foreground">Which buttons and step types are used. Never prompts, outputs or keys. Nothing is sent unless you tick this; you can change it in Settings.</span>
                  </span>
                </label>
              </CarouselItem>
            </CarouselContent>
          </Carousel>
          <div className="flex items-center justify-between mt-4 gap-2">
            {current > 1
              ? <Button onClick={() => api?.scrollPrev()} variant="outline">Back</Button>
              : <span />}
            <span className="text-xs text-muted-foreground" aria-live="polite">{current} of {count}</span>
            {current < count ? (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => api?.scrollTo(count - 1)}>Skip</Button>
                <Button onClick={() => api?.scrollNext()}>Next</Button>
              </div>
            ) : <span />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
