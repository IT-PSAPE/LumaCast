import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@renderer/utils/cn'
import { parseLyricImportText } from '@renderer/features/deck/lyric-text-utils'
import type { Block } from './doc-editor'
import { Label } from '../display/text'

export type SortableBlockProps = {
    index: number
    block: Block
    isSelected: boolean
    contentRef: (el: HTMLTextAreaElement | null) => void
    onUpdate: (content: string) => void
    onSplit: (before: string, after: string) => void
    onDelete: () => void
    onMergeWithPrev: (text: string) => void
    onPaste: (before: string, blocks: string[], after: string) => void
    onTextareaFocus: () => void
}

function resizeTextarea(element: HTMLTextAreaElement) {
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
}

export function SortableBlock({ index, block, isSelected, contentRef, onUpdate, onSplit, onDelete, onMergeWithPrev, onPaste, onTextareaFocus }: SortableBlockProps) {
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
                const blocks = parseLyricImportText(text)
                if (blocks.length <= 1) {
                    const nextValue = `${value.slice(0, selectionStart)}${text}${value.slice(selectionEnd)}`
                    onUpdate(nextValue)
                    requestAnimationFrame(() => {
                        const textarea = textareaRef.current
                        if (!textarea) return
                        const caret = selectionStart + text.length
                        textarea.focus()
                        textarea.setSelectionRange(caret, caret)
                    })
                    return
                }

                onPaste(value.slice(0, selectionStart), blocks, value.slice(selectionEnd))
            })
            return
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            const { selectionStart, selectionEnd, value } = e.currentTarget
            onSplit(value.slice(0, selectionStart), value.slice(selectionEnd))
            return
        }

        if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
            e.preventDefault()
            if (e.currentTarget.value === '') {
                onDelete()
                return
            }

            onMergeWithPrev(e.currentTarget.value)
        }
    }
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onUpdate(e.currentTarget.value)
    }

    return (
        <div className='flex w-full items-start gap-2'>
            <span className='w-3 pt-1 text-quaternary'>
                <Label.xs className="sm">{index + 1}</Label.xs>
            </span>
            <div className={cn('flex-1 group relative flex items-start rounded-md px-1 py-0.5 pt-1.25', 'hover:bg-tertiary', isSelected && '!bg-brand_solid/10')}>
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
                    onChange={handleChange}
                    onFocus={onTextareaFocus}
                />
            </div>
        </div>
    )
}
