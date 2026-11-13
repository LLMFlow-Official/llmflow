/** Thrown when work is cancelled because the user stopped the flow. The engine does not report it as a failure. */
export class StoppedError extends Error {
    constructor() {
        super('Stopped')
        this.name = 'StoppedError'
    }
}

export const isStopped = (error: unknown) => error instanceof StoppedError || (error instanceof Error && error.name == 'StoppedError')
