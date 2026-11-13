import { get } from "lodash";
import { AppContext } from "./nodes";
import safeEval from 'safe-eval'

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

export const replaceDynamicValueWithDummyValues = (statement: string) => {
    const filteredStatement = filterStatement(statement)
    const allTemplateWords = filteredStatement.match(valueReg) || []
    const valueMap = Object.fromEntries(allTemplateWords.map(x => [x, 0]))
    return Object.keys(valueMap).reduce((c, x) => {
        return c.replaceAll(x, JSON.stringify(valueMap[x]) as string)
    }, filteredStatement) 
}

export const runStatement = (statement: string, context: AppContext) => {
    const logic = `(function () { return ${replaceDynamicValueWithValueRef(statement)} })()`
    try {
        return safeEval(logic, context)
    } catch (error) {
        console.log(logic, error);
        return false
    }
}

export const validateStatement = (statement: string = '') => {
    const logic = `(function () { return ${replaceDynamicValueWithDummyValues(statement)} })()`
    try {
        safeEval(logic)
        return true
    } catch {
        return false
    }
}