import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/utils/cn'
import { parseLyricImportText } from '@renderer/features/items/lyric-text-utils'
import type { Block } from './doc-editor'
import { Label } from '../display/text'

export type SortableBlockProps = {
    index: number
    block: Block
    isSelected: boolean
    rowRef: (el: HTMLDivElement | null) => void
    contentRef: (el: HTMLTextAreaElement | null) => void
    accessory?: ReactNode
    onUpdate: (content: string, source?: 'type' | 'paste') => void
    onSplit: (before: string, after: string) => void
    onDelete: () => void
    onMergeWithPrev: (text: string) => void
    onPaste: (before: string, blocks: string[], after: string) => void
    /** Called when the caret would leave the block via ArrowUp/ArrowDown.
     *  Return true if the exit was handled (caller preventDefaults). */
    onCaretExit?: (direction: 'up' | 'down') => boolean
    /** Called when Cmd/Ctrl+A escalates from the block's own (already full)
     *  text selection to selecting every block. */
    onSelectAllBlocks?: () => void
    onTextareaFocus: () => void
    onTextareaBlur?: () => void
}

function resizeTextarea(element: HTMLTextAreaElement) {
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
}

// Must match parseLyricImportText's normalization — a single-block insert
// lands the normalized text directly in the textarea, so it has to cover
// the same separators (CRLF/CR and U+2028/U+2029) the block splitter does.
function normalizePastedNewlines(text: string) {
    return text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n')
}

export function SortableBlock({ index, block, isSelected, rowRef, contentRef, accessory, onUpdate, onSplit, onDelete, onMergeWithPrev, onPaste, onCaretExit, onSelectAllBlocks, onTextareaFocus, onTextareaBlur }: SortableBlockProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const setContentRef = useCallback(
        (el: HTMLTextAreaElement | null) => {
            textareaRef.current = el
            contentRef(el)
        },
        [contentRef],
    )

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        resizeTextarea(textarea)
    }, [block.content])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v') {
            e.preventDefault()
            e.stopPropagation()
            const { selectionStart, selectionEnd, value } = e.currentTarget
            void window.castApi.readClipboardText().then((text) => {
                const normalized = normalizePastedNewlines(text)
                const blocks = parseLyricImportText(normalized)
                if (blocks.length <= 1) {
                    const nextValue = `${value.slice(0, selectionStart)}${normalized}${value.slice(selectionEnd)}`
                    onUpdate(nextValue, 'paste')
                    requestAnimationFrame(() => {
                        const textarea = textareaRef.current
                        if (!textarea) return
                        const caret = selectionStart + normalized.length
                        textarea.focus()
                        textarea.setSelectionRange(caret, caret)
                    })
                    return
                }

                onPaste(value.slice(0, selectionStart), blocks, value.slice(selectionEnd))
            }).catch(() => {})
            return
        }

        // Progressive select-all: the first Cmd/Ctrl+A keeps native behavior
        // (select this block's text); once the block is already fully
        // selected — or has nothing to select — the same press escalates to
        // selecting every block, handing control to the root-level block
        // operations.
        if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'a') {
            const { selectionStart, selectionEnd, value } = e.currentTarget
            const fullySelected = value.length === 0 || (selectionStart === 0 && selectionEnd === value.length)
            if (fullySelected && onSelectAllBlocks) {
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.blur()
                onSelectAllBlocks()
            }
            return
        }

        // Cross-block caret navigation: only when the caret is already on the
        // boundary line (no newline between the caret and the relevant end of
        // the value). Normal in-textarea line movement is untouched.
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (!(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing && onCaretExit) {
                const { selectionStart, selectionEnd, value } = e.currentTarget
                if (e.key === 'ArrowUp' && !value.slice(0, selectionStart).includes('\n')) {
                    if (onCaretExit('up')) e.preventDefault()
                    return
                }
                if (e.key === 'ArrowDown' && !value.slice(selectionEnd).includes('\n')) {
                    if (onCaretExit('down')) e.preventDefault()
                    return
                }
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return
            e.preventDefault()
            const { selectionStart, selectionEnd, value } = e.currentTarget
            onSplit(value.slice(0, selectionStart), value.slice(selectionEnd))
            return
        }

        if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
            if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return
            e.preventDefault()
            if (e.currentTarget.value === '') {
                onDelete()
                return
            }

            onMergeWithPrev(e.currentTarget.value)
        }
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const raw = e.clipboardData.getData('text')
        if (!raw) return
        const normalized = normalizePastedNewlines(raw)
        const blocks = parseLyricImportText(normalized)
        // Prevent native insert — drive split-or-insert so multi-line text is
        // split into blocks. The keydown Cmd/Ctrl+V path's preventDefault
        // guarantees the two never both fire for one keyboard paste.
        e.preventDefault()
        const { selectionStart, selectionEnd, value } = e.currentTarget
        if (blocks.length <= 1) {
            const nextValue = `${value.slice(0, selectionStart)}${normalized}${value.slice(selectionEnd)}`
            onUpdate(nextValue, 'paste')
            requestAnimationFrame(() => {
                const textarea = textareaRef.current
                if (!textarea) return
                const caret = selectionStart + normalized.length
                textarea.focus()
                textarea.setSelectionRange(caret, caret)
            })
            return
        }
        onPaste(value.slice(0, selectionStart), blocks, value.slice(selectionEnd))
    }
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onUpdate(e.currentTarget.value, 'type')
    }

    return (
        <div
            ref={rowRef}
            data-selected={isSelected ? 'true' : undefined}
            className={cn(
                'flex w-full items-start gap-2 rounded-md px-1 transition-colors',
                isSelected && 'bg-brand_solid/15',
            )}
        >
            <span className='w-3 pt-1 text-quaternary'>
                <Label.xs className="sm">{index + 1}</Label.xs>
            </span>
            <div className={cn('flex-1 group relative flex items-start rounded-md px-1 py-0.5 pt-1.25', !isSelected && 'hover:bg-tertiary')}>
                <textarea
                    ref={setContentRef}
                    value={block.content}
                    rows={1}
                    spellCheck={false}
                    className="doc-block flex-1 resize-none overflow-hidden whitespace-pre-wrap bg-transparent px-0.5 py-px text-paragraph-sm text-primary outline-none placeholder:text-tertiary"
                    placeholder="Type something..."
                    // Pasted newline-separated text must be split into separate
                    // blocks here. The global editable shortcut fallback bypasses
                    // native paste, so this editor owns Cmd/Ctrl+V explicitly.
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onChange={handleChange}
                    onFocus={onTextareaFocus}
                    onBlur={onTextareaBlur}
                />
            </div>
            <div className="flex w-5 shrink-0 items-start justify-end pt-1">
                {accessory ?? null}
            </div>
        </div>
    )
}
