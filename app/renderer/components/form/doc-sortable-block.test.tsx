import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, createEvent, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SortableBlock } from './doc-sortable-block'
import type { Block } from './doc-editor'

function fireComposingKeyDown(target: HTMLElement, key: string, extra: Record<string, unknown> = {}) {
    const event = createEvent.keyDown(target, { key, bubbles: true, cancelable: true, ...extra })
    // jsdom's KeyboardEvent may ignore isComposing in init, so force-define it.
    Object.defineProperty(event, 'isComposing', { value: true, configurable: true })
    // React exposes the DOM event as e.nativeEvent, so the same flag must be visible there.
    // In createEvent's DOM event, nativeEvent is the event itself once fired — defining
    // isComposing on the DOM event suffices, but we also define on any nativeEvent wrapper
    // for robustness.
    Object.defineProperty(event, 'nativeEvent', {
        value: event,
        configurable: true,
    })
    fireEvent(target, event)
}

function setCastApi(partial: Record<string, unknown>) {
    ;(window as unknown as { castApi: Record<string, unknown> }).castApi = {
        readClipboardText: vi.fn().mockResolvedValue(''),
        writeClipboardText: vi.fn().mockResolvedValue(undefined),
        ...partial,
    } as unknown as Record<string, unknown>
}

function mockRaf() {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0 as unknown as number
    })
}

