import { AxiosError } from "axios";
import Decimal from "decimal.js-light";
import { Controller } from "@/lib/nodes";
import { useSettingStore } from "@/lib/store";
import { getModelStatus, OpenAi, OpenAiFaker, ResponseObject, ResponsesPayload, Usage, usageToCost } from "./index";

/** Turns an axios error from OpenAI into an Error carrying OpenAI's message. */
export function toOpenAiError(error: unknown): Error {
    if (error instanceof AxiosError && error.response?.data?.error?.message) {
        return new Error(error.response.data.error.message)
    }
    return error instanceof Error ? error : new Error(String(error))
}

/** Returns the API key, or null in Test API mode. Throws when neither is available. */
export function getApiKey(): string | null {
    const { openAIKey, devMode } = useSettingStore.getState()
    if (devMode?.testOpenAPI) return null
    if (!openAIKey) throw Error("You need to add OpenAI Token in the setting to continue or you can use test api on dev mode for testing")
    return openAIKey
}

export function isTestApi(): boolean {
    return useSettingStore.getState().devMode?.testOpenAPI || false
}

/** Fails early with a clear message when a node uses a model OpenAI has shut down. */
export function assertModelAvailable(model: string) {
    const status = getModelStatus(model)
    if (status.kind == 'retired') {
        throw Error(`${model} was shut down by OpenAI on ${status.shutdownDate}. Choose another model in this node's settings${status.replacement ? ` (OpenAI suggests ${status.replacement})` : ''}.`)
    }
}

/**
 * Sends a Responses API request (or returns the test output in Test API mode) and records the
 * token counts and cost on the run totals. Returns the raw response and timings.
 */
export async function runResponses(payload: ResponsesPayload, controller: Controller, testOutput?: string) {
    const token = getApiKey()
    if (token === null && !testOutput) throw Error("Test Output is required")
    assertModelAvailable(payload.model)

    const client = token === null ? OpenAiFaker(testOutput) : OpenAi(token)
    const startTime = Date.now()

    let response: ResponseObject
    try {
        response = (await client.create(payload)).data
    } catch (error) {
        throw toOpenAiError(error)
    }

    const endTime = Date.now()
    const cost = recordUsage(controller, response.usage, payload.model)
    return { response, cost, startTime, endTime }
}

/** Adds a response's tokens and cost to the run totals and returns the cost (null when unknown). */
export function recordUsage(controller: Controller, usage: Usage, model: string): Decimal | null {
    const cost = usageToCost(usage, model)
    controller.increaseInToken(usage.input_tokens)
    controller.increaseOutToken(usage.output_tokens)
    controller.increaseAmount(cost)
    return cost
}
