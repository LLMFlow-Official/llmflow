import { get } from "lodash";
import { AppContext } from "./nodes";
import { CodeStoppedError, expressionBody, isValidExpression, runCodeInWorker } from "./code_runner";

export const valueReg = new RegExp('\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', 'gm')

export const headlights = [
    {
        highlight: valueReg,
        className: "font-semibold text-blue-600 bg-white", //tw
    },
]

const filterStatement = (statement: string) => {
    if(!statement) return ''
    return statement.replaceAll(/(?<![<>!])=(?!=)/g, "==").replaceAll('===', '==');
}

export const replaceDynamicValueWithActual = (statement: string, context: AppContext) => {
    const filteredStatement = filterStatement(statement)
    const allTemplateWords = filteredStatement.match(valueReg) || []
    const valueMap = Object.fromEntries(allTemplateWords.map(x => [x, get(context, x.substring(1, x.length - 1)) as unknown as string]))
    return Object.keys(valueMap).reduce((c, x) => {
        return c.replaceAll(x, valueMap[x] as string)
    }, filteredStatement) 
}

// A value reference looks like {nodeId.key}, {nodeId.key.nested} or {state.variable}.
const referencePath = /^\s*([A-Za-z_$][\w$-]*)((?:\.[\w$-]+|\[\d+\])+)\s*$/
// Node ids are "start" or "<type>_<hex>" (see new_node.tsx and flow_context_menu.tsx); "state" is the Set State namespace.
const referenceRoot = /^(start|state|[a-z_]+_[0-9a-f]+)$/

const stringifyValue = (value: unknown): string => {
    if (value === undefined || value === null) return ''
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
}

/**
 * Fills {nodeId.key} references in free text (prompts, log messages) with values from the run context.
 *
 * Unlike replaceDynamicValueWithActual, it does not rewrite "=" to "==", leaves braces that are not
 * value references untouched (JSON examples, code), turns objects into JSON instead of
 * "[object Object]", and turns missing values into an empty string instead of "undefined".
 */
export const renderTextTemplate = (text: string, context: AppContext) => {
    if (!text) return ''
    return text.replace(valueReg, (match, inner: string) => {
        const parsed = referencePath.exec(inner)
        if (!parsed) return match
        const root = parsed[1]
        if (!(root in context) && !referenceRoot.test(root)) return match
        return stringifyValue(get(context, inner.trim()))
    })
}

export const replaceDynamicValueWithValueRef = (statement: string) => {
    const filteredStatement = filterStatement(statement)
    const allTemplateWords = filteredStatement.match(valueReg) || []
    return allTemplateWords.reduce((c, x) => {
        return c.replaceAll(x, x.substring(1,x.length -1))
    }, filteredStatement) 
}

/** True when the statement (with {node.key} references) is a valid JavaScript expression. Never runs it. */
export const validateStatement = (statement: string = '') => isValidExpression(replaceDynamicValueWithValueRef(statement))

/**
 * Evaluates a Decision / Set State / Assert expression in the sandboxed worker and returns its value.
 * Throws a readable error when the expression is invalid or fails, and CodeStoppedError when the
 * flow is stopped.
 */
export const runStatement = async (statement: string, context: AppContext, signal?: AbortSignal): Promise<unknown> => {
    const expression = replaceDynamicValueWithValueRef(statement)
    if (!isValidExpression(expression)) throw new Error(`This is not a valid expression: ${statement}`)
    try {
        const { result } = await runCodeInWorker(expressionBody(expression), context, 5000, signal)
        return result
    } catch (error) {
        if (error instanceof CodeStoppedError) throw error
        throw new Error(`The expression "${statement}" failed: ${(error as Error).message}`)
    }
}