beforeEach(() => {
    setCastApi({})
    mockRaf()
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

function renderBlock(overrides: Partial<{
    block: Block
    accessory: ReactNode
    onUpdate: unknown
    onSplit: unknown
    onDelete: unknown
    onMergeWithPrev: unknown
    onPaste: unknown
    onCaretExit: unknown
    onTextareaFocus: unknown
    onTextareaBlur: unknown
}> = {}) {
    const block: Block = overrides.block ?? { id: 'b1', content: 'hello world' }
    const onUpdateMock = (overrides.onUpdate ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onSplitMock = (overrides.onSplit ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onDeleteMock = (overrides.onDelete ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onMergeWithPrevMock = (overrides.onMergeWithPrev ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onPasteMock = (overrides.onPaste ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onCaretExitMock = (overrides.onCaretExit ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onTextareaFocusMock = (overrides.onTextareaFocus ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>
    const onTextareaBlurMock = (overrides.onTextareaBlur ?? vi.fn()) as unknown as ReturnType<typeof vi.fn>

    const utils = render(
        <SortableBlock
            index={0}
            block={block}
            isSelected={false}
            rowRef={vi.fn()}
            contentRef={vi.fn()}
            accessory={overrides.accessory}
            onUpdate={onUpdateMock as unknown as (content: string, source?: 'type' | 'paste') => void}
            onSplit={onSplitMock as unknown as (before: string, after: string) => void}
            onDelete={onDeleteMock as unknown as () => void}
            onMergeWithPrev={onMergeWithPrevMock as unknown as (text: string) => void}
            onPaste={onPasteMock as unknown as (before: string, blocks: string[], after: string) => void}
            onCaretExit={onCaretExitMock as unknown as (direction: 'up' | 'down') => boolean}
            onTextareaFocus={onTextareaFocusMock as unknown as () => void}
            onTextareaBlur={onTextareaBlurMock as unknown as () => void}
        />,
    )
    const textarea = utils.container.querySelector('textarea.doc-block') as HTMLTextAreaElement
    if (!textarea) throw new Error('textarea not found')
    return { ...utils, textarea, onUpdate: onUpdateMock, onSplit: onSplitMock, onDelete: onDeleteMock, onMergeWithPrev: onMergeWithPrevMock, onPaste: onPasteMock, onCaretExit: onCaretExitMock, onTextareaBlur: onTextareaBlurMock }
}

describe('SortableBlock', () => {
    it('bails out of Enter split while IME is composing (isComposing)', async () => {
        const onSplit = vi.fn()
        const { textarea } = renderBlock({ onSplit, block: { id: 'b1', content: 'abc' } })
        textarea.focus()
        textarea.setSelectionRange(1, 1)

        await act(async () => {
            fireComposingKeyDown(textarea, 'Enter', { shiftKey: false })
        })
        expect(onSplit).not.toHaveBeenCalled()
    })

    it('bails out of Backspace merge/delete while composing', async () => {
        const onDelete = vi.fn()
        const onMergeWithPrev = vi.fn()
        const { textarea } = renderBlock({
            block: { id: 'b1', content: '' },
            onDelete,
            onMergeWithPrev,
        })
        textarea.focus()
        textarea.setSelectionRange(0, 0)

        await act(async () => {
            fireComposingKeyDown(textarea, 'Backspace')
        })

        expect(onDelete).not.toHaveBeenCalled()
        expect(onMergeWithPrev).not.toHaveBeenCalled()

        // Non-empty case for merge
        const { textarea: ta2, onMergeWithPrev: merge2 } = renderBlock({
            block: { id: 'b2', content: 'keep' },
            onMergeWithPrev: vi.fn(),
        })
        ta2.focus()
        ta2.setSelectionRange(0, 0)
        await act(async () => {
            fireComposingKeyDown(ta2, 'Backspace')
        })
        expect(merge2).not.toHaveBeenCalled()
    })

    it('splits multi-line paste via native onPaste using clipboardData', async () => {
        const onPaste = vi.fn()
        const onUpdate = vi.fn()
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'before-after' }, onPaste, onUpdate })
        textarea.focus()
        // caret after "before"
        textarea.setSelectionRange(6, 6)

        const clipboardText = 'line1\n\nline2'
        await act(async () => {
            fireEvent.paste(textarea, {
                clipboardData: {
                    getData: (type: string) => (type === 'text' ? clipboardText : ''),
                },
            } as unknown as ClipboardEvent)
        })

        // Multi-line should trigger onPaste (split), not onUpdate
        expect(onPaste).toHaveBeenCalledTimes(1)
        expect(onPaste).toHaveBeenCalledWith('before', ['line1', 'line2'], '-after')
        expect(onUpdate).not.toHaveBeenCalled()
    })

    it('inserts single-line paste with CRLF/CR normalization via onPaste', async () => {
        const onUpdate = vi.fn()
        const onPaste = vi.fn()
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hi-' }, onUpdate, onPaste })
        textarea.focus()
        textarea.setSelectionRange(3, 3)

        await act(async () => {
            fireEvent.paste(textarea, {
                clipboardData: {
                    getData: (type: string) => (type === 'text' ? 'a\r\nb\rc' : ''),
                },
            } as unknown as ClipboardEvent)
        })

        expect(onPaste).not.toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalledTimes(1)
        // Normalized \r\n and \r to \n
        expect(onUpdate).toHaveBeenCalledWith('hi-a\nb\nc', 'paste')
        expect(onUpdate.mock.calls[0][0]).not.toContain('\r')
    })

    it('normalizes single-line Cmd+V insert via readClipboardText (handles \\r\\n)', async () => {
        const onUpdate = vi.fn()
        const readClipboardText = vi.fn().mockResolvedValue('x\r\ny\r')
        setCastApi({ readClipboardText })
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'pre' }, onUpdate })
        textarea.focus()
        textarea.setSelectionRange(3, 3)

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'v', metaKey: true, ctrlKey: false, altKey: false })
            // flush microtasks for readClipboardText
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(readClipboardText).toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalledTimes(1)
        expect(onUpdate).toHaveBeenCalledWith('prex\ny\n', 'paste')
        expect(onUpdate.mock.calls[0][0]).not.toContain('\r')
    })

    it('handles readClipboardText rejection gracefully (does nothing)', async () => {
        const onUpdate = vi.fn()
        const onPaste = vi.fn()
        const readClipboardText = vi.fn().mockRejectedValue(new Error('fail'))
        setCastApi({ readClipboardText })
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hello' }, onUpdate, onPaste })
        textarea.focus()
        textarea.setSelectionRange(0, 0)

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'v', metaKey: true, ctrlKey: false, altKey: false })
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(onUpdate).not.toHaveBeenCalled()
        expect(onPaste).not.toHaveBeenCalled()
    })

    it('Cmd+V multi-line via readClipboardText splits into blocks', async () => {
        const onPaste = vi.fn()
        const readClipboardText = vi.fn().mockResolvedValue('a\n\nb')
        setCastApi({ readClipboardText })
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'X-Y' }, onPaste, onUpdate: vi.fn() })
        textarea.focus()
        textarea.setSelectionRange(1, 1) // after X

        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'v', metaKey: true, ctrlKey: false, altKey: false })
            await Promise.resolve()
            await Promise.resolve()
        })

        expect(onPaste).toHaveBeenCalledWith('X', ['a', 'b'], '-Y')
    })

    it('Enter without isComposing still splits normally', async () => {
        const onSplit = vi.fn()
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'ab|cd' }, onSplit })
        textarea.focus()
        textarea.setSelectionRange(2, 2)
        // set value to known string so split slices are predictable
        // block content is 'ab|cd', caret 2 -> before 'ab', after '|cd'
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
        })
        expect(onSplit).toHaveBeenCalledTimes(1)
        expect(onSplit).toHaveBeenCalledWith('ab', '|cd')
    })

    it('Backspace at start on empty text still deletes, and on non-empty still merges', async () => {
        const onDelete = vi.fn()
        const onMerge = vi.fn()
        const { textarea } = renderBlock({ block: { id: 'b1', content: '' }, onDelete, onMergeWithPrev: onMerge })
        textarea.focus()
        textarea.setSelectionRange(0, 0)
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Backspace' })
        })
        expect(onDelete).toHaveBeenCalledTimes(1)
        expect(onMerge).not.toHaveBeenCalled()

        const merge2 = vi.fn()
        const { textarea: ta2 } = renderBlock({ block: { id: 'b2', content: 'keep' }, onMergeWithPrev: merge2, onDelete: vi.fn() })
        ta2.focus()
        ta2.setSelectionRange(0, 0)
        await act(async () => {
            fireEvent.keyDown(ta2, { key: 'Backspace' })
        })
        expect(merge2).toHaveBeenCalledWith('keep')
    })
})

