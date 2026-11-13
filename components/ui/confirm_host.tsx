import { create } from "zustand"
import ConfirmAlert from "./confirm_alert"

type Question = {
    title: string
    description: string
    confirmLabel?: string
    destructive?: boolean
    resolve: (yes: boolean) => void
}

const useQuestion = create<{ question?: Question }>()(() => ({}))

/** Asks the user to confirm an action and resolves true or false (Escape and Cancel give false). */
export function askToConfirm(question: Omit<Question, 'resolve'>): Promise<boolean> {
    useQuestion.getState().question?.resolve(false)
    return new Promise(resolve => useQuestion.setState({ question: { ...question, resolve } }))
}

/** Shows the questions from askToConfirm. Mounted once in the layout. */
export function ConfirmHost() {
    const question = useQuestion(s => s.question)
    const answer = (yes: boolean) => {
        question?.resolve(yes)
        useQuestion.setState({ question: undefined })
    }
    return (
        <ConfirmAlert
            open={!!question}
            title={question?.title || ''}
            description={question?.description || ''}
            confirmLabel={question?.confirmLabel}
            destructive={question?.destructive}
            onConfirm={() => answer(true)}
            onCancel={() => answer(false)}
        />
    )
}
