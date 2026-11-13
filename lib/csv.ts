/** Parses CSV text (RFC 4180: quoted fields, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let quoted = false
    const input = text.replace(/^﻿/, '')
    for (let i = 0; i < input.length; i++) {
        const c = input[i]
        if (quoted) {
            if (c == '"' && input[i + 1] == '"') { field += '"'; i++ }
            else if (c == '"') quoted = false
            else field += c
        } else if (c == '"') quoted = true
        else if (c == ',') { row.push(field); field = '' }
        else if (c == '\n' || c == '\r') {
            if (c == '\r' && input[i + 1] == '\n') i++
            row.push(field); field = ''
            if (row.some(x => x != '')) rows.push(row)
            row = []
        } else field += c
    }
    row.push(field)
    if (row.some(x => x != '')) rows.push(row)
    return rows
}

/** Reads CSV with a header row into objects keyed by column name. */
export function csvToRecords(text: string): { columns: string[], records: Record<string, string>[] } {
    const [header = [], ...rows] = parseCsv(text)
    const columns = header.map(x => x.trim())
    return { columns, records: rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? '']))) }
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
    const cell = (v: string | number | boolean | null | undefined) => {
        const s = v === null || v === undefined ? '' : String(v)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    return rows.map(r => r.map(cell).join(',')).join('\n')
}
