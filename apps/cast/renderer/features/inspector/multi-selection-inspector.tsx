import { useEffect, useMemo, useState } from 'react';
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical } from 'lucide-react';
import type { SlideElement } from '@lumacast/composition';
import { Label, ReacstButton } from '@lumacast/ui';
import { useElements } from '../../contexts/canvas/canvas-context';
import { FieldInput } from '../../components/form/field';
import { IconGroup } from '../../components/icon-group';
import { parseNumber } from '../../utils/slides';
import { Section } from './inspector-section';

function selectionOrigin(elements: SlideElement[]) {
  if (elements.length === 0) return null;
  return {
    x: Math.min(...elements.map((element) => element.x)),
    y: Math.min(...elements.map((element) => element.y)),
  };
}

function sharedOpacity(elements: SlideElement[]): number | null {
  if (elements.length === 0) return null;
  const opacity = elements[0].opacity;
  return elements.every((element) => Math.abs(element.opacity - opacity) < 0.0001) ? opacity : null;
}

export function MultiSelectionInspector() {
  const {
    selectedElementIds,
    effectiveElements,
    nudgeSelection,
    commitElementUpdates,
    alignSelection,
    distributeSelection,
    groupSelection,
    ungroupSelection,
    duplicateSelection,
    deleteSelected,
  } = useElements();

  const selectedElements = useMemo(
    () => effectiveElements.filter((element) => selectedElementIds.includes(element.id)),
    [effectiveElements, selectedElementIds],
  );
  const editableElements = useMemo(
    () => selectedElements.filter((element) => !element.payload.locked),
    [selectedElements],
  );
  const origin = useMemo(() => selectionOrigin(editableElements), [editableElements]);
  const opacity = useMemo(() => sharedOpacity(editableElements), [editableElements]);
  const selectedGroups = selectedElements.filter((element) => element.type === 'group' && !element.payload.locked);
  const lockedCount = selectedElements.length - editableElements.length;
  const selectionKey = selectedElementIds.join('\u0000');
  const [xDraft, setXDraft] = useState('');
  const [yDraft, setYDraft] = useState('');
  const [opacityDraft, setOpacityDraft] = useState('');

  useEffect(() => {
    setXDraft(origin ? String(Math.round(origin.x)) : '');
    setYDraft(origin ? String(Math.round(origin.y)) : '');
  }, [origin?.x, origin?.y, selectionKey]);

  useEffect(() => {
    setOpacityDraft(opacity === null ? '' : String(Math.round(opacity * 100)));
  }, [opacity, selectionKey]);

  function commitPosition(axis: 'x' | 'y') {
    if (!origin) return;
    const draft = axis === 'x' ? xDraft : yDraft;
    const current = origin[axis];
    const displayedCurrent = Math.round(current);
    const requested = parseNumber(draft, displayedCurrent);
    if (requested === displayedCurrent) return;
    const delta = requested - current;
    if (axis === 'x') void nudgeSelection(delta, 0).catch(() => undefined);
    else void nudgeSelection(0, delta).catch(() => undefined);
  }

  function commitOpacity() {
    if (editableElements.length === 0 || opacityDraft.trim() === '') return;
    const requestedPercent = parseNumber(opacityDraft, opacity === null ? 100 : Math.round(opacity * 100));
    const nextOpacity = Math.max(0, Math.min(1, requestedPercent / 100));
    const updates = editableElements
      .filter((element) => Math.abs(element.opacity - nextOpacity) >= 0.0001)
      .map((element) => ({ id: element.id, opacity: nextOpacity }));
    if (updates.length > 0) void commitElementUpdates(updates, true).catch(() => undefined);
  }

  const canAlign = editableElements.length >= 2;
  const canDistribute = editableElements.length >= 3;

  return (
    <>
      <Section.Root>
        <Section.Header>
          <Label.xs>{`${selectedElementIds.length} selected`}</Label.xs>
          {lockedCount > 0 ? <span className="ml-auto text-xs text-tertiary">{lockedCount} locked</span> : null}
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <FieldInput
              type="number"
              label="Selection X"
              value={xDraft}
              disabled={!origin}
              onChange={setXDraft}
              onBlur={() => commitPosition('x')}
            />
            <FieldInput
              type="number"
              label="Selection Y"
              value={yDraft}
              disabled={!origin}
              onChange={setYDraft}
              onBlur={() => commitPosition('y')}
            />
          </Section.Row>
          <Section.Row>
            <FieldInput
              type="number"
              label="Opacity (%)"
              value={opacityDraft}
              placeholder={opacity === null && editableElements.length > 0 ? 'Mixed' : undefined}
              min={0}
              max={100}
              step={1}
              disabled={editableElements.length === 0}
              onChange={setOpacityDraft}
              onBlur={commitOpacity}
            />
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Align</Label.xs></Section.Header>
        <Section.Body>
          <Section.Row>
            <IconGroup.Root fill>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('left', 'selection').catch(() => undefined); }} title="Align left" aria-label="Align left">
                <AlignStartVertical className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('centerX', 'selection').catch(() => undefined); }} title="Align center" aria-label="Align center">
                <AlignCenterVertical className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('right', 'selection').catch(() => undefined); }} title="Align right" aria-label="Align right">
                <AlignEndVertical className="size-4" />
              </IconGroup.Item>
            </IconGroup.Root>
            <IconGroup.Root fill>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('top', 'selection').catch(() => undefined); }} title="Align top" aria-label="Align top">
                <AlignStartHorizontal className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('centerY', 'selection').catch(() => undefined); }} title="Align middle" aria-label="Align middle">
                <AlignCenterHorizontal className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item disabled={!canAlign} onClick={() => { void alignSelection('bottom', 'selection').catch(() => undefined); }} title="Align bottom" aria-label="Align bottom">
                <AlignEndHorizontal className="size-4" />
              </IconGroup.Item>
            </IconGroup.Root>
          </Section.Row>
          <Section.Row>
            <ReacstButton variant="ghost" className="flex-1" disabled={!canDistribute} onClick={() => { void distributeSelection('horizontal').catch(() => undefined); }}>
              Distribute horizontally
            </ReacstButton>
            <ReacstButton variant="ghost" className="flex-1" disabled={!canDistribute} onClick={() => { void distributeSelection('vertical').catch(() => undefined); }}>
              Distribute vertically
            </ReacstButton>
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header><Label.xs>Objects</Label.xs></Section.Header>
        <Section.Body>
          <div className="grid grid-cols-2 gap-2">
            <ReacstButton variant="ghost" disabled={editableElements.length < 2} onClick={() => { void groupSelection().catch(() => undefined); }}>
              Group
            </ReacstButton>
            {selectedGroups.length === 1 ? (
              <ReacstButton variant="ghost" onClick={() => { void ungroupSelection(selectedGroups[0].id).catch(() => undefined); }}>
                Ungroup
              </ReacstButton>
            ) : null}
            <ReacstButton variant="ghost" disabled={selectedElements.length === 0} onClick={() => { void duplicateSelection().catch(() => undefined); }}>
              Duplicate
            </ReacstButton>
            <ReacstButton variant="danger" disabled={selectedElements.length === 0} onClick={() => { void deleteSelected().catch(() => undefined); }}>
              Delete
            </ReacstButton>
          </div>
        </Section.Body>
      </Section.Root>
    </>
  );
}
