import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react"
import { cn } from "../../utils/cn"

type RenameFieldProps = {
    value: string
    onValueChange: (next: string) => void
    enabled?: boolean
    className?: string
}

export type RenameFieldHandle = {
    startEditing: () => void
    stopEditing: () => void
}

export const RenameField = forwardRef<RenameFieldHandle, RenameFieldProps>(function RenameField(
    { value, onValueChange, enabled = true, className },
    forwardedRef,
) {
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useImperativeHandle(forwardedRef, () => ({
        startEditing: () => {
            if (!enabled) return
            setDraft(value)
            setIsEditing(true)
        },
        stopEditing: () => setIsEditing(false),
    }), [enabled, value])

    useEffect(() => {
        if (!isEditing) setDraft(value)
    }, [value, isEditing])

    useEffect(() => {
        if (!isEditing) return
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.select()
    }, [isEditing])

    const commit = (): void => {
        const next = draft.trim()
        if (next && next !== value) {
            onValueChange(next)
        } else {
            setDraft(value)
        }
        setIsEditing(false)
    }

    const cancel = (): void => {
        setDraft(value)
        setIsEditing(false)
    }

    const handleClick = (event: MouseEvent<HTMLInputElement>): void => {
        // While editing, clicks belong to the input (cursor placement, selection).
        // While read-only, let the click bubble so the parent's onClick can run —
        // double-click still enters edit mode through onDoubleClick below.
        if (isEditing) event.stopPropagation()
    }

    const handleDoubleClick = (event: MouseEvent<HTMLInputElement>): void => {
        if (!enabled || isEditing) return
        event.stopPropagation()
        event.preventDefault()
        setIsEditing(true)
    }

    const handleMouseDown = (event: MouseEvent<HTMLInputElement>): void => {
        // While read-only, swallow the mousedown so the input never gains focus from a click.
        // Otherwise the caret blinks for the duration of a single-click → navigate flow,
        // which is visually distracting and was a contributor to the perceived "shift".
        if (!isEditing) event.preventDefault()
    }

    const handlePointerDown = (event: PointerEvent<HTMLInputElement>): void => {
        // The surrounding row may be a drag activator (SortableList). While
        // editing, the pointer belongs to the text field — otherwise dragging
        // across the text to select it would start a reorder. dnd-kit listens
        // on pointerdown, so the mousedown handler above does not cover this.
        if (isEditing) event.stopPropagation()
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        // Space and Enter are dnd-kit's keyboard drag activators, and they
        // reach the row by bubbling out of this input. While editing they are
        // text input (and Enter is a commit), never a lift.
        if (isEditing && (event.key === " " || event.key === "Enter")) event.stopPropagation()
        if (event.key === "Enter") {
            event.preventDefault()
            commit()
        } else if (event.key === "Escape") {
            event.preventDefault()
            cancel()
        }
    }

    return (
        <input
            ref={inputRef}
            className={cn( "m-0 w-full min-w-0 appearance-none truncate border-0 bg-transparent p-0 outline-none focus:outline-none focus:ring-0", isEditing ? "cursor-text" : "cursor-pointer", className)}
            readOnly={!isEditing || !enabled}
            tabIndex={isEditing ? 0 : -1}
            value={isEditing ? draft : value}
            onBlur={commit}
            onChange={(event) => setDraft(event.target.value)}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            onMouseDown={handleMouseDown}
            onPointerDown={handlePointerDown}
        />
    )
})

// Force every text-rendering property on the <input> to inherit from the surrounding
// typography (Label.sm, Paragraph.sm, etc.). Tailwind preflight inherits most of these
// for form controls, but inline `style` beats UA + author CSS at any specificity, so
// the input renders text with byte-identical metrics to the parent typography.
// const inheritedTextStyle = {
//     boxSizing: "border-box" as const,
//     color: "inherit",
//     font: "inherit",
//     fontFeatureSettings: "inherit",
//     fontVariationSettings: "inherit",
//     letterSpacing: "inherit",
//     lineHeight: "inherit",
//     textAlign: "left" as const,
//     textIndent: "inherit",
//     textTransform: "inherit" as const,
//     verticalAlign: "baseline",
//     whiteSpace: "inherit" as const,
// }
