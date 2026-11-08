// Exercise the actual patched public lifecycle methods with controlled owners.
// No PCM decode, app/audio fixture, hardware, real Input or filesystem I/O.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const packageDir = process.argv[2];
if (!packageDir || !path.isAbsolute(packageDir)) throw new Error('Explicit owned package directory required');
const {Conversion, ConversionCanceledError} = await import(pathToFileURL(path.join(packageDir, 'dist/modules/src/index.js')).href);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const observe = (promise) => Promise.resolve(promise).then(() => ({ok: true}), (reason) => ({ok: false, reason}));
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(String(reason)));
const cases = [];
for (const mode of ['metadata-failure', 'undefined-primary', 'start-failure', 'pump-failure', 'metadata-cancel', 'start-cancel', 'cancel-before-execute', 'done']) {
  const entered = deferred(), setup = deferred(), cleanup = deferred();
  const primary = mode === 'undefined-primary' ? undefined : new Error('original execution failure');
  const secondary = new Error('secondary writable cleanup failure');
  const counts = {starts: 0, pumps: 0, cancels: 0, borrowedDisposals: 0, added: 0, removed: 0};
  const output = {
    async start() {
      counts.starts++;
      if (mode === 'start-failure') throw primary;
      if (mode === 'start-cancel') { entered.resolve(); await setup.promise; }
    },
    async cancel() { counts.cancels++; await cleanup.promise; },
    async finalize() { throw new Error('Finalization is outside these failure controls'); },
  };
  const pump = {done: false, resolvers: null, start() { counts.pumps++; this.resolvers.reject(primary); }, wake() {}};
  const track = {
    async isLive() { return false; },
    async getDurationFromMetadata() {
      if (mode === 'metadata-cancel') { entered.resolve(); await setup.promise; }
      if (mode === 'metadata-failure' || mode === 'undefined-primary') throw primary;
      return 1;
    },
  };
  // Controlled suppliers enter the real prototype at setup/pump boundaries;
  // private fields are fixture scaffolding, never application compensation.
  const conversion = Object.assign(Object.create(Conversion.prototype), {
    _state: mode === 'done' ? 'done' : 'idle', _cancelPromise: null,
    _executed: false, _outputTrackIds: [], _trackPumps: [pump], _composable: false,
    _synchronizer: {declareTrack() {}, resolveAll() {}}, _maxTimestamps: new Map(),
    _startTimestamp: 0, _endTimestamp: Infinity, _computeProgress: false,
    isValid: true, utilizedTracks: [track], output, onProgress() {},
    input: {dispose() { counts.borrowedDisposals++; }},
  });
  const pause = new AbortController();
  const add = pause.signal.addEventListener.bind(pause.signal);
  const remove = pause.signal.removeEventListener.bind(pause.signal);
  pause.signal.addEventListener = (...args) => { counts.added++; return add(...args); };
  pause.signal.removeEventListener = (...args) => { counts.removed++; return remove(...args); };
  if (mode === 'done') {
    await conversion.cancel(); await conversion.execute({pauseSignal: pause.signal});
    assert.equal(counts.cancels, 0); assert.equal(counts.starts, 0); assert.equal(counts.added, 0);
    cases.push({mode, counts}); continue;
  }
  let execution, joins;
  if (mode === 'cancel-before-execute') {
    joins = [observe(conversion.cancel()), observe(conversion.cancel())];
    execution = observe(conversion.execute({pauseSignal: pause.signal}));
  } else {
    execution = observe(conversion.execute({pauseSignal: pause.signal}));
    if (mode === 'metadata-cancel' || mode === 'start-cancel') {
      await entered.promise;
      joins = [observe(conversion.cancel()), observe(conversion.cancel())];
      setup.resolve();
    }
  }
  let settled = false;
  execution.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, `${mode}: execution must join cleanup`);
  assert.equal(counts.cancels, 1);
  if (!joins) joins = [observe(conversion.cancel()), observe(conversion.cancel())];
  const cancellation = mode.endsWith('-cancel') || mode === 'cancel-before-execute';
  if (cancellation) cleanup.resolve(); else cleanup.reject(secondary);
  const result = await execution;
  const cancellations = await Promise.all(joins);
  assert.equal(result.ok, false);
  if (cancellation) assert(result.reason instanceof ConversionCanceledError);
  else assert.equal(result.reason, primary);
  for (const joined of cancellations) {
    assert.equal(joined.ok, cancellation);
    if (!cancellation) assert.equal(joined.reason, secondary);
  }
  const later = await observe(conversion.cancel());
  assert.equal(later.ok, cancellation);
  if (!cancellation) assert.equal(later.reason, secondary);
  assert.equal(counts.cancels, 1);
  assert.equal(counts.borrowedDisposals, 0);
  assert.equal(counts.added, counts.removed);
  assert.equal(counts.pumps, mode === 'pump-failure' ? 1 : 0);
  if (mode.startsWith('metadata') || mode === 'undefined-primary' || mode === 'cancel-before-execute') assert.equal(counts.starts, 0);
  cases.push({mode, counts});
}
await tick();
assert.deepEqual(unhandled, []);
console.log(JSON.stringify({cases, unhandled}));
