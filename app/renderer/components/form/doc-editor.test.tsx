import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import DocEditor, { type Block, type DocEditorHandle } from './doc-editor'

// Helpers -----------------------------------------------------------------

function setCastApi(partial: Record<string, unknown>) {
    ;(window as unknown as { castApi: Record<string, unknown> }).castApi = {
        readClipboardText: vi.fn().mockResolvedValue(''),
        writeClipboardText: vi.fn().mockResolvedValue(undefined),
        platform: 'darwin',
        ...partial,
    } as unknown as Record<string, unknown>
}

function mockRaf() {
    // Make requestAnimationFrame synchronous so focus helpers run inline.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0 as unknown as number
    })
}

function getTextareas(container: HTMLElement): HTMLTextAreaElement[] {
    return Array.from(container.querySelectorAll('textarea.doc-block')) as HTMLTextAreaElement[]
}

function getRoot(container: HTMLElement): HTMLDivElement {
    const el = container.querySelector('div[tabindex="-1"]') as HTMLDivElement | null
    if (!el) throw new Error('root not found')
    return el
}

beforeEach(() => {
    setCastApi({})
    mockRaf()
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

// -------------------------------------------------------------------------

describe('DocEditor', () => {
    it('seeds one empty block when initialBlocks is an empty array', () => {
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={[]} onChange={onChange} />)
        const areas = getTextareas(container)
        expect(areas).toHaveLength(1)
        expect(areas[0].value).toBe('')
        // onChange should have been called once with the seeded block (id stable)
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange.mock.calls[0][0]).toHaveLength(1)
        expect(onChange.mock.calls[0][0][0].content).toBe('')
    })

    it('seeds one empty block when initialBlocks is undefined', () => {
        const { container } = render(<DocEditor onChange={vi.fn()} />)
        expect(getTextareas(container)).toHaveLength(1)
    })

    it('keeps provided blocks when initialBlocks is non-empty', () => {
        const blocks: Block[] = [
            { id: 'a', content: 'first' },
            { id: 'b', content: 'second' },
        ]
        const { container } = render(<DocEditor initialBlocks={blocks} onChange={vi.fn()} />)
        const areas = getTextareas(container)
        expect(areas).toHaveLength(2)
        expect(areas[0].value).toBe('first')
        expect(areas[1].value).toBe('second')
    })

    it('keeps block ids stable across reorder and edits and keeps original id on split first half', async () => {
        // This is a contract test — verifies the public Block shape/id guarantees.
        const initial: Block[] = [{ id: 'keep', content: 'hello world' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const area = getTextareas(container)[0]
        // Edit content — id should stay the same
        await act(async () => {
            fireEvent.focus(area)
            fireEvent.change(area, { target: { value: 'hello edited' } })
        })
        const afterEdit = onChange.mock.calls.at(-1)![0] as Block[]
        expect(afterEdit[0].id).toBe('keep')
        expect(afterEdit[0].content).toBe('hello edited')

        // Split at offset 5 — first half keeps original id
        await act(async () => {
            area.focus()
            // caret at 5
            area.setSelectionRange(5, 5)
            fireEvent.keyDown(area, { key: 'Enter', shiftKey: false })
        })
        const afterSplit = onChange.mock.calls.at(-1)![0] as Block[]
        expect(afterSplit).toHaveLength(2)
        expect(afterSplit[0].id).toBe('keep')
        expect(afterSplit[0].content).toBe('hello')
        expect(afterSplit[1].content).toBe(' edited')
        expect(afterSplit[1].id).not.toBe('keep')
    })

    it('focuses the following block at start when Backspace deletes an empty first block', async () => {
        const initial: Block[] = [
            { id: 'first', content: '' },
            { id: 'second', content: 'keep' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const areas = getTextareas(container)
        const first = areas[0]

        // Focus first block and place caret at 0
        await act(async () => {
            first.focus()
            first.setSelectionRange(0, 0)
            fireEvent.keyDown(first, { key: 'Backspace' })
        })

        // After deletion, only the second block (still id 'second') should remain
        const remaining = getTextareas(container)
        expect(remaining).toHaveLength(1)
        expect(remaining[0].value).toBe('keep')
        // Focus should have moved to the following block at position 0
        expect(document.activeElement).toBe(remaining[0])
        expect(remaining[0].selectionStart).toBe(0)
        expect(remaining[0].selectionEnd).toBe(0)
    })

    it('splits multi-line paste via native paste event with clipboardData', async () => {
        const initial: Block[] = [{ id: 'a', content: 'hello' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(5, 5) // at end of "hello"

        // clipboard contains blank-line separated blocks -> parseLyricImportText splits into ["line1","line2"]
        const clipboardText = 'line1\n\nline2'
        await act(async () => {
            fireEvent.paste(area, {
                clipboardData: {
                    getData: (type: string) => (type === 'text' ? clipboardText : ''),
                },
            } as unknown as ClipboardEvent)
        })

        const last = onChange.mock.calls.at(-1)![0] as Block[]
        // pasteIntoBlock does `${before}${pastedBlocks[0]}` and `${last}${after}`
        // before = 'hello', after = '', pasted = ['line1','line2']
        expect(last).toHaveLength(2)
        expect(last[0].content).toBe('helloline1')
        expect(last[1].content).toBe('line2')
    })

    it('normalizes single-line paste with CRLF and CR to LF', async () => {
        const initial: Block[] = [{ id: 'a', content: 'hi-' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(3, 3)

        await act(async () => {
            fireEvent.paste(area, {
                clipboardData: {
                    getData: (type: string) => (type === 'text' ? 'a\r\nb\rc' : ''),
                },
            } as unknown as ClipboardEvent)
        })

        // Only a single logical line, so it is inserted in-place with \r normalized to \n
        const last = onChange.mock.calls.at(-1)![0] as Block[]
        expect(last).toHaveLength(1)
        // 'hi-' + 'a\nb\nc' (normalized) => 'hi-a\nb\nc'
        expect(last[0].content).toBe('hi-a\nb\nc')
        expect(last[0].content).not.toContain('\r')
    })

    it('never lands a raw U+2028/U+2029 separator in block content on paste', async () => {
        // A separator in the middle splits into blocks; a trailing one keeps
        // the paste on the single-insert path, which must still normalize it.
        const initial: Block[] = [{ id: 'a', content: '' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(0, 0)

        await act(async () => {
            fireEvent.paste(area, {
                clipboardData: {
                    getData: (type: string) => (type === 'text' ? 'one\u2028' : ''),
                },
            } as unknown as ClipboardEvent)
        })

        const last = onChange.mock.calls.at(-1)![0] as Block[]
        expect(last).toHaveLength(1)
        expect(last[0].content).toBe('one\n')
        expect(last[0].content).not.toContain('\u2028')
    })

    it('handles readClipboardText rejection gracefully on Cmd+V (does nothing)', async () => {
        const readClipboardText = vi.fn().mockRejectedValue(new Error('denied'))
        setCastApi({ readClipboardText })
        const initial: Block[] = [{ id: 'a', content: 'hello' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const callCountBefore = onChange.mock.calls.length
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(0, 0)

        await act(async () => {
            fireEvent.keyDown(area, { key: 'v', metaKey: true, ctrlKey: false, altKey: false })
            // allow the rejected promise to settle
            await Promise.resolve()
            await Promise.resolve()
        })

        // No extra onChange beyond the initial mount — the rejected paste is swallowed
        expect(onChange.mock.calls.length).toBe(callCountBefore)
        expect(readClipboardText).toHaveBeenCalled()
    })

    it('keeps the latest onChange in a ref — replacing onChange identity does not re-fire without block change', async () => {
        const onChangeA = vi.fn()
        const onChangeB = vi.fn()
        const initial: Block[] = [{ id: 'a', content: 'one' }]
        const { container, rerender } = render(<DocEditor initialBlocks={initial} onChange={onChangeA} />)
        expect(onChangeA).toHaveBeenCalledTimes(1)
        expect(onChangeA.mock.calls[0][0]).toHaveLength(1)

        // Rerender with a new onChange identity but same blocks — should NOT fire again
        rerender(<DocEditor initialBlocks={initial} onChange={onChangeB} />)
        expect(onChangeB).not.toHaveBeenCalled()
        expect(onChangeA).toHaveBeenCalledTimes(1)

        // Now mutate blocks — the latest onChange (B) should be called, not A
        const area = getTextareas(container)[0]
        await act(async () => {
            fireEvent.focus(area)
            fireEvent.change(area, { target: { value: 'one edited' } })
        })
        expect(onChangeB).toHaveBeenCalledTimes(1)
        expect(onChangeB.mock.calls[0][0][0].content).toBe('one edited')
        expect(onChangeA).toHaveBeenCalledTimes(1)
    })

    // --- Block selection clipboard operations ---

    function selectAllViaKeyboard(root: HTMLDivElement) {
        fireEvent.keyDown(root, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
    }

    function copyViaKeyboard(root: HTMLDivElement) {
        fireEvent.keyDown(root, { key: 'c', metaKey: true, ctrlKey: false, altKey: false })
    }

    function cutViaKeyboard(root: HTMLDivElement) {
        fireEvent.keyDown(root, { key: 'x', metaKey: true, ctrlKey: false, altKey: false })
    }

    it('selects all blocks with Cmd+A when root has focus and copies them joined by a blank line', async () => {
        const writeClipboardText = vi.fn().mockResolvedValue(undefined)
        setCastApi({ writeClipboardText })
        const initial: Block[] = [
            { id: 'a', content: 'first' },
            { id: 'b', content: 'second' },
            { id: 'c', content: 'third' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)

        // Ensure no textarea has focus so root handler runs
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        root.focus()
        expect(document.activeElement).toBe(root)

        await act(async () => {
            selectAllViaKeyboard(root)
        })

        // All three rows should be selected
        const selectedCount = container.querySelectorAll('[data-selected="true"]').length
        expect(selectedCount).toBe(3)

        await act(async () => {
            copyViaKeyboard(root)
        })

        expect(writeClipboardText).toHaveBeenCalledTimes(1)
        expect(writeClipboardText).toHaveBeenCalledWith('first\n\nsecond\n\nthird')
        // Copy must preserve document order regardless of selection order
        // (document order is already a,b,c so the join must be in that order)
    })

    it('cuts the selected blocks (copies then deletes) and keeps document order for the copied text', async () => {
        const writeClipboardText = vi.fn().mockResolvedValue(undefined)
        setCastApi({ writeClipboardText })
        const initial: Block[] = [
            { id: 'a', content: 'A' },
            { id: 'b', content: 'B' },
            { id: 'c', content: 'C' },
        ]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const root = getRoot(container)

        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        root.focus()

        await act(async () => {
            selectAllViaKeyboard(root)
        })

        // Manually narrow selection to a and c via keyboard? Instead test that cut deletes all selected.
        // For this test, we cut the full selection (a,b,c) -> leaves one empty seed block (deleteSelectedBlocks keeps one)
        await act(async () => {
            cutViaKeyboard(root)
        })

        expect(writeClipboardText).toHaveBeenCalledWith('A\n\nB\n\nC')
        const last = onChange.mock.calls.at(-1)![0] as Block[]
        // Deleting all blocks keeps one empty block
        expect(last).toHaveLength(1)
        expect(last[0].content).toBe('')
    })

    it('copy/cut/select-all do not fire when a textarea has focus', async () => {
        const writeClipboardText = vi.fn().mockResolvedValue(undefined)
        setCastApi({ writeClipboardText })
        const initial: Block[] = [
            { id: 'a', content: 'hello' },
            { id: 'b', content: 'world' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const firstArea = getTextareas(container)[0]

        // Focus textarea — root handler should bail out for clipboard ops
        firstArea.focus()
        expect(document.activeElement).toBe(firstArea)

        await act(async () => {
            // Fire on the textarea itself — the root handler must bail when
            // the event target is a textarea.
            fireEvent.keyDown(firstArea, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
        })

        // No selection should have been made (no selected rows)
        const selectedAfterA = container.querySelectorAll('[data-selected="true"]').length
        expect(selectedAfterA).toBe(0)

        // Also copy should not write
        await act(async () => {
            fireEvent.keyDown(firstArea, { key: 'c', metaKey: true, ctrlKey: false, altKey: false })
        })
        expect(writeClipboardText).not.toHaveBeenCalled()
    })

    it('splits on Enter when not composing (the IME guard must not block normal input)', async () => {
        const initial: Block[] = [{ id: 'a', content: 'test' }]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const area = getTextareas(container)[0]
        // Normal Enter (not composing) still splits
        await act(async () => {
            area.focus()
            area.setSelectionRange(2, 2)
            fireEvent.keyDown(area, { key: 'Enter', shiftKey: false })
        })
        const after = onChange.mock.calls.at(-1)![0] as Block[]
        expect(after).toHaveLength(2)
        expect(after[0].content).toBe('te')
        expect(after[1].content).toBe('st')
    })
})

// ── Phase 2: imperative handle ──────────────────────────────────────────────

describe('DocEditor imperative handle', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('getBlocks returns a copy of the current blocks', () => {
        const initial: Block[] = [{ id: 'a', content: 'one' }]
        const ref = createRef<DocEditorHandle>()
        render(<DocEditor ref={ref} initialBlocks={initial} />)
        expect(ref.current).not.toBeNull()
        const blocks = ref.current!.getBlocks()
        expect(blocks).toEqual([{ id: 'a', content: 'one' }])
        // Mutating the returned array must not affect the editor
        blocks[0].content = 'mutated'
        expect(ref.current!.getBlocks()[0].content).toBe('one')
    })

    it('setBlocks replaces content, fires onChange, and records one undo entry', () => {
        const initial: Block[] = [
            { id: 'a', content: 'first' },
            { id: 'b', content: 'second' },
        ]
        const onChange = vi.fn()
        const ref = createRef<DocEditorHandle>()
        const { container } = render(<DocEditor ref={ref} initialBlocks={initial} onChange={onChange} />)
        const callsBefore = onChange.mock.calls.length

        act(() => {
            ref.current!.setBlocks([{ id: 'x', content: 'replaced' }])
        })

        let areas = getTextareas(container)
        expect(areas).toHaveLength(1)
        expect(areas[0].value).toBe('replaced')
        expect(onChange.mock.calls.length).toBeGreaterThan(callsBefore)

        // Undo (Cmd+Z at root) restores the pre-setBlocks content in one step
        const root = getRoot(container)
        fireEvent.keyDown(root, { key: 'z', metaKey: true, ctrlKey: false, altKey: false })
        areas = getTextareas(container)
        expect(areas).toHaveLength(2)
        expect(areas[0].value).toBe('first')
        expect(areas[1].value).toBe('second')

        // Redo re-applies the setBlocks result
        fireEvent.keyDown(root, { key: 'z', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false })
        areas = getTextareas(container)
        expect(areas).toHaveLength(1)
        expect(areas[0].value).toBe('replaced')
    })

    it('setBlocks with an empty array seeds one empty block and focuses it', () => {
        const ref = createRef<DocEditorHandle>()
        const { container } = render(<DocEditor ref={ref} initialBlocks={[{ id: 'a', content: 'x' }]} />)
        act(() => {
            ref.current!.setBlocks([])
        })
        const areas = getTextareas(container)
        expect(areas).toHaveLength(1)
        expect(areas[0].value).toBe('')
        expect(document.activeElement).toBe(areas[0])
    })
})

// ── Phase 2: undo / redo ────────────────────────────────────────────────────

describe('DocEditor undo/redo', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    function pressUndo(root: HTMLDivElement, shift = false) {
        fireEvent.keyDown(root, { key: 'z', metaKey: true, shiftKey: shift, ctrlKey: false, altKey: false })
    }

    it('undo/redo covers split with focus restored to the affected block', async () => {
        const initial: Block[] = [{ id: 'a', content: 'hello world' }]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]
        await act(async () => {
            area.focus()
            area.setSelectionRange(5, 5)
            fireEvent.keyDown(area, { key: 'Enter', shiftKey: false })
        })
        expect(getTextareas(container)).toHaveLength(2)

        await act(async () => {
            pressUndo(root)
        })
        let areas = getTextareas(container)
        expect(areas).toHaveLength(1)
        expect(areas[0].value).toBe('hello world')
        // Focus restored to block 'a' at the pre-split caret
        expect(document.activeElement).toBe(areas[0])
        expect(areas[0].selectionStart).toBe(5)

        await act(async () => {
            pressUndo(root, true) // redo
        })
        areas = getTextareas(container)
        expect(areas).toHaveLength(2)
        expect(areas[0].value).toBe('hello')
        expect(areas[1].value).toBe(' world')
    })

    it('coalesces consecutive typing in the same block into one history entry', async () => {
        const initial: Block[] = [{ id: 'a', content: '' }]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]
        await act(async () => {
            area.focus()
            fireEvent.change(area, { target: { value: 'h' } })
            fireEvent.change(area, { target: { value: 'he' } })
            fireEvent.change(area, { target: { value: 'hel' } })
        })

        await act(async () => {
            pressUndo(root)
        })
        // One undo lands back at the pre-typing state, not one keystroke back
        expect(getTextareas(container)[0].value).toBe('')
    })

    it('typing in different blocks (or after blur) starts a new history entry', async () => {
        const initial: Block[] = [{ id: 'a', content: '' }]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]
        await act(async () => {
            area.focus()
            fireEvent.change(area, { target: { value: 'first' } })
            area.blur()
            fireEvent.change(area, { target: { value: 'first!' } })
        })

        await act(async () => {
            pressUndo(root)
        })
        expect(getTextareas(container)[0].value).toBe('first')
        await act(async () => {
            pressUndo(root)
        })
        expect(getTextareas(container)[0].value).toBe('')
    })

    it('a 1s pause while typing flushes the coalesced entry', async () => {
        vi.useFakeTimers()
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            cb(0)
            return 0 as unknown as number
        })
        try {
            const initial: Block[] = [{ id: 'a', content: '' }]
            const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
            const root = getRoot(container)
            const area = getTextareas(container)[0]
            await act(async () => {
                area.focus()
                fireEvent.change(area, { target: { value: 'a' } })
            })
            act(() => {
                vi.advanceTimersByTime(1000)
            })
            await act(async () => {
                fireEvent.change(area, { target: { value: 'ab' } })
            })

            await act(async () => {
                pressUndo(root)
            })
            expect(getTextareas(container)[0].value).toBe('a')
            rafSpy.mockRestore()
        } finally {
            vi.useRealTimers()
        }
    })

    it('removes window drag listeners when unmounted mid-drag', () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

        const { container, unmount } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'alpha' }]} onChange={vi.fn()} />)
        const root = getRoot(container)

        fireEvent.pointerDown(root, { button: 0, clientX: 10, clientY: 10 })

        const listenerCalls = addEventListenerSpy.mock.calls as Array<[string, EventListenerOrEventListenerObject, ...unknown[]]>
        const pointerMoveCall = listenerCalls.find(([type]) => type === 'pointermove')
        const pointerUpCall = listenerCalls.find(([type]) => type === 'pointerup')

        expect(pointerMoveCall).toBeDefined()
        expect(pointerUpCall).toBeDefined()

        unmount()

        expect(removeEventListenerSpy).toHaveBeenCalledWith('pointermove', pointerMoveCall?.[1])
        expect(removeEventListenerSpy).toHaveBeenCalledWith('pointerup', pointerUpCall?.[1])
    })

    it('undo/redo covers merge and duplicate', async () => {
        const initial: Block[] = [
            { id: 'a', content: 'alpha' },
            { id: 'b', content: 'beta' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)
        const areas = getTextareas(container)

        // Merge b into a via Backspace at caret 0
        await act(async () => {
            areas[1].focus()
            areas[1].setSelectionRange(0, 0)
            fireEvent.keyDown(areas[1], { key: 'Backspace' })
        })
        expect(getTextareas(container)).toHaveLength(1)
        expect(getTextareas(container)[0].value).toBe('alphabeta')
        await act(async () => {
            pressUndo(root)
        })
        expect(getTextareas(container)).toHaveLength(2)
        expect(getTextareas(container)[0].value).toBe('alpha')

        // Duplicate via Cmd+D with selection
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        root.focus()
        await act(async () => {
            fireEvent.keyDown(root, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
            fireEvent.keyDown(root, { key: 'd', metaKey: true, ctrlKey: false, altKey: false })
        })
        expect(getTextareas(container)).toHaveLength(4)
        await act(async () => {
            pressUndo(root)
        })
        expect(getTextareas(container)).toHaveLength(2)
    })

    it('caps history depth so the oldest entries fall off', () => {
        const initial: Block[] = [{ id: 'a', content: '' }]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]
        // 150 separate typing groups (blur between each forces a new entry)
        for (let i = 0; i < 150; i++) {
            act(() => {
                area.focus()
                fireEvent.change(area, { target: { value: `v${i}` } })
                area.blur()
            })
        }
        // Undoing more than the cap must not throw and must stop at the oldest kept state
        expect(() => {
            for (let i = 0; i < 160; i++) {
                fireEvent.keyDown(root, { key: 'z', metaKey: true, shiftKey: false, ctrlKey: false, altKey: false })
            }
        }).not.toThrow()
    })
})

// ── Phase 2: find & replace ─────────────────────────────────────────────────

describe('DocEditor find & replace', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    function openFind(root: HTMLDivElement) {
        fireEvent.keyDown(root, { key: 'f', metaKey: true, ctrlKey: false, altKey: false })
    }

    function getBar(container: HTMLElement): HTMLDivElement {
        const el = container.querySelector('[data-testid="doc-find-bar"]') as HTMLDivElement | null
        if (!el) throw new Error('find bar not found')
        return el
    }

    it('Cmd+F toggles the inline find bar and Escape closes it', () => {
        const { container } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'x' }]} />)
        const root = getRoot(container)
        expect(container.querySelector('[data-testid="doc-find-bar"]')).toBeNull()
        openFind(root)
        expect(getBar(container)).toBeTruthy()
        fireEvent.keyDown(root, { key: 'Escape' })
        expect(container.querySelector('[data-testid="doc-find-bar"]')).toBeNull()
    })

    it('next selects matches in order, focuses the containing textarea, and wraps around', () => {
        const initial: Block[] = [
            { id: 'a', content: 'hello world' },
            { id: 'b', content: 'say hello' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const root = getRoot(container)
        const areas = getTextareas(container)
        openFind(root)
        const bar = getBar(container)
        const findInput = bar.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement
        const nextBtn = bar.querySelector('[data-testid="doc-find-next"]') as HTMLButtonElement

        act(() => {
            fireEvent.change(findInput, { target: { value: 'hello' } })
        })

        act(() => { fireEvent.click(nextBtn) })
        expect(document.activeElement).toBe(areas[0])
        expect(areas[0].selectionStart).toBe(0)
        expect(areas[0].selectionEnd).toBe(5)

        act(() => { fireEvent.click(nextBtn) })
        expect(document.activeElement).toBe(areas[1])
        expect(areas[1].selectionStart).toBe(4)
        expect(areas[1].selectionEnd).toBe(9)

        // Wraps back to the first match
        act(() => { fireEvent.click(nextBtn) })
        expect(document.activeElement).toBe(areas[0])
        expect(areas[0].selectionStart).toBe(0)
    })

    it('prev navigates backwards', () => {
        const initial: Block[] = [
            { id: 'a', content: 'aa' },
            { id: 'b', content: 'aa' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const root = getRoot(container)
        const areas = getTextareas(container)
        openFind(root)
        const bar = getBar(container)
        const findInput = bar.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement
        const prevBtn = bar.querySelector('[data-testid="doc-find-prev"]') as HTMLButtonElement
        act(() => {
            fireEvent.change(findInput, { target: { value: 'aa' } })
        })
        // From "no selection yet", prev wraps to the last match
        act(() => { fireEvent.click(prevBtn) })
        expect(document.activeElement).toBe(areas[1])
        expect(areas[1].selectionStart).toBe(0)
    })

    it('match-case toggle restricts matching', () => {
        const initial: Block[] = [{ id: 'a', content: 'Hello hello' }]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const root = getRoot(container)
        openFind(root)
        const bar = getBar(container)
        const findInput = bar.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement
        const caseBtn = bar.querySelector('[data-testid="doc-find-match-case"]') as HTMLButtonElement
        const count = () => bar.querySelector('[data-testid="doc-find-count"]')?.textContent ?? ''

        act(() => {
            fireEvent.change(findInput, { target: { value: 'hello' } })
        })
        // Nothing selected yet -> index shown as 0
        expect(count()).toBe('0/2')
        act(() => { fireEvent.click(caseBtn) })
        expect(count()).toBe('0/1')
    })

    it('Replace all replaces every match and is one undo step', () => {
        const initial: Block[] = [
            { id: 'a', content: 'hello world' },
            { id: 'b', content: 'say hello' },
        ]
        const onChange = vi.fn()
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const root = getRoot(container)
        openFind(root)
        const bar = getBar(container)
        const findInput = bar.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement
        const replaceInput = bar.querySelector('[data-testid="doc-replace-input"]') as HTMLInputElement
        const replaceAllBtn = bar.querySelector('[data-testid="doc-find-replace-all"]') as HTMLButtonElement

        act(() => {
            fireEvent.change(findInput, { target: { value: 'hello' } })
            fireEvent.change(replaceInput, { target: { value: 'bye' } })
            fireEvent.click(replaceAllBtn)
        })

        const areas = getTextareas(container)
        expect(areas[0].value).toBe('bye world')
        expect(areas[1].value).toBe('say bye')

        // A single undo restores both blocks
        fireEvent.keyDown(root, { key: 'z', metaKey: true, ctrlKey: false, altKey: false })
        expect(getTextareas(container)[0].value).toBe('hello world')
        expect(getTextareas(container)[1].value).toBe('say hello')
    })

    it('Replace applies to the current match then advances', () => {
        const initial: Block[] = [{ id: 'a', content: 'cat cat' }]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]
        openFind(root)
        const bar = getBar(container)
        const findInput = bar.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement
        const replaceInput = bar.querySelector('[data-testid="doc-replace-input"]') as HTMLInputElement
        const replaceBtn = bar.querySelector('[data-testid="doc-find-replace"]') as HTMLButtonElement

        act(() => {
            fireEvent.change(findInput, { target: { value: 'cat' } })
            fireEvent.change(replaceInput, { target: { value: 'dog' } })
        })
        // Select the first match explicitly
        act(() => { fireEvent.click(bar.querySelector('[data-testid="doc-find-next"]') as HTMLButtonElement) })
        act(() => { fireEvent.click(replaceBtn) })

        expect(area.value).toBe('dog cat')
        // The replace advanced to the second match (selected in the textarea)
        expect(document.activeElement).toBe(area)
        expect(area.selectionStart).toBe(4)
        expect(area.selectionEnd).toBe(7)
    })
})

// ── Phase 2: duplicate ──────────────────────────────────────────────────────

describe('DocEditor duplicate', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('Cmd+D with a caret duplicates that block after it and focuses the duplicate', () => {
        const initial: Block[] = [
            { id: 'a', content: 'one' },
            { id: 'b', content: 'two' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const areas = getTextareas(container)
        areas[1].focus()

        fireEvent.keyDown(areas[1], { key: 'd', metaKey: true, ctrlKey: false, altKey: false })

        const after = getTextareas(container)
        expect(after).toHaveLength(3)
        expect(after[1].value).toBe('two')
        expect(after[2].value).toBe('two')
        expect(after[2].id).not.toBe('b') // fresh element for the fresh block id
        expect(document.activeElement).toBe(after[2])
    })

    it('Cmd+D with an active selection duplicates the selected blocks after the last one and selects the duplicates', () => {
        const initial: Block[] = [
            { id: 'a', content: 'A' },
            { id: 'b', content: 'B' },
            { id: 'c', content: 'C' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const root = getRoot(container)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        root.focus()

        act(() => {
            fireEvent.keyDown(root, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
        })
        act(() => {
            fireEvent.keyDown(root, { key: 'd', metaKey: true, ctrlKey: false, altKey: false })
        })

        const after = getTextareas(container)
        expect(after.map(a => a.value)).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
        // Duplicates become the new selection
        expect(container.querySelectorAll('[data-selected="true"]').length).toBeGreaterThanOrEqual(1)
        const selectedValues = Array.from(container.querySelectorAll('[data-selected="true"]'))
            .map(row => row.querySelector('textarea'))
            .filter((el): el is HTMLTextAreaElement => Boolean(el))
            .map(el => el.value)
        expect(selectedValues).toEqual(['A', 'B', 'C'])
    })
})

// ── Phase 2: cross-block caret navigation ───────────────────────────────────

describe('DocEditor cross-block caret navigation', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('ArrowUp on the first line moves to the previous block with the caret at the end', () => {
        const initial: Block[] = [
            { id: 'a', content: 'first' },
            { id: 'b', content: 'second' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const areas = getTextareas(container)
        act(() => {
            areas[1].focus()
            areas[1].setSelectionRange(0, 0)
            fireEvent.keyDown(areas[1], { key: 'ArrowUp' })
        })
        expect(document.activeElement).toBe(areas[0])
        expect(areas[0].selectionStart).toBe(5)
        expect(areas[0].selectionEnd).toBe(5)
    })

    it('ArrowDown on the last line moves to the next block with the caret at the start', () => {
        const initial: Block[] = [
            { id: 'a', content: 'first' },
            { id: 'b', content: 'second' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const areas = getTextareas(container)
        act(() => {
            areas[0].focus()
            areas[0].setSelectionRange(5, 5)
            fireEvent.keyDown(areas[0], { key: 'ArrowDown' })
        })
        expect(document.activeElement).toBe(areas[1])
        expect(areas[1].selectionStart).toBe(0)
    })

    it('ArrowUp on the first block stays put (no previous block)', () => {
        const initial: Block[] = [
            { id: 'a', content: 'only' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const area = getTextareas(container)[0]
        act(() => {
            area.focus()
            area.setSelectionRange(2, 2)
            fireEvent.keyDown(area, { key: 'ArrowUp' })
        })
        expect(document.activeElement).toBe(area)
    })

    it('Arrow movement inside a multi-line block is untouched when not on the boundary line', () => {
        const initial: Block[] = [
            { id: 'a', content: 'line1\nline2' },
            { id: 'b', content: 'next' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} />)
        const areas = getTextareas(container)
        act(() => {
            areas[0].focus()
            // Caret mid-value: there IS a newline before the caret, so ArrowUp
            // is normal in-textarea movement and must not jump blocks.
            areas[0].setSelectionRange(8, 8)
            fireEvent.keyDown(areas[0], { key: 'ArrowUp' })
        })
        expect(document.activeElement).toBe(areas[0])
    })
})

// ── Phase 2: submit shortcut ────────────────────────────────────────────────

describe('DocEditor submit shortcut', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('Cmd/Ctrl+Enter from a textarea or the root fires onSubmit', () => {
        const onSubmit = vi.fn()
        const { container } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'x' }]} onSubmit={onSubmit} />)
        const root = getRoot(container)
        const area = getTextareas(container)[0]

        fireEvent.keyDown(area, { key: 'Enter', metaKey: true, ctrlKey: false, altKey: false })
        expect(onSubmit).toHaveBeenCalledTimes(1)

        fireEvent.keyDown(root, { key: 'Enter', ctrlKey: true, metaKey: false, altKey: false })
        expect(onSubmit).toHaveBeenCalledTimes(2)
    })

    it('plain Enter does not fire onSubmit', () => {
        const onSubmit = vi.fn()
        const { container } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'xy' }]} onSubmit={onSubmit} />)
        const area = getTextareas(container)[0]
        fireEvent.keyDown(area, { key: 'Enter', metaKey: false, ctrlKey: false })
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('onSubmit is optional — Cmd+Enter without the prop is a no-op', () => {
        const { container } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'x' }]} />)
        const area = getTextarea(container)
        expect(() => fireEvent.keyDown(area, { key: 'Enter', metaKey: true })).not.toThrow()
    })

    function getTextarea(container: HTMLElement): HTMLTextAreaElement {
        return getTextareas(container)[0]
    }
})

// ── Phase 2: row accessory ──────────────────────────────────────────────────

describe('DocEditor row accessory', () => {
    beforeEach(() => {
        setCastApi({})
        mockRaf()
    })

    afterEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('renders the accessory per row and passes block and index', () => {
        const initial: Block[] = [
            { id: 'a', content: 'one' },
            { id: 'b', content: 'two' },
        ]
        const accessory = vi.fn((block: Block, index: number) => (
            <span data-testid={`acc-${block.id}`}>{index}</span>
        ))
        const { container } = render(<DocEditor initialBlocks={initial} renderBlockAccessory={accessory} />)

        expect(accessory).toHaveBeenCalledTimes(2)
        expect(accessory).toHaveBeenCalledWith(initial[0], 0)
        expect(accessory).toHaveBeenCalledWith(initial[1], 1)
        expect(container.querySelector('[data-testid="acc-a"]')).toBeTruthy()
        expect(container.querySelector('[data-testid="acc-b"]')).toBeTruthy()
    })

    it('renders no accessory slot content when the prop is omitted', () => {
        const { container } = render(<DocEditor initialBlocks={[{ id: 'a', content: 'one' }]} />)
        expect(container.querySelectorAll('[data-testid^="acc-"]').length).toBe(0)
    })

    // --- Progressive select-all ---

    it('Cmd+A with a partial text selection keeps native behavior and selects no blocks', async () => {
        const initial: Block[] = [
            { id: 'a', content: 'hello' },
            { id: 'b', content: 'world' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(1, 3)

        await act(async () => {
            fireEvent.keyDown(area, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
        })

        expect(container.querySelectorAll('[data-selected="true"]').length).toBe(0)
        expect(document.activeElement).toBe(area)
    })

    it('Cmd+A escalates to selecting all blocks when the block text is already fully selected', async () => {
        const initial: Block[] = [
            { id: 'a', content: 'hello' },
            { id: 'b', content: 'world' },
            { id: 'c', content: 'again' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(0, area.value.length)

        await act(async () => {
            fireEvent.keyDown(area, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
        })

        expect(container.querySelectorAll('[data-selected="true"]').length).toBe(3)
        // The textarea must give up focus so block-level shortcuts take over
        expect(document.activeElement).not.toBe(area)
    })

    it('Cmd+A in an empty block escalates immediately', async () => {
        const initial: Block[] = [
            { id: 'a', content: '' },
            { id: 'b', content: 'world' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={vi.fn()} />)
        const area = getTextareas(container)[0]
        area.focus()
        area.setSelectionRange(0, 0)

        await act(async () => {
            fireEvent.keyDown(area, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
        })

        expect(container.querySelectorAll('[data-selected="true"]').length).toBe(2)
    })

    it('block operations do not fire from the find-bar inputs while a selection is active', async () => {
        const onChange = vi.fn()
        const initial: Block[] = [
            { id: 'a', content: 'one' },
            { id: 'b', content: 'two' },
        ]
        const { container } = render(<DocEditor initialBlocks={initial} onChange={onChange} />)
        const root = getRoot(container)

        // Select all blocks, then open find — typing Backspace in the find
        // field must edit the field, not delete the selected blocks.
        root.focus()
        await act(async () => {
            fireEvent.keyDown(root, { key: 'a', metaKey: true, ctrlKey: false, altKey: false })
            fireEvent.keyDown(root, { key: 'f', metaKey: true, ctrlKey: false, altKey: false })
        })
        const findInput = container.querySelector('[data-testid="doc-find-input"]') as HTMLInputElement | null
            ?? container.querySelector('input') as HTMLInputElement
        expect(findInput).toBeTruthy()

        await act(async () => {
            fireEvent.keyDown(findInput, { key: 'Backspace' })
        })

        const last = onChange.mock.calls.at(-1)?.[0] as Block[] | undefined
        expect(getTextareas(container)).toHaveLength(2)
        if (last) expect(last).toHaveLength(2)
    })
})
