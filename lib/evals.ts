export type CheckKind = 'none' | 'contains' | 'equals' | 'regex' | 'expression'

export type CheckResult = { passed: boolean | null, detail?: string }

/**
 * Compares an output with the expected value. "expression" checks are run elsewhere (in the sandboxed
 * worker); this handles the simple kinds. Matching ignores case and surrounding spaces.
 */
export function simpleCheck(kind: Exclude<CheckKind, 'expression'>, output: string, expected: string): CheckResult {
    if (kind == 'none') return { passed: null }
    const out = output.trim().toLowerCase()
    const exp = expected.trim().toLowerCase()
    if (kind == 'contains') return { passed: out.includes(exp) }
    if (kind == 'equals') return { passed: out == exp }
    try {
        return { passed: new RegExp(expected.trim(), 'i').test(output) }
    } catch (error) {
        return { passed: false, detail: `Invalid pattern: ${(error as Error).message}` }
    }
}
