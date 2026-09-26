// The one gate every install/update/downgrade/uninstall/launch request passes
// through before it reaches the platform adapter. Cloud's own identity is
// never gated this way — it self-updates and is never installed/uninstalled
// through the suite flow — so `assertManaged` throws for it unconditionally,
// ahead of (and independent of) the grant check.
import type { SuiteAppId } from '@lumacast/suite';
import { suiteApp } from '@lumacast/suite';
import type { CloudSettings } from '../../shared/desktop-api';

export class PermissionError extends Error {
  constructor(
    readonly app: SuiteAppId,
    message: string,
  ) {
    super(message);
    this.name = 'PermissionError';
  }
}

/** Throws when `app` is Cloud's own identity: it has no grant to check. */
export function assertManaged(app: SuiteAppId): void {
  if (app === 'cloud') {
    throw new PermissionError(app, 'LumaCloud cannot install, update, or uninstall itself');
  }
}

/** Throws unless the user has explicitly granted Cloud permission for `app`. */
export function assertGranted(settings: CloudSettings, app: SuiteAppId): void {
  assertManaged(app);
  if (!settings.grants.some((grant) => grant.app === app)) {
    throw new PermissionError(app, `${suiteApp(app).productName} is not authorised in LumaCloud`);
  }
}
