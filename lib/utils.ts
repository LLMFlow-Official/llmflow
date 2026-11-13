import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const trimStrings = (text?: string, maxLength: number = 15) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
const isMac = typeof navigator != 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** The modifier key name for keyboard shortcuts on this computer. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl'

/** A short random id, e.g. for new nodes ("prompt_9f3a1c…"). */
export const randomId = () => Math.random().toString(16).slice(2)
