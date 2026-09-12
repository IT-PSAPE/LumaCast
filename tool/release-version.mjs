import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseStableVersion(version) {
  const match = STABLE_VERSION.exec(version);
  if (!match) {
    throw new Error(`Release version "${version}" must be a stable semantic version.`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * @param {{
 *   eventName: string;
 *   currentVersion: string;
 *   previousVersion?: string;
 *   tagExists: boolean;
 * }} input
 */
export function decideStableRelease(input) {
  const current = parseStableVersion(input.currentVersion);

  if (input.tagExists) {
    return { shouldRelease: false, reason: 'tag-exists' };
  }
  if (input.eventName === 'workflow_dispatch') {
    return { shouldRelease: true, reason: 'manual-unpublished-version' };
  }
  if (input.eventName !== 'push') {
    return { shouldRelease: false, reason: 'unsupported-event' };
  }
  if (!input.previousVersion) {
    return { shouldRelease: true, reason: 'initial-unpublished-version' };
  }

  const previous = parseStableVersion(input.previousVersion);
  const comparison = compareVersions(current, previous);
  if (comparison < 0) {
    throw new Error(`Release version ${input.currentVersion} must be greater than ${input.previousVersion}.`);
  }
  if (comparison === 0) {
    return { shouldRelease: false, reason: 'version-unchanged' };
  }
  return { shouldRelease: true, reason: 'version-increased' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const currentVersion = process.env.CURRENT_VERSION ?? '';
  const decision = decideStableRelease({
    eventName: process.env.GITHUB_EVENT_NAME ?? '',
    currentVersion,
    previousVersion: process.env.PREVIOUS_VERSION || undefined,
    tagExists: process.env.TAG_EXISTS === 'true',
  });

  process.stdout.write([
    `version=${currentVersion}`,
    `should_release=${decision.shouldRelease}`,
    `reason=${decision.reason}`,
    '',
  ].join('\n'));
}
