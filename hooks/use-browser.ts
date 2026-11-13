import { useSyncExternalStore } from "react"

const noop = () => () => { }

/** True once rendering in the browser (false while pre-rendering the static page). */
export function useIsClient(): boolean {
    return useSyncExternalStore(noop, () => true, () => false)
}

/** Whether a CSS media query matches, kept up to date as it changes. */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const list = window.matchMedia(query)
            list.addEventListener('change', onChange)
            return () => list.removeEventListener('change', onChange)
        },
        () => window.matchMedia(query).matches,
        () => false,
    )
}
