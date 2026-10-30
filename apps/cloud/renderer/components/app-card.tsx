import { Check, MoreHorizontal } from "lucide-react";
import type { SelectionModifiers } from "@lumacast/selection";
import {
  Badge,
  Panel,
  PointContextMenu,
  Paragraph,
  Progress,
  ReacstButton,
  usePointContextMenu,
  type MenuEntry,
  type StatusTone,
} from "@lumacast/ui";
import type {
  AppState,
  AppStatus,
  HostPlatform,
  SuiteAppDescriptor,
} from "@lumacast/suite";
import type {
  OperationSnapshot,
  SelfUpdateState,
} from "../../shared/desktop-api";
import {
  isCancellable,
  operationStatusLabel,
  primaryAction,
  revealLabel,
  statusLabel,
  type PrimaryActionKind,
} from "../presentation";

const STATUS_TONE: Record<AppStatus, StatusTone> = {
  "not-installed": "neutral",
  "up-to-date": "success",
  "update-available": "brand",
  ahead: "neutral",
  unknown: "neutral",
};

interface AppCardProps {
  descriptor: SuiteAppDescriptor;
  state: AppState;
  isSelf: boolean;
  selfUpdate?: SelfUpdateState;
  activeOperation?: OperationSnapshot;
  platform: HostPlatform;
  selected: boolean;
  selectionDisabled?: boolean;
  onSelect: (modifiers: SelectionModifiers) => void;
  onToggleSelect: (modifiers: SelectionModifiers) => void;
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
  selected,
  selectionDisabled = false,
  onSelect,
  onToggleSelect,
  onPrimaryAction,
  onOpen,
  onReveal,
  onOtherVersions,
  onUninstall,
  onReleaseNotes,
  onCancel,
}: AppCardProps) {
  const primary = primaryAction(
    state,
    activeOperation ? [activeOperation] : [],
    selfUpdate,
  );
  const menu = usePointContextMenu();
  const menuEntries: MenuEntry[] = [
    { id: "versions", label: "Other versions…", onSelect: onOtherVersions },
    ...(state.installed
      ? [
          { id: "open", label: "Open", onSelect: onOpen },
          { id: "reveal", label: revealLabel(platform), onSelect: onReveal },
        ]
      : []),
    ...(state.latest
      ? [{ id: "notes", label: "Release notes", onSelect: onReleaseNotes }]
      : []),
    ...(state.installed
      ? [
          { separator: true as const },
          {
            id: "uninstall",
            label: "Uninstall…",
            danger: true,
            onSelect: onUninstall,
          },
        ]
      : []),
  ];
  const selectionModifiers = (event: {
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
  }): SelectionModifiers => ({
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
  });

  return (
    <Panel
      variant="raised"
      fill={false}
      role="group"
      aria-label={`${descriptor.productName}${selected ? ", selected" : ""}`}
      tabIndex={0}
      data-selected={selected ? "true" : undefined}
      className={`cursor-pointer ${selected ? "ring-2 ring-brand ring-inset" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
      onClick={(event) => {
        if (selectionDisabled) return;
        if (
          event.target instanceof Element &&
          event.target.closest("button, a, input, select, textarea")
        )
          return;
        onSelect(selectionModifiers(event));
      }}
      onKeyDown={(event) => {
        if (selectionDisabled) return;
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(selectionModifiers(event));
      }}
    >
      <Panel.Header divided={false}>
        <Panel.HeaderTitle>{descriptor.productName}</Panel.HeaderTitle>
        <Panel.HeaderActions>
          <button
            type="button"
            aria-label={`${selected ? "Deselect" : "Select"} ${descriptor.productName}`}
            aria-pressed={selected}
            disabled={selectionDisabled}
            className={`shrink-0 rounded-control p-1.5 outline-hidden ${selected ? "text-brand" : "text-tertiary hover:bg-tertiary hover:text-primary"}`}
            onClick={(event) => {
              event.stopPropagation();
              const modifiers = selectionModifiers(event);
              if (
                !modifiers.shiftKey &&
                !modifiers.metaKey &&
                !modifiers.ctrlKey
              ) {
                modifiers.ctrlKey = true;
              }
              onToggleSelect(modifiers);
            }}
          >
            <Check size={16} aria-hidden="true" />
          </button>
          {!isSelf ? (
            <>
              <button
                type="button"
                aria-label="More actions"
                aria-haspopup="menu"
                className="shrink-0 rounded-control p-1.5 text-tertiary outline-hidden hover:bg-tertiary hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  menu.show({
                    clientX: rect.left,
                    clientY: rect.bottom + 4,
                    preventDefault: () => event.preventDefault(),
                  });
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              <PointContextMenu
                open={menu.open}
                position={menu.position}
                entries={menuEntries}
                label="More actions"
                onClose={menu.close}
              />
            </>
          ) : null}
        </Panel.HeaderActions>
      </Panel.Header>
      <Panel.Body scroll={false} padded className="flex flex-col gap-3 pt-0">
        <Paragraph.xs className="text-tertiary">
          {descriptor.summary}
        </Paragraph.xs>

        <Badge tone={STATUS_TONE[state.status]}>{statusLabel(state)}</Badge>

        {state.installed ? (
          <Paragraph.xs className="truncate text-tertiary">
            {state.installed.location}
          </Paragraph.xs>
        ) : null}

        {activeOperation ? (
          <div className="flex flex-col gap-1.5">
            <Progress
              value={activeOperation.progress.percent}
              label={operationStatusLabel(activeOperation)}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="label-xs text-tertiary">
                {operationStatusLabel(activeOperation)}
              </span>
              {isCancellable(activeOperation) ? (
                <ReacstButton
                  variant="ghost"
                  size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.metaKey || event.ctrlKey || event.shiftKey)
                      return;
                    onCancel();
                  }}
                >
                  Cancel
                </ReacstButton>
              ) : null}
            </div>
          </div>
        ) : (
          <ReacstButton
            variant="tinted"
            fullWidth
            disabled={primary.action === "none"}
            onClick={(event) => {
              event.stopPropagation();
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              onPrimaryAction(primary.action);
            }}
          >
            {primary.label}
          </ReacstButton>
        )}
      </Panel.Body>
    </Panel>
  );
}
