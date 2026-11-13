import { useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-browser";
import { Monitor, Moon, Sun } from "lucide-react";
import { useSettingStore } from "@/lib/store";
import { Button } from "../ui/button";

const order = ['system', 'light', 'dark'] as const
const labels = { system: 'Theme: same as your device', light: 'Theme: light', dark: 'Theme: dark' }

/** Whether the dark theme is showing, following the setting (and the device when set to "system"). */
export function useIsDark() {
    const theme = useSettingStore((s) => s.theme)
    const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
    return theme == 'dark' || (theme == 'system' && systemDark)
}

/** Puts the "dark" class on the page when the dark theme is on. */
export function ThemeController() {
    const dark = useIsDark()
    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark)
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
        // The browser bar follows the app's theme, not only the device's.
        for (const meta of Array.from(document.querySelectorAll('meta[name="theme-color"]'))) {
            meta.setAttribute('content', dark ? '#020817' : '#ffffff')
        }
    }, [dark])
    return null
}

export default function ThemeToggle() {
    const theme = useSettingStore((s) => s.theme)
    const setSettings = useSettingStore((s) => s.setSettings)
    const next = order[(order.indexOf(theme) + 1) % order.length]
    const Icon = theme == 'dark' ? Moon : theme == 'light' ? Sun : Monitor
    return (
        <Button size="icon" variant="ghost" toolTip={labels[theme]} aria-label={`${labels[theme]}. Switch to ${next}.`} onClick={() => setSettings({ theme: next })}>
            <Icon size={20} />
        </Button>
    )
}
