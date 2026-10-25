import {
  Panel,
  ReacstButton,
  SegmentedControl,
  Switch,
  Title,
} from "@lumacast/ui";
import { suiteApp } from "@lumacast/suite";
import type {
  CloudDesktopAPI,
  InstallScope,
  SuiteOverview,
} from "../../shared/desktop-api";

interface SettingsScreenProps {
  overview: SuiteOverview;
  api: CloudDesktopAPI;
}

export function SettingsScreen({ overview, api }: SettingsScreenProps) {
  const { settings, host } = overview;
  const systemScopeDisabled =
    host.platform === "win32" && !host.systemScopeWritable;

  return (
    <div className="flex flex-col gap-8">
      <Title.h4>Settings</Title.h4>

      <section className="flex flex-col gap-3">
        <Title.h6>Install location</Title.h6>
        <SegmentedControl
          value={settings.installScope}
          onValueChange={(value) => {
            void api.updateSettings({ installScope: value as InstallScope });
          }}
        >
          <SegmentedControl.Label value="user">For me</SegmentedControl.Label>
          <SegmentedControl.Label value="system" disabled={systemScopeDisabled}>
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
          onCheckedChange={(checked) => {
            void api.updateSettings({ checkOnLaunch: checked });
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
              <Panel
                key={grant.app}
                variant="raised"
                density="compact"
                className="h-auto"
              >
                <Panel.Header divided={false}>
                  <Panel.HeaderTitle>
                    {suiteApp(grant.app).productName}
                  </Panel.HeaderTitle>
                  <Panel.HeaderActions>
                    <ReacstButton
                      variant="ghost"
                      onClick={() => {
                        void api.revoke(grant.app);
                      }}
                    >
                      Revoke
                    </ReacstButton>
                  </Panel.HeaderActions>
                </Panel.Header>
                <Panel.Body
                  scroll={false}
                  padded
                  className="pt-0 paragraph-xs text-tertiary"
                >
                  {grant.bundleId}
                </Panel.Body>
              </Panel>
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
