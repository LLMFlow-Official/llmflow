"use client"

import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "./button";

type Props = {
    /** What crashed, e.g. "this panel". */
    label: string
    children: ReactNode
    /** Changing this value clears the error (e.g. the selected node id). */
    resetKey?: unknown
    compact?: boolean
}

type State = { error?: Error }

/** Shows a message instead of a blank screen when part of the app crashes while rendering. */
export default class ErrorBoundary extends Component<Props, State> {
    state: State = {}

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(error, info.componentStack)
    }

    componentDidUpdate(previous: Props) {
        if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined })
    }

    render() {
        if (!this.state.error) return this.props.children
        return (
            <div role="alert" className={this.props.compact ? "p-3 text-sm flex flex-col gap-2" : "h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center"}>
                <p className="font-semibold">Something went wrong in {this.props.label}.</p>
                <p className="text-xs text-muted-foreground max-w-md break-words">{this.state.error.message}</p>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => this.setState({ error: undefined })}>Try again</Button>
                    {!this.props.compact ? <Button size="sm" onClick={() => location.reload()}>Reload</Button> : null}
                </div>
                {!this.props.compact ? <p className="text-xs text-muted-foreground">Your flows are saved in this browser and are not lost.</p> : null}
            </div>
        )
    }
}
