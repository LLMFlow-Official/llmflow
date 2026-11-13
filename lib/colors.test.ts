import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Colours come from the theme tokens in app/globals.css (danger, success, warning, info, running,
 * brand and the node categories), so light and dark mode stay consistent and red only ever means
 * an error, stop or delete. This fails when a Tailwind palette colour such as text-red-600 is used.
 */
const PALETTE = /\b(?:bg|text|border|outline|ring|fill|stroke|decoration|placeholder|from|to|via|divide|shadow)-(?:red|green|blue|amber|orange|yellow|lime|emerald|cyan|sky|indigo|gray|slate|zinc|neutral|stone|violet|purple|fuchsia|teal|rose|pink)-\d{2,3}\b/g

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return files(path)
        return /\.(tsx?|css)$/.test(name) ? [path] : []
    })
}

describe('theme colours', () => {
    it('uses theme tokens instead of palette colours', () => {
        const found = ['components', 'app', 'hooks'].flatMap(dir => files(dir)).flatMap(path =>
            readFileSync(path, 'utf8').split('\n').flatMap((line, i) => (line.match(PALETTE) || []).map(m => `${path}:${i + 1} ${m}`)))
        expect(found).toEqual([])
    })
})
