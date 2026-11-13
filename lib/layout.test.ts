import { describe, expect, it } from 'vitest'
import { autoLayout } from './layout'

const node = (id: string, x = 0, type?: string) => ({ id, type, position: { x, y: 0 }, measured: { width: 100, height: 40 } })

describe('autoLayout', () => {
    it('puts each node one layer below its lowest parent', () => {
        const nodes = [node('start', 0, 'start'), node('a'), node('b'), node('merge')]
        const edges = [{ source: 'start', target: 'a' }, { source: 'start', target: 'b' }, { source: 'a', target: 'merge' }, { source: 'b', target: 'merge' }]
        const result = Object.fromEntries(autoLayout(nodes, edges).map(x => [x.id, x.position]))
        expect(result.start.y).toBe(0)
        expect(result.a.y).toBe(150)
        expect(result.b.y).toBe(150)
        expect(result.merge.y).toBe(300)
        // a and b sit side by side, centred under start
        expect(result.a.x + result.b.x + 100).toBe(0)
    })

    it('keeps the original left-to-right order and ignores cycles', () => {
        const nodes = [node('start', 0, 'start'), node('right', 500), node('left', -500)]
        const edges = [{ source: 'start', target: 'right' }, { source: 'start', target: 'left' }, { source: 'right', target: 'start' }]
        const result = Object.fromEntries(autoLayout(nodes, edges).map(x => [x.id, x.position]))
        expect(result.left.x).toBeLessThan(result.right.x)
    })
})
