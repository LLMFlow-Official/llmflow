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

export default function IntroSlider() {
  const [api, setApi] = useState<CarouselApi>()
  const [current, setCurrent] = useState(0)
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [isFinished, setIsFinished] = useState(false)


  useEffect(() => {
    let seen: string | null = null
    try { seen = localStorage.getItem('introVersion') } catch { /* ignore */ }
    setOpen(versionData.introVersion != seen)
  }, [])

  useEffect(() => {
    if (!api) {
      return
    }

    setCount(api.scrollSnapList().length)
    setCurrent(api.selectedScrollSnap() + 1)

    api.on("select", () => {
      const newCurrent = api.selectedScrollSnap() + 1
      setCurrent(newCurrent)
      if (newCurrent === count) {
        setIsFinished(true)
      }
    })
  }, [api, count])

  // Closing at any point (button, Escape, clicking outside) counts as seen.
  const handleClose = useCallback(() => {
    setOpen(false)
    try { localStorage.setItem('introVersion', versionData.introVersion) } catch { /* ignore */ }
    track('intro_finished', { skipped: !isFinished })
  }, [isFinished])

  const handleSkip = handleClose

  const slides = [
    {
      title: "Have a Business Idea Which Needs AI?",
      content: "You've come to the right place. Our platform is designed to help you seamlessly integrate AI into your business model, providing you with the tools and support you need to succeed.",
      image: "/bulb.svg",
    },
    {
      title: "Discover LLM Flow",
      content: "LLM Flow is a web application that enables you to test and refine your AI workflows without any coding. It also helps to create proof of concept from flow charts, making it easier to visualize and iterate on your ideas.",
      image: "/idea.svg",
    },
    {
      title: "Create Your First Node",
      content: "Imagine crafting a poem writer that composes a short poem about flowers and translates it into German. With our intuitive interface, you can easily build and customize nodes to suit your specific needs.",
      image: "/create_a_node.gif",
    },
    {
      title: "Define Your Instructions",
      content: "Choose the model, set your system prompt and user prompts. Our platform supports a variety of models, allowing you to tailor your AI's behavior to achieve the best results.",
      image: "/instructions.gif",
    },
    {
      title: "Build Your Flow",
      content: "Add the translator node to your flow. Our drag-and-drop interface makes it simple to connect nodes and create complex workflows with ease.",
      image: "/add_second.gif",
    },
    {
      title: "Add Your API Key",
      content: "Open Settings and add a key for OpenAI, Anthropic (Claude), Google (Gemini) or your own OpenAI-compatible server. Keys stay in your browser. No key yet? Turn on the Test API in Developer mode to try everything for free.",
      image: "/set_key.gif",
    },
    {
      title: "Execute Your Concept",
      content: "Press Play (or Ctrl/⌘ + Enter) to watch your flow run: answers stream in live, with tokens, cost and time for every step. Past runs are kept in History.",
      image: "/run.gif",
    },
  ]

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="sr-only">Welcome to LLM Flow</DialogTitle>
        </DialogHeader>
        <div className="mx-auto max-w-xl">
          <Carousel setApi={setApi} className="w-full max-w-lg">
            <CarouselContent>
              {slides.map((slide, index) => (
                <CarouselItem key={index}>
                  {Math.abs(index + 1 - current) <= 1 ? (
                    <img
                      src={slide.image}
                      alt=""
                      loading="lazy"
                      className="w-full h-72 object-contain mb-4 rounded-md"
                    />
                  ) : <div className="w-full h-72 mb-4" aria-hidden />}
                  <h3 className="text-lg font-semibold mb-1">{slide.title}</h3>
                  <p className="text-sm text-muted-foreground">{slide.content}</p>
                </CarouselItem>
              ))}
              <CarouselItem className="">
                <img
                  src='/list.svg'
                  alt="Benefits"
                  className="w-full h-32 object-contain mb-4 rounded-md"
                />
                <h3 className="text-lg font-semibold mb-1">We Offer!</h3>
                <div className="text-sm text-muted-foreground px-5">
                  <ul className="list-disc">
                    <li>OpenAI, Claude, Gemini and your own servers</li>
                    <li>Live answers, cost and time for every step</li>
                    <li>Branches, loops, LLM routing and sub-flows</li>
                    <li>Web search, images, transcription and semantic search</li>
                    <li>Structured JSON output with a visual editor</li>
                    <li>Test cases, run history and model comparison</li>
                    <li>Many flows, templates and share links</li>
                    <li>A free Test API for trying things out</li>
                  </ul>
                </div>
              </CarouselItem>
            </CarouselContent>
          </Carousel>
          <div className="flex justify-between mt-4">
            {current != 1 ?
              <Button
                onClick={() => api?.scrollPrev()}
                disabled={current === 1}
                variant="outline"
              >
                Back
              </Button>
              :
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkip}
              >
                Skip
              </Button>
            }
            <Button
              onClick={() => current === count ? handleClose() : api?.scrollNext()}
              variant={current === count ? "default" : "outline"}
            >
              {current === count ? "Get Started" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}