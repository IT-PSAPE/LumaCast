import { forwardRef, useImperativeHandle, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/utils/cn'
import { SortableBlock } from './doc-sortable-block'

const uid = () => Math.random().toString(36).slice(2, 9)

const MAX_HISTORY_DEPTH = 100

export type Block = { id: string; content: string }

export type DocEditorHandle = {
    getBlocks: () => Block[]
    /** Replaces all content and records a history entry so callers participate in undo. */
    setBlocks: (next: Block[]) => void
}

type DocEditorProps = {
    initialBlocks?: Block[]
    onChange?: (blocks: Block[]) => void
    // Lets the caller size the editor's drag canvas (height/padding). The
    // editor always fills its width so the marquee can be triggered from the
    // empty margins, Notion-style; this only tunes the outer surface.
    className?: string
    /** Fired on Cmd/Ctrl+Enter from anywhere inside the editor. */
    onSubmit?: () => void
    /** Rendered in a fixed-width slot at the end of each row. */
    renderBlockAccessory?: (block: Block, index: number) => ReactNode
}

type FocusSnapshot = { id: string; start: number; end: number }

type HistoryEntry = { blocks: Block[]; focus: FocusSnapshot | null }

type FindMatch = { blockId: string; start: number; end: number }

function matchesOf(blocks: Block[], needle: string, matchCase: boolean): FindMatch[] {
    if (!needle) return []
    const hayOf = (text: string) => (matchCase ? text : text.toLowerCase())
    const target = hayOf(needle)
    const out: FindMatch[] = []
    for (const block of blocks) {
        const hay = hayOf(block.content)
        let i = 0
        while ((i = hay.indexOf(target, i)) !== -1) {
            out.push({ blockId: block.id, start: i, end: i + target.length })
            i += target.length
        }
    }
    return out
}

const DocEditor = forwardRef<DocEditorHandle, DocEditorProps>(function DocEditor(
    { initialBlocks, onChange, className, onSubmit, renderBlockAccessory },
    ref,
) {
    const [blocks, setBlocksState] = useState<Block[]>(
        () => (initialBlocks?.length ? initialBlocks : [{ id: uid(), content: '' }]),
    )
    const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(() => new Set())

    const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

    // ── Find & replace ──────────────────────────────────────────────
    const [findOpen, setFindOpen] = useState(false)
    const [findText, setFindText] = useState('')
    const [replaceText, setReplaceText] = useState('')
    const [matchCase, setMatchCase] = useState(false)
    // -1 means no match selected yet; the first "next" selects match 0.
    const [activeMatchIdx, setActiveMatchIdx] = useState(-1)

    const contentRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
    const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const blocksRef = useRef(blocks)
    const selectedRef = useRef(selectedBlockIds)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const dragRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null)
    const onChangeRef = useRef(onChange)
    const onSubmitRef = useRef(onSubmit)
    const findOpenRef = useRef(findOpen)
    const findTextRef = useRef(findText)
    const replaceTextRef = useRef(replaceText)
    const matchCaseRef = useRef(matchCase)
    const activeMatchIdxRef = useRef(activeMatchIdx)
    const undoStackRef = useRef<HistoryEntry[]>([])
    const redoStackRef = useRef<HistoryEntry[]>([])
    const typingRef = useRef<{ blockId: string; timer: ReturnType<typeof setTimeout> } | null>(null)
    const findInputRef = useRef<HTMLInputElement | null>(null)
    const dragCleanupRef = useRef<(() => void) | null>(null)

    useEffect(() => { blocksRef.current = blocks }, [blocks])
    useEffect(() => { selectedRef.current = selectedBlockIds }, [selectedBlockIds])
    useEffect(() => { onChangeRef.current = onChange }, [onChange])
    useEffect(() => { onSubmitRef.current = onSubmit }, [onSubmit])
    useEffect(() => { findOpenRef.current = findOpen }, [findOpen])
    useEffect(() => { findTextRef.current = findText }, [findText])
    useEffect(() => { replaceTextRef.current = replaceText }, [replaceText])
    useEffect(() => { matchCaseRef.current = matchCase }, [matchCase])
    useEffect(() => { activeMatchIdxRef.current = activeMatchIdx }, [activeMatchIdx])

    useEffect(() => {
        onChangeRef.current?.(blocks)
    }, [blocks])

    // Autofocus the find field when the bar opens so typing starts immediately.
    useEffect(() => {
        if (!findOpen) return
        requestAnimationFrame(() => { findInputRef.current?.focus() })
    }, [findOpen])

    // ── Selection ───────────────────────────────────────────────────

    const clearSelection = useCallback(() => {
        selectedRef.current = new Set()
        setSelectedBlockIds(prev => (prev.size === 0 ? prev : new Set()))
    }, [])

    const selectAllBlocks = useCallback(() => {
        const nextSelection = new Set(blocksRef.current.map(b => b.id))
        selectedRef.current = nextSelection
        setSelectedBlockIds(nextSelection)
    }, [])

    // ── History ─────────────────────────────────────────────────────

    const captureFocus = useCallback((): FocusSnapshot | null => {
        const el = document.activeElement
        if (!(el instanceof HTMLTextAreaElement)) return null
        const id = Object.keys(contentRefs.current).find(key => contentRefs.current[key] === el)
        if (!id) return null
        return { id, start: el.selectionStart, end: el.selectionEnd }
    }, [])

    const flushTyping = useCallback(() => {
        const typing = typingRef.current
        if (!typing) return
        clearTimeout(typing.timer)
        typingRef.current = null
    }, [])

    const pushCommit = useCallback(() => {
        flushTyping()
        const stack = undoStackRef.current
        stack.push({ blocks: blocksRef.current.map(b => ({ ...b })), focus: captureFocus() })
        if (stack.length > MAX_HISTORY_DEPTH) stack.shift()
        redoStackRef.current = []
    }, [captureFocus, flushTyping])

    // Focus/selection that must land AFTER the next commit (undo/redo, the
    // imperative handle, duplicate, find navigation). Applied in an effect so
    // it never races the DOM update — unlike rAF-deferred focus, this is
    // deterministic for elements that don't exist yet.
    const [pendingFocus, setPendingFocus] = useState<FocusSnapshot | null>(null)
    useEffect(() => {
        if (!pendingFocus) return
        const el = contentRefs.current[pendingFocus.id]
        if (el) {
            el.focus()
            const len = el.value.length
            el.setSelectionRange(Math.min(pendingFocus.start, len), Math.min(pendingFocus.end, len))
        }
        setPendingFocus(null)
    }, [pendingFocus])

    const applySnapshot = useCallback((entry: HistoryEntry) => {
        setBlocksState(entry.blocks)
        // Decide the focus target synchronously from the snapshot itself:
        // keep the recorded focus when its block survives, else first block.
        const focus = entry.focus
        if (focus && entry.blocks.some(b => b.id === focus.id)) {
            const block = entry.blocks.find(b => b.id === focus.id)!
            setPendingFocus({ id: focus.id, start: Math.min(focus.start, block.content.length), end: Math.min(focus.end, block.content.length) })
            return
        }
        const first = entry.blocks[0]
        if (first) setPendingFocus({ id: first.id, start: first.content.length, end: first.content.length })
    }, [])

    const undo = useCallback(() => {
        flushTyping()
        const entry = undoStackRef.current.pop()
        if (!entry) return
        redoStackRef.current.push({ blocks: blocksRef.current.map(b => ({ ...b })), focus: captureFocus() })
        clearSelection()
        applySnapshot(entry)
    }, [applySnapshot, captureFocus, clearSelection, flushTyping])

    const redo = useCallback(() => {
        flushTyping()
        const entry = redoStackRef.current.pop()
        if (!entry) return
        undoStackRef.current.push({ blocks: blocksRef.current.map(b => ({ ...b })), focus: captureFocus() })
        clearSelection()
        applySnapshot(entry)
    }, [applySnapshot, captureFocus, clearSelection, flushTyping])

    // ── Focus helpers ───────────────────────────────────────────────

    const focusEnd = useCallback((id: string) => {
        requestAnimationFrame(() => {
            const el = contentRefs.current[id]
            if (!el) return
            el.focus()
            const end = el.value.length
            el.setSelectionRange(end, end)
        })
    }, [])

    const getFocusedBlockId = useCallback(() => {
        const el = document.activeElement
        if (!(el instanceof HTMLTextAreaElement)) return null
        return Object.keys(contentRefs.current).find(key => contentRefs.current[key] === el) ?? null
    }, [])

    // ── Block operations ────────────────────────────────────────────

    const deleteBlock = useCallback((id: string) => {
        const curr = blocksRef.current
        if (curr.length <= 1) return
        const idx = curr.findIndex(b => b.id === id)
        const prevBlock = curr[idx - 1]
        const nextBlock = curr[idx + 1]
        pushCommit()
        setBlocksState(prev => prev.filter(b => b.id !== id))
        if (prevBlock) focusEnd(prevBlock.id)
        else if (nextBlock) {
            requestAnimationFrame(() => {
                const el = contentRefs.current[nextBlock.id]
                if (!el) return
                el.focus()
                el.setSelectionRange(0, 0)
            })
        }
    }, [focusEnd, pushCommit])

    const updateBlockRaw = useCallback((id: string, content: string) => {
        setBlocksState(prev => prev.map(b => b.id === id ? { ...b, content } : b))
    }, [])

    const updateBlock = useCallback((id: string, content: string, source: 'type' | 'paste') => {
        if (source === 'paste') {
            pushCommit()
        } else {
            // Coalesce consecutive typing in the same block into one history
            // entry: only the first keystroke pushes; the entry closes on a
            // structural change, blur, or a 1s pause.
            const typing = typingRef.current
            if (!typing || typing.blockId !== id) {
                pushCommit()
                const timer = setTimeout(() => { typingRef.current = null }, 1000)
                typingRef.current = { blockId: id, timer }
            } else {
                clearTimeout(typing.timer)
                typing.timer = setTimeout(() => { typingRef.current = null }, 1000)
            }
        }
        updateBlockRaw(id, content)
    }, [pushCommit, updateBlockRaw])

    const splitBlock = useCallback((blockId: string, before: string, after: string) => {
        const newId = uid()
        pushCommit()
        setBlocksState(prev => {
            const idx = prev.findIndex(b => b.id === blockId)
            if (idx === -1) return prev
            const next = [...prev]
            next[idx] = { ...next[idx], content: before }
            next.splice(idx + 1, 0, { id: newId, content: after })
            return next
        })
        requestAnimationFrame(() => {
            const el = contentRefs.current[newId]
            if (!el) return
            el.focus()
            el.setSelectionRange(0, 0)
        })
    }, [pushCommit])

    const mergeWithPrev = useCallback((id: string, text: string) => {
        const curr = blocksRef.current
        const idx = curr.findIndex(b => b.id === id)
        if (idx <= 0) return
        const prevBlock = curr[idx - 1]
        const mergePoint = prevBlock.content.length
        pushCommit()
        setBlocksState(prev => prev
            .map(b => b.id === prevBlock.id ? { ...b, content: b.content + text } : b)
            .filter(b => b.id !== id),
        )
        requestAnimationFrame(() => {
            const el = contentRefs.current[prevBlock.id]
            if (!el) return
            el.focus()
            el.setSelectionRange(mergePoint, mergePoint)
        })
    }, [pushCommit])

    const pasteIntoBlock = useCallback((blockId: string, before: string, pastedBlocks: string[], after: string) => {
        const firstLine = `${before}${pastedBlocks[0]}`
        const middleLines = pastedBlocks.slice(1, -1)
        const lastLine = pastedBlocks.length > 1 ? `${pastedBlocks[pastedBlocks.length - 1]}${after}` : null

        const newBlocks: Block[] = middleLines.map((line) => ({ id: uid(), content: line }))
        const lastId = lastLine !== null ? uid() : null
        if (lastId !== null && lastLine !== null) {
            newBlocks.push({ id: lastId, content: lastLine })
        }

        pushCommit()
        setBlocksState(prev => {
            const idx = prev.findIndex(b => b.id === blockId)
            if (idx === -1) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], content: firstLine }
            updated.splice(idx + 1, 0, ...newBlocks)
            return updated
        })

        const focusTargetId = lastId ?? blockId
        requestAnimationFrame(() => {
            const focusEl = contentRefs.current[focusTargetId]
            if (!focusEl) return
            focusEl.focus()
            const cursorPos = lastLine !== null ? lastLine.length - after.length : firstLine.length
            focusEl.setSelectionRange(cursorPos, cursorPos)
        })
    }, [pushCommit])

    const duplicateBlocks = useCallback(() => {
        const curr = blocksRef.current
        const focusedId = getFocusedBlockId()
        if (focusedId) {
            const idx = curr.findIndex(b => b.id === focusedId)
            if (idx === -1) return
            pushCommit()
            const dup: Block = { id: uid(), content: curr[idx].content }
            setBlocksState(prev => {
                const next = [...prev]
                next.splice(idx + 1, 0, dup)
                return next
            })
            setPendingFocus({ id: dup.id, start: dup.content.length, end: dup.content.length })
            return
        }

        const selected = selectedRef.current
        if (selected.size === 0) return
        const dups = curr.filter(b => selected.has(b.id)).map(b => ({ id: uid(), content: b.content }))
        if (dups.length === 0) return
        let lastSelectedIdx = -1
        curr.forEach((b, i) => { if (selected.has(b.id)) lastSelectedIdx = i })
        pushCommit()
        const dupIds = new Set(dups.map(d => d.id))
        setBlocksState(prev => {
            const next = [...prev]
            next.splice(lastSelectedIdx + 1, 0, ...dups)
            return next
        })
        setSelectedBlockIds(dupIds)
    }, [getFocusedBlockId, pushCommit])

    // ── Selection (continued) ───────────────────────────────────────

    const deleteSelectedBlocks = useCallback(() => {
        const selected = selectedRef.current
        if (selected.size === 0) return
        const curr = blocksRef.current
        if (curr.length <= selected.size) {
            // Don't allow deleting all — keep one empty block
            pushCommit()
            const keepId = uid()
            setBlocksState([{ id: keepId, content: '' }])
            clearSelection()
            requestAnimationFrame(() => {
                const el = contentRefs.current[keepId]
                el?.focus()
            })
            return
        }
        const firstSelectedIdx = curr.findIndex(b => selected.has(b.id))
        const focusTargetIdx = Math.max(0, firstSelectedIdx - 1)
        const focusTargetId = curr.filter(b => !selected.has(b.id))[Math.min(focusTargetIdx, curr.length - selected.size - 1)]?.id
        pushCommit()
        setBlocksState(prev => prev.filter(b => !selected.has(b.id)))
        clearSelection()
        if (focusTargetId) focusEnd(focusTargetId)
    }, [clearSelection, focusEnd, pushCommit])

    const moveSelectedBlocks = useCallback((direction: 'up' | 'down') => {
        const selected = selectedRef.current
        if (selected.size === 0) return
        const curr = blocksRef.current
        const selectedIndices = curr
            .map((b, i) => (selected.has(b.id) ? i : -1))
            .filter(i => i >= 0)
        if (selectedIndices.length === 0) return
        if (direction === 'up' && selectedIndices[0] === 0) return
        if (direction === 'down' && selectedIndices[selectedIndices.length - 1] === curr.length - 1) return
        pushCommit()
        setBlocksState(prev => {
            const next = [...prev]
            const ordered = direction === 'up' ? selectedIndices : [...selectedIndices].reverse()
            const delta = direction === 'up' ? -1 : 1
            for (const idx of ordered) {
                const swap = idx + delta
                    ;[next[swap], next[idx]] = [next[idx], next[swap]]
            }
            return next
        })
    }, [pushCommit])

    // ── Cross-block caret navigation ────────────────────────────────

    const handleCaretExit = useCallback((blockId: string, direction: 'up' | 'down'): boolean => {
        const curr = blocksRef.current
        const idx = curr.findIndex(b => b.id === blockId)
        const target = direction === 'up' ? curr[idx - 1] : curr[idx + 1]
        if (!target) return false
        requestAnimationFrame(() => {
            const el = contentRefs.current[target.id]
            if (!el) return
            el.focus()
            const pos = direction === 'up' ? el.value.length : 0
            el.setSelectionRange(pos, pos)
        })
        return true
    }, [])

    // ── Find & replace ──────────────────────────────────────────────

    const computeMatches = useCallback(() => matchesOf(blocksRef.current, findTextRef.current, matchCaseRef.current), [])

    // State-driven for the visible counter; navigation recomputes from refs
    // so it never acts on stale state mid-event.
    const matches = useMemo(() => matchesOf(blocks, findText, matchCase), [blocks, findText, matchCase])

    const gotoMatch = useCallback((index: number) => {
        const ms = computeMatches()
        if (ms.length === 0) return
        const wrapped = ((index % ms.length) + ms.length) % ms.length
        activeMatchIdxRef.current = wrapped
        setActiveMatchIdx(wrapped)
        const match = ms[wrapped]
        setPendingFocus({ id: match.blockId, start: match.start, end: match.end })
    }, [computeMatches])

    const findNext = useCallback(() => {
        gotoMatch(activeMatchIdxRef.current + 1)
    }, [gotoMatch])

    const findPrev = useCallback(() => {
        gotoMatch(activeMatchIdxRef.current < 0 ? -1 : activeMatchIdxRef.current - 1)
    }, [gotoMatch])

    const closeFind = useCallback(() => {
        setFindOpen(false)
        setActiveMatchIdx(-1)
        activeMatchIdxRef.current = -1
    }, [])

    const replaceCurrent = useCallback(() => {
        const needle = findTextRef.current
        if (!needle) return
        const ms = computeMatches()
        if (ms.length === 0) return
        const idx = activeMatchIdxRef.current < 0 ? 0 : ((activeMatchIdxRef.current % ms.length) + ms.length) % ms.length
        const match = ms[idx]
        const block = blocksRef.current.find(b => b.id === match.blockId)
        if (!block) return
        const segment = block.content.slice(match.start, match.end)
        const target = matchCaseRef.current ? needle : needle.toLowerCase()
        const actual = matchCaseRef.current ? segment : segment.toLowerCase()
        // The match may have gone stale (edited underneath us) — reselect
        // instead of corrupting content.
        if (actual !== target) {
            gotoMatch(idx)
            return
        }
        pushCommit()
        const replacement = replaceTextRef.current
        const nextContent = block.content.slice(0, match.start) + replacement + block.content.slice(match.end)
        updateBlockRaw(match.blockId, nextContent)
        // Compute the match to advance to synchronously against the already-
        // updated content — no dependence on commit timing.
        const replacedBlockIdx = blocksRef.current.findIndex(b => b.id === match.blockId)
        const nextBlocks = blocksRef.current.map((b, i) => (i === replacedBlockIdx ? { ...b, content: nextContent } : b))
        const ms2 = matchesOf(nextBlocks, needle, matchCaseRef.current)
        const minStart = match.start + replacement.length
        let idx2 = ms2.findIndex(m2 => {
            const bi = nextBlocks.findIndex(b => b.id === m2.blockId)
            return bi > replacedBlockIdx || (bi === replacedBlockIdx && m2.start >= minStart)
        })
        if (idx2 === -1 && ms2.length > 0) idx2 = 0
        if (idx2 === -1) {
            setActiveMatchIdx(-1)
            activeMatchIdxRef.current = -1
            return
        }
        activeMatchIdxRef.current = idx2
        setActiveMatchIdx(idx2)
        setPendingFocus({ id: ms2[idx2].blockId, start: ms2[idx2].start, end: ms2[idx2].end })
    }, [computeMatches, gotoMatch, pushCommit, updateBlockRaw])

    const replaceAll = useCallback(() => {
        const ms = computeMatches()
        if (ms.length === 0) return
        pushCommit()
        const replacement = replaceTextRef.current
        const byBlock = new Map<string, FindMatch[]>()
        for (const match of ms) {
            const list = byBlock.get(match.blockId) ?? []
            list.push(match)
            byBlock.set(match.blockId, list)
        }
        const replaced = new Map<string, string>()
        for (const [blockId, list] of byBlock) {
            const block = blocksRef.current.find(b => b.id === blockId)
            if (!block) continue
            let content = block.content
            // Last-to-first keeps earlier offsets valid while splicing.
            for (const match of [...list].sort((a, b) => b.start - a.start)) {
                content = content.slice(0, match.start) + replacement + content.slice(match.end)
            }
            replaced.set(blockId, content)
        }
        setBlocksState(prev => prev.map(b => replaced.has(b.id) ? { ...b, content: replaced.get(b.id)! } : b))
        setActiveMatchIdx(-1)
        activeMatchIdxRef.current = -1
    }, [computeMatches, pushCommit])

    // ── Keyboard ────────────────────────────────────────────────────

    // Focus the root when selection becomes active so keyboard handlers receive events.
    useEffect(() => {
        if (selectedBlockIds.size === 0) return
        if (document.activeElement instanceof HTMLTextAreaElement) return
        rootRef.current?.focus()
    }, [selectedBlockIds])

    const handleRootKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        const isMod = event.metaKey || event.ctrlKey
        const keyLower = event.key.toLowerCase()
        const targetIsTextarea = event.target instanceof HTMLTextAreaElement
        // The find bar's inputs own their text editing — only find-specific
        // shortcuts apply there.
        const targetIsFindInput = event.target instanceof HTMLInputElement

        // Universal shortcuts — these work inside textareas too so there is a
        // single consistent history / command surface.
        if (!targetIsFindInput) {
            if (isMod && !event.altKey && keyLower === 'z') {
                event.preventDefault()
                event.stopPropagation()
                if (event.shiftKey) redo()
                else undo()
                return
            }
            if (isMod && !event.altKey && keyLower === 'y') {
                event.preventDefault()
                event.stopPropagation()
                redo()
                return
            }
            if (isMod && !event.altKey && keyLower === 'd') {
                event.preventDefault()
                event.stopPropagation()
                duplicateBlocks()
                return
            }
            if (isMod && !event.altKey && event.key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
                onSubmitRef.current?.()
                return
            }
        }
        if (isMod && !event.altKey && keyLower === 'f') {
            event.preventDefault()
            event.stopPropagation()
            setFindOpen(open => !open)
            return
        }
        if (event.key === 'Escape' && findOpenRef.current) {
            event.preventDefault()
            event.stopPropagation()
            closeFind()
            return
        }

        if (targetIsTextarea || targetIsFindInput) return

        // Clipboard / select-all — must not fire inside a textarea
        if (isMod && !event.altKey && keyLower === 'a') {
            event.preventDefault()
            event.stopPropagation()
            selectAllBlocks()
            return
        }

        if (selectedBlockIds.size === 0) return

        if (isMod && !event.altKey && (keyLower === 'c' || keyLower === 'x')) {
            event.preventDefault()
            event.stopPropagation()
            const text = blocksRef.current
                .filter(b => selectedRef.current.has(b.id))
                .map(b => b.content)
                .join('\n\n')
            // Cut deletes only after the clipboard write lands — a failed
            // write must not destroy the selected blocks.
            void window.castApi.writeClipboardText(text)
                .then(() => { if (keyLower === 'x') deleteSelectedBlocks() })
                .catch(() => {})
            return
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault()
            event.stopPropagation()
            deleteSelectedBlocks()
            return
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            moveSelectedBlocks('up')
            return
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            moveSelectedBlocks('down')
            return
        }
        if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            clearSelection()
        }
    }, [clearSelection, closeFind, deleteSelectedBlocks, duplicateBlocks, moveSelectedBlocks, redo, selectAllBlocks, selectedBlockIds.size, undo])

    const handleTextareaFocus = useCallback(() => {
        clearSelection()
    }, [clearSelection])

    const handleTextareaBlur = useCallback(() => {
        flushTyping()
    }, [flushTyping])

    // ── Marquee (rubber-band) selection ─────────────────────────────
    // A drag started anywhere in the editor draws a selection rectangle and
    // selects every block it crosses. Native text selection is suppressed
    // while the marquee is active. A plain click (no drag past the threshold)
    // is left untouched so the textarea still focuses normally.

    const DRAG_THRESHOLD = 4

    const selectBlocksInRect = useCallback((top: number, bottom: number) => {
        const ids = new Set<string>()
        for (const block of blocksRef.current) {
            const row = rowRefs.current[block.id]
            if (!row) continue
            const r = row.getBoundingClientRect()
            if (r.bottom >= top && r.top <= bottom) ids.add(block.id)
        }
        setSelectedBlockIds(prev => {
            if (prev.size === ids.size && [...ids].every(id => prev.has(id))) return prev
            return ids
        })
    }, [])

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        // A drag that starts inside a block's textarea is a native caret text
        // selection — leave it to the browser. The marquee is for block selection
        // and is only armed from the margins / empty space around the textareas.
        // Find-bar inputs are excluded for the same reason.
        if (event.target instanceof HTMLTextAreaElement) return
        if (event.target instanceof HTMLInputElement) return
        dragRef.current = { startX: event.clientX, startY: event.clientY, active: false }

        const onMove = (e: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return
            if (!drag.active) {
                const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
                if (moved < DRAG_THRESHOLD) return
                drag.active = true
                // Drop any caret/text selection and the focused textarea so the
                // root keyboard handlers (delete / move / escape) take over.
                window.getSelection()?.removeAllRanges()
                if (document.activeElement instanceof HTMLTextAreaElement) {
                    document.activeElement.blur()
                }
            }
            e.preventDefault()
            window.getSelection()?.removeAllRanges()
            const left = Math.min(drag.startX, e.clientX)
            const right = Math.max(drag.startX, e.clientX)
            const top = Math.min(drag.startY, e.clientY)
            const bottom = Math.max(drag.startY, e.clientY)
            const rootRect = rootRef.current?.getBoundingClientRect()
            if (rootRect) {
                setMarquee({
                    left: left - rootRect.left,
                    top: top - rootRect.top,
                    width: right - left,
                    height: bottom - top,
                })
            }
            selectBlocksInRect(top, bottom)
        }

        const onUp = () => {
            dragCleanupRef.current?.()
            const drag = dragRef.current
            dragRef.current = null
            setMarquee(null)
            // A click with no drag on empty space clears the selection.
            if (drag && !drag.active && !(event.target instanceof HTMLTextAreaElement)) {
                clearSelection()
            }
        }

        dragCleanupRef.current?.()
        dragCleanupRef.current = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            if (dragCleanupRef.current) dragCleanupRef.current = null
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
    }, [clearSelection, selectBlocksInRect])

    useEffect(() => {
        return () => {
            dragCleanupRef.current?.()
            dragRef.current = null
        }
    }, [])

    // ── Imperative handle ───────────────────────────────────────────

    useImperativeHandle(ref, () => ({
        getBlocks: () => blocksRef.current.map(b => ({ ...b })),
        setBlocks: (next: Block[]) => {
            pushCommit()
            const sanitized = next.length ? next.map(b => ({ ...b })) : [{ id: uid(), content: '' }]
            setBlocksState(sanitized)
            clearSelection()
            // Preserve focus sanely: keep the focused block when it survives,
            // otherwise fall back to the first block.
            const currentFocus = captureFocus()
            const targetId = currentFocus && sanitized.some(b => b.id === currentFocus.id)
                ? currentFocus.id
                : sanitized[0].id
            const targetBlock = sanitized.find(b => b.id === targetId)!
            setPendingFocus({ id: targetId, start: targetBlock.content.length, end: targetBlock.content.length })
        },
    }), [captureFocus, clearSelection, pushCommit])

    // ── Render ──────────────────────────────────────────────────────

    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            onKeyDown={handleRootKeyDown}
            onPointerDown={handlePointerDown}
            className={cn(
                'relative min-h-full w-full px-6 py-5 outline-none',
                marquee && 'select-none',
                className,
            )}
        >
            {findOpen && (
                <div
                    data-testid="doc-find-bar"
                    className="mx-auto mb-2 flex w-full max-w-[680px] items-center gap-1 rounded-md border border-secondary bg-primary px-2 py-1"
                >
                    <input
                        ref={findInputRef}
                        value={findText}
                        onChange={e => { setFindText(e.target.value); setActiveMatchIdx(-1); activeMatchIdxRef.current = -1 }}
                        onKeyDown={e => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            if (e.shiftKey) findPrev()
                            else findNext()
                        }}
                        placeholder="Find"
                        data-testid="doc-find-input"
                        className="w-32 rounded-sm bg-tertiary px-1.5 py-0.5 text-paragraph-sm text-primary outline-none placeholder:text-quaternary"
                    />
                    <input
                        value={replaceText}
                        onChange={e => setReplaceText(e.target.value)}
                        placeholder="Replace"
                        data-testid="doc-replace-input"
                        className="w-32 rounded-sm bg-tertiary px-1.5 py-0.5 text-paragraph-sm text-primary outline-none placeholder:text-quaternary"
                    />
                    <button
                        type="button"
                        aria-pressed={matchCase}
                        data-testid="doc-find-match-case"
                        onClick={() => setMatchCase(v => !v)}
                        className={cn('rounded-sm px-1.5 py-0.5 text-paragraph-sm', matchCase ? 'bg-brand_solid/25 text-primary' : 'text-secondary hover:bg-tertiary')}
                    >
                        Aa
                    </button>
                    <button type="button" aria-label="Previous match" data-testid="doc-find-prev" onClick={findPrev} className="rounded-sm px-1.5 py-0.5 text-paragraph-sm text-secondary hover:bg-tertiary">↑</button>
                    <button type="button" aria-label="Next match" data-testid="doc-find-next" onClick={findNext} className="rounded-sm px-1.5 py-0.5 text-paragraph-sm text-secondary hover:bg-tertiary">↓</button>
                    <span data-testid="doc-find-count" className="min-w-10 text-center text-quaternary">
                        {findText && matches.length > 0 ? `${Math.max(activeMatchIdx + 1, 0)}/${matches.length}` : ''}
                    </span>
                    <button type="button" data-testid="doc-find-replace" onClick={replaceCurrent} className="rounded-sm px-1.5 py-0.5 text-paragraph-sm text-secondary hover:bg-tertiary">Replace</button>
                    <button type="button" data-testid="doc-find-replace-all" onClick={replaceAll} className="rounded-sm px-1.5 py-0.5 text-paragraph-sm text-secondary hover:bg-tertiary">All</button>
                    <button type="button" aria-label="Close find" data-testid="doc-find-close" onClick={closeFind} className="rounded-sm px-1.5 py-0.5 text-paragraph-sm text-secondary hover:bg-tertiary">×</button>
                </div>
            )}
            <div className="mx-auto w-full max-w-[680px] space-y-0.5">
                {blocks.map((block, index) => (
                    <SortableBlock
                        index={index}
                        key={block.id}
                        block={block}
                        isSelected={selectedBlockIds.has(block.id)}
                        rowRef={el => { rowRefs.current[block.id] = el }}
                        contentRef={el => { contentRefs.current[block.id] = el }}
                        accessory={renderBlockAccessory?.(block, index) ?? null}
                        onUpdate={(content, source) => updateBlock(block.id, content, source ?? 'type')}
                        onSplit={(before, after) => splitBlock(block.id, before, after)}
                        onDelete={() => deleteBlock(block.id)}
                        onMergeWithPrev={text => mergeWithPrev(block.id, text)}
                        onPaste={(before, pastedBlocks, after) => pasteIntoBlock(block.id, before, pastedBlocks, after)}
                        onCaretExit={direction => handleCaretExit(block.id, direction)}
                        onSelectAllBlocks={selectAllBlocks}
                        onTextareaFocus={handleTextareaFocus}
                        onTextareaBlur={handleTextareaBlur}
                    />
                ))}
            </div>
            {marquee && (
                <div
                    className="pointer-events-none absolute z-10 rounded-sm border border-brand_solid bg-brand_solid/10"
                    style={{
                        left: marquee.left,
                        top: marquee.top,
                        width: marquee.width,
                        height: marquee.height,
                    }}
                />
            )}
        </div>
    )
})

export default DocEditor
