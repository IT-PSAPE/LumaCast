import {
  ListRow,
  ReacstButton,
  SegmentedControl,
  Switch,
  Title,
} from "@lumacast/ui";
import { suiteApp } from "@lumacast/suite";
import type {
  CloudDesktopAPI,
  CloudSettingsPatch,
  SuiteOverview,
} from "../../shared/desktop-api";
import { ActionErrors } from "../components/action-errors";
import { useActionFeedback } from "../hooks/use-cloud-actions";

type SettingsAction = { kind: "settings"; patch: CloudSettingsPatch } | { kind: "revoke"; app: Parameters<CloudDesktopAPI["revoke"]>[0] };

interface SettingsScreenProps {
  overview: SuiteOverview;
  api: CloudDesktopAPI;
}

export function SettingsScreen({ overview, api }: SettingsScreenProps) {
  const { settings, host } = overview;
  const feedback = useActionFeedback<SettingsAction>(api);
  const busy = !feedback.ready || feedback.isBusy("settings");
  const run = (action: SettingsAction) => {
    void feedback.run("settings", action,
      action.kind === "revoke" ? `Could not revoke access for ${suiteApp(action.app).productName}.` : "Could not save settings.",
      (current) => action.kind === "revoke" ? current.revoke(action.app) : current.updateSettings(action.patch));
  };
  const systemScopeDisabled =
    host.platform === "win32" && !host.systemScopeWritable;

  return (
    <div className="flex flex-col gap-8">
      <Title.h4>Settings</Title.h4>
      <ActionErrors failures={feedback.failures} onRetry={(failure) => run(failure.action)} onDismiss={feedback.dismiss} isBusy={() => busy} />

      <section className="flex flex-col gap-3">
        <Title.h6>Install location</Title.h6>
        <SegmentedControl
          value={settings.installScope}
          onValueChange={(value) => {
            if (value === "user" || value === "system") run({ kind: "settings", patch: { installScope: value } });
          }}
        >
          <SegmentedControl.Label value="user" disabled={busy}>For me</SegmentedControl.Label>
          <SegmentedControl.Label value="system" disabled={busy || systemScopeDisabled}>
            All users
          </SegmentedControl.Label>
        </SegmentedControl>
        <p className="paragraph-xs text-tertiary">
          {host.installLocations[settings.installScope]}
        </p>
      </section>

      <section className="flex items-center justify-between gap-4">
        <Title.h6>Check for updates on launch</Title.h6>
        <Switch
          label="Check for updates on launch"
          checked={settings.checkOnLaunch}
          disabled={busy}
          onCheckedChange={(checked) => {
            run({ kind: "settings", patch: { checkOnLaunch: checked } });
          }}
        />
      </section>

      <section className="flex items-center justify-between gap-4">
        <Title.h6>Check for updates in background</Title.h6>
        <Switch
          label="Check for updates in background"
          checked={settings.checkInBackground}
          disabled={busy}
          onCheckedChange={(checked) => {
            run({ kind: "settings", patch: { checkInBackground: checked } });
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Title.h6>Permissions</Title.h6>
        {settings.grants.length === 0 ? (
          <p className="paragraph-xs text-tertiary">No apps granted yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {settings.grants.map((grant) => (
              <ListRow key={grant.app} actions="always">
                <ListRow.Label description={grant.bundleId}>
                  {suiteApp(grant.app).productName}
                </ListRow.Label>
                <ListRow.Actions>
                  <ReacstButton
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      run({ kind: "revoke", app: grant.app });
                    }}
                  >
                    Revoke
                  </ReacstButton>
                </ListRow.Actions>
              </ListRow>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Title.h6>About</Title.h6>
        <div className="flex items-center justify-between gap-4">
          <span className="paragraph-sm text-secondary">
            LumaCloud {host.cloudVersion}
          </span>
          <ReacstButton
            variant="ghost"
            onClick={() => {
              void api.checkForSelfUpdate();
            }}
          >
            Check for Updates
          </ReacstButton>
        </div>
      </section>
    </div>
  );
}
