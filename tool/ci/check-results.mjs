#!/usr/bin/env node

// Branch protection must require success from every selected app. A skipped
// app is valid only when the detector did not select it.
import { pathToFileURL } from 'node:url';

export function checkCiResults(needs) {
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('CI job results are missing.');
  }
  if (needs.detect?.result !== 'success') {
    throw new Error('Affected-app detection failed.');
  }

  let selected;
  try {
    selected = JSON.parse(needs.detect.outputs?.apps);
  } catch {
    throw new Error('Affected-app selection is not valid JSON.');
  }
  if (!Array.isArray(selected) || selected.some((app) => typeof app !== 'string' || !/^[a-z][a-z0-9-]*$/.test(app))) {
    throw new Error('Affected-app selection must be an array of application names.');
  }
  if (new Set(selected).size !== selected.length) {
    throw new Error('Affected-app selection contains duplicate applications.');
  }
  for (const app of selected) {
    if (app === 'detect' || !Object.hasOwn(needs, app)) {
      throw new Error(`Selected application '${app}' has no validation job result.`);
    }
    if (needs[app]?.result !== 'success') {
      throw new Error(`Selected application '${app}' validation ended with '${needs[app]?.result ?? 'missing'}'.`);
    }
  }
  for (const [name, job] of Object.entries(needs)) {
    if (name === 'detect') continue;
    if (job?.result !== 'success' && job?.result !== 'skipped') {
      throw new Error(`Application '${name}' validation ended with '${job?.result ?? 'missing'}'.`);
    }
  }
  return selected;
}

export function main(env = process.env) {
  try {
    const selected = checkCiResults(JSON.parse(env.CI_JOB_RESULTS ?? 'null'));
    process.stdout.write(`Validated selected apps: ${selected.join(', ') || 'none'}.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