// ── Phase 2 ─────────────────────────────────────────────────────────────────

describe('SortableBlock Phase 2', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    function fireKeyDown(target: HTMLElement, init: Record<string, unknown>) {
        const event = createEvent.keyDown(target, { key: 'ArrowUp', bubbles: true, cancelable: true, ...init })
        fireEvent(target, event)
        return event
    }

    it('ArrowUp on the first line calls onCaretExit("up") and preventDefaults when handled', () => {
        const onCaretExit = vi.fn(() => true)
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hello' }, onCaretExit })
        textarea.focus()
        textarea.setSelectionRange(2, 2)
        const event = fireKeyDown(textarea, { key: 'ArrowUp' })
        expect(onCaretExit).toHaveBeenCalledWith('up')
        expect(event.defaultPrevented).toBe(true)
    })

    it('ArrowDown on the last line calls onCaretExit("down") and preventDefaults when handled', () => {
        const onCaretExit = vi.fn(() => true)
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hello' }, onCaretExit })
        textarea.focus()
        textarea.setSelectionRange(5, 5)
        const event = fireKeyDown(textarea, { key: 'ArrowDown' })
        expect(onCaretExit).toHaveBeenCalledWith('down')
        expect(event.defaultPrevented).toBe(true)
    })

    it('does not preventDefault when onCaretExit reports it could not handle (no neighbour)', () => {
        const onCaretExit = vi.fn(() => false)
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hello' }, onCaretExit })
        textarea.focus()
        textarea.setSelectionRange(0, 0)
        const event = fireKeyDown(textarea, { key: 'ArrowUp' })
        expect(onCaretExit).toHaveBeenCalledWith('up')
        expect(event.defaultPrevented).toBe(false)
    })

    it('does not call onCaretExit when the caret is not on the boundary line', () => {
        const onCaretExit = vi.fn(() => true)
        // Newline before the caret → ArrowUp is normal in-textarea movement.
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'line1\nline2' }, onCaretExit })
        textarea.focus()
        textarea.setSelectionRange(8, 8)
        fireKeyDown(textarea, { key: 'ArrowUp' })
        expect(onCaretExit).not.toHaveBeenCalled()

        // Newline after the caret → ArrowDown is normal in-textarea movement.
        textarea.setSelectionRange(3, 3)
        fireKeyDown(textarea, { key: 'ArrowDown' })
        expect(onCaretExit).not.toHaveBeenCalled()
    })

    it('skips caret-exit handling while IME is composing', () => {
        const onCaretExit = vi.fn(() => true)
        const { textarea } = renderBlock({ block: { id: 'b1', content: 'hello' }, onCaretExit })
        textarea.focus()
        textarea.setSelectionRange(0, 0)
        fireComposingKeyDown(textarea, 'ArrowUp')
        expect(onCaretExit).not.toHaveBeenCalled()
    })

    it('reports the update source: "type" for changes and "paste" for pasted inserts', async () => {
        const onUpdate = vi.fn()
        const { textarea } = renderBlock({ block: { id: 'b1', content: '' }, onUpdate })
        textarea.focus()
        await act(async () => {
            fireEvent.change(textarea, { target: { value: 'typed' } })
        })
        expect(onUpdate).toHaveBeenLastCalledWith('typed', 'type')

        await act(async () => {
            fireEvent.paste(textarea, {
                clipboardData: { getData: (type: string) => (type === 'text' ? 'pasted' : '') },
            } as unknown as ClipboardEvent)
        })
        expect(onUpdate).toHaveBeenLastCalledWith('pasted', 'paste')
    })

    it('fires onTextareaBlur when the textarea blurs (typing history flush hook)', () => {
        const onTextareaBlur = vi.fn()
        const { textarea } = renderBlock({ onTextareaBlur })
        textarea.focus()
        expect(onTextareaBlur).not.toHaveBeenCalled()
        fireEvent.blur(textarea)
        expect(onTextareaBlur).toHaveBeenCalledTimes(1)
    })

    it('renders the accessory in a fixed-width end-of-row slot', () => {
        const { container } = renderBlock({
            block: { id: 'b1', content: 'x' },
            accessory: <span data-testid="acc">!</span>,
        })
        const slot = container.querySelector('.w-5.shrink-0') as HTMLElement | null
        expect(slot).toBeTruthy()
        expect(slot?.querySelector('[data-testid="acc"]')).toBeTruthy()
    })

    it('renders an empty accessory slot when no accessory is given', () => {
        const { container } = renderBlock({ block: { id: 'b1', content: 'x' } })
        const slot = container.querySelector('.w-5.shrink-0') as HTMLElement | null
        expect(slot).toBeTruthy()
        expect(slot?.childElementCount).toBe(0)
    })
})
