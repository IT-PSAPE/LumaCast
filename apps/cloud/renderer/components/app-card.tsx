import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { Paragraph, ReacstButton, Title } from '@lumacast/ui';
import type { AppState, HostPlatform, SuiteAppDescriptor } from '@lumacast/suite';
import type { OperationSnapshot, SelfUpdateState } from '../../shared/desktop-api';
import { isCancellable, primaryAction, revealLabel, statusLabel, type PrimaryActionKind } from '../presentation';
import { OperationProgress } from './operation-progress';
import { StatusPill } from './status-pill';

const MENU_ITEM_CLASS =
  'w-full cursor-pointer rounded px-2 py-1.5 text-left label-xs text-secondary outline-hidden data-[highlighted]:bg-secondary data-[highlighted]:text-primary';
const MENU_ITEM_DANGER_CLASS =
  'w-full cursor-pointer rounded px-2 py-1.5 text-left label-xs text-error outline-hidden data-[highlighted]:bg-error/15';

interface OverflowMenuProps {
  state: AppState;
  platform: HostPlatform;
  onOpen: () => void;
  onReveal: () => void;
  onOtherVersions: () => void;
  onUninstall: () => void;
  onReleaseNotes: () => void;
}

function OverflowMenu({ state, platform, onOpen, onReveal, onOtherVersions, onUninstall, onReleaseNotes }: OverflowMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="shrink-0 rounded-sm p-1.5 text-tertiary outline-hidden hover:bg-tertiary hover:text-primary"
        aria-label="More actions"
      >
        <MoreHorizontal size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="outline-hidden">
          <Menu.Popup className="min-w-40 rounded-md border border-primary bg-primary p-1 shadow-lg outline-hidden">
            <Menu.Item render={<button type="button" />} nativeButton className={MENU_ITEM_CLASS} onClick={onOtherVersions}>
              Other versions…
            </Menu.Item>
            {state.installed ? (
              <Menu.Item render={<button type="button" />} nativeButton className={MENU_ITEM_CLASS} onClick={onOpen}>
                Open
              </Menu.Item>
            ) : null}
            {state.installed ? (
              <Menu.Item render={<button type="button" />} nativeButton className={MENU_ITEM_CLASS} onClick={onReveal}>
                {revealLabel(platform)}
              </Menu.Item>
            ) : null}
            {state.latest ? (
              <Menu.Item render={<button type="button" />} nativeButton className={MENU_ITEM_CLASS} onClick={onReleaseNotes}>
                Release notes
              </Menu.Item>
            ) : null}
            {state.installed ? (
              <>
                <Menu.Separator className="my-1 h-px bg-tertiary" />
                <Menu.Item render={<button type="button" />} nativeButton className={MENU_ITEM_DANGER_CLASS} onClick={onUninstall}>
                  Uninstall…
                </Menu.Item>
              </>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

interface AppCardProps {
  descriptor: SuiteAppDescriptor;
  state: AppState;
  isSelf: boolean;
  selfUpdate?: SelfUpdateState;
  activeOperation?: OperationSnapshot;
  platform: HostPlatform;
  onPrimaryAction: (action: PrimaryActionKind) => void;
  onOpen: () => void;
  onReveal: () => void;
  onOtherVersions: () => void;
  onUninstall: () => void;
  onReleaseNotes: () => void;
  onCancel: () => void;
}

export function AppCard({
  descriptor,
  state,
  isSelf,
  selfUpdate,
  activeOperation,
  platform,
  onPrimaryAction,
  onOpen,
  onReveal,
  onOtherVersions,
  onUninstall,
  onReleaseNotes,
  onCancel,
}: AppCardProps) {
  const primary = primaryAction(state, activeOperation ? [activeOperation] : [], selfUpdate);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary bg-secondary p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Title.h6 className="truncate">{descriptor.productName}</Title.h6>
          <Paragraph.xs className="text-tertiary">{descriptor.summary}</Paragraph.xs>
        </div>
        {!isSelf ? (
          <OverflowMenu
            state={state}
            platform={platform}
            onOpen={onOpen}
            onReveal={onReveal}
            onOtherVersions={onOtherVersions}
            onUninstall={onUninstall}
            onReleaseNotes={onReleaseNotes}
          />
        ) : null}
      </div>

      <StatusPill status={state.status} label={statusLabel(state)} />

      {state.installed ? <Paragraph.xs className="truncate text-tertiary">{state.installed.location}</Paragraph.xs> : null}

      {activeOperation ? (
        <OperationProgress operation={activeOperation} cancellable={isCancellable(activeOperation)} onCancel={onCancel} />
      ) : (
        <ReacstButton
          className="w-full bg-brand/15 text-brand hover:bg-brand/25"
          disabled={primary.action === 'none'}
          onClick={() => onPrimaryAction(primary.action)}
        >
          {primary.label}
        </ReacstButton>
      )}
    </div>
  );
}
