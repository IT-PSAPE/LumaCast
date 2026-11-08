const assert = require('node:assert/strict');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { setImmediate: nextTurn, setTimeout: delay } = require('node:timers/promises');

const addonPath = isMainThread ? process.argv[2] : workerData.addonPath;
const addon = require(addonPath);
const foreignOwner = /belongs to another JavaScript environment/;

async function until(predicate, message) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(2);
  }
}

function worker(action) {
  return new Worker(__filename, { workerData: { addonPath, action } });
}

function messageFrom(target) {
  return new Promise((resolve, reject) => {
    target.once('message', resolve);
    target.once('error', reject);
    target.once('exit', (code) => { if (code) reject(new Error(`Worker exited ${code}`)); });
  });
}

async function waitForDrain() {
  await until(() => addon.snapshot().liveStates === 0, 'Queued event state was not released');
}

async function runMain() {
  let passed = 0;
  async function check(name, body) {
    try { await body(); }
    finally { addon.mode(''); addon.blockDestroy(false); addon.stop(); }
    await waitForDrain();
    console.log(`PASS ${name}`);
    ++passed;
  }

  await check('results, packets, stop and reinitialize', async () => {
    const before = addon.snapshot();
    const events = [];
    assert.deepEqual(addon.initialize('client', (event) => events.push(event)), { ok: true, message: 'initialized' });
    assert.throws(() => addon.initialize('client', () => {}), /already initialized/);
    assert.deepEqual(addon.startMeeting('123', 'zak', 'user', 'name'), { ok: true, message: '123:zak:user:name' });
    assert.deepEqual(addon.startProductionStudio(4, 2), { ok: true, message: '4x2' });
    assert.deepEqual(addon.sendVideoFrame(Buffer.alloc(12), 4, 2), { ok: true, message: '12:4:2' });
    await until(() => events.length === 1, 'Authentication event was not delivered');
    assert.deepEqual(events, [{ state: 'authenticated', message: 'fake client' }]);
    addon.stop();
    addon.stop();
    await nextTurn();
    assert.equal(events.length, 1, 'Stop must close before the native stop event');
    assert.equal(addon.snapshot().destroyed - before.destroyed, 1);
    assert.equal(addon.snapshot().aborts - before.aborts, 1);
    assert.throws(() => addon.startProductionStudio(2, 2), /not initialized/);
    assert.equal(addon.initialize('again', () => {}).ok, true);
  });

  await check('failed creation and initialization release ownership', async () => {
    for (const mode of ['create-null', 'create-throw', 'initialize-fail', 'initialize-throw']) {
      const before = addon.snapshot();
      addon.mode(mode);
      let delivered = 0;
      if (mode === 'initialize-fail')
        assert.deepEqual(addon.initialize('client', () => ++delivered), { ok: false, message: 'fake initialize failure' });
      else assert.throws(() => addon.initialize('client', () => ++delivered), /platform Zoom SDK bridge|fake .* exception/);
      assert.equal(addon.snapshot().owned, false);
      assert.equal(addon.snapshot().created - before.created, mode.startsWith('initialize') ? 1 : 0);
      assert.equal(addon.snapshot().created - before.created, addon.snapshot().destroyed - before.destroyed);
      assert.equal(addon.snapshot().aborts - before.aborts, 1);
      await waitForDrain();
      assert.equal(delivered, 0);
      addon.mode('');
      assert.equal(addon.initialize('retry', () => {}).ok, true);
      addon.stop();
      await waitForDrain();
    }
  });

  await check('PCM channel frames and input boundaries', async () => {
    addon.initialize('client', () => {});
    for (const channels of [1, 2]) {
      for (const rate of [32000, 48000]) {
        assert.equal(addon.sendAudioFrame(Buffer.alloc(channels * 2), rate, channels).message, `${channels * 2}:${rate}:${channels}`);
        assert.equal(addon.sendAudioFrame(Buffer.alloc(channels * 8), rate, channels).ok, true);
        for (const size of [0, 1, 3, ...(channels === 2 ? [2, 6] : [])])
          assert.throws(() => addon.sendAudioFrame(Buffer.alloc(size), rate, channels), /complete 16-bit channel frames/);
      }
    }
    for (const rate of [0, -1, NaN, Infinity, 44100, 48000.5])
      assert.throws(() => addon.sendAudioFrame(Buffer.alloc(4), rate, 2), /32\/48 kHz/);
    for (const channels of [0, -1, 3, 1.5, NaN])
      assert.throws(() => addon.sendAudioFrame(Buffer.alloc(4), 48000, channels), /1 or 2 channels/);
    assert.throws(() => addon.sendVideoFrame(Buffer.alloc(11), 4, 2), /I420 frame length/);
    assert.throws(() => addon.sendVideoFrame(Buffer.alloc(0), 3, 2), /positive even dimensions/);
  });

  await check('foreign environment methods and cleanup preserve owner', async () => {
    addon.initialize('client', () => {});
    const before = addon.snapshot();
    const target = worker('foreign');
    assert.deepEqual(await messageFrom(target), { rejected: 6, registrations: 2 });
    await target.terminate();
    assert.equal(addon.snapshot().destroyed, before.destroyed);
    assert.equal(addon.snapshot().owned, true);
    assert.equal(addon.startProductionStudio(2, 2).ok, true);
    assert.equal(addon.snapshot().environments, 1);
  });

  await check('worker termination releases owner and queued events', async () => {
    const before = addon.snapshot();
    const target = worker('own');
    assert.equal(await messageFrom(target), 'ready');
    assert.throws(() => addon.stop(), foreignOwner);
    assert.throws(() => addon.initialize('foreign', () => {}), foreignOwner);
    await target.terminate();
    await waitForDrain();
    assert.equal(addon.snapshot().destroyed - before.destroyed, 1);
    assert.equal(addon.snapshot().aborts - before.aborts, 1);
    assert.equal(addon.snapshot().owned, false);
    assert.equal(addon.snapshot().environments, 1);
    addon.initialize('new-owner', () => {});
  });

  await check('ownership remains reserved throughout destruction', async () => {
    addon.blockDestroy(true);
    const target = worker('stop');
    assert.equal(await messageFrom(target), 'ready');
    target.postMessage('stop');
    try {
      await until(() => addon.snapshot().destroying, 'Worker did not enter bridge destruction');
      assert.throws(() => addon.initialize('foreign', () => {}), foreignOwner);
      assert.throws(() => addon.stop(), foreignOwner);
    } finally { addon.blockDestroy(false); }
    assert.equal(await messageFrom(target), 'stopped');
    await target.terminate();
    addon.initialize('replacement', () => {});
  });

  await check('callback stop and reinitialize discard the old queue', async () => {
    const events = [];
    addon.initialize('first', (event) => {
      events.push(event.message);
      addon.stop();
      addon.initialize('second', (next) => {
        events.push(next.message);
        addon.stop();
      });
    });
    addon.emit(1000);
    await until(() => events.length === 2, 'Reentrant replacement callback was not delivered');
    await waitForDrain();
    assert.deepEqual(events, ['fake first', 'fake second']);
  });

  await check('queue saturation, late emissions and null-env release', async () => {
    let delivered = 0;
    const before = addon.snapshot();
    addon.initialize('saturation', () => ++delivered);
    addon.emit(1000);
    const queued = addon.snapshot();
    assert.equal(queued.enqueued - before.enqueued, 128);
    assert.equal(queued.dropped - before.dropped, 873);
    addon.stop();
    addon.emit(1000);
    assert.equal(addon.snapshot().attempts, queued.attempts, 'Late SDK emissions must not enqueue');
    await waitForDrain();
    assert.equal(delivered, 0);
    assert.equal(addon.nullDeliveryReleases(), true);
    assert.equal(addon.snapshot().aborts - before.aborts, 1);
  });

  await check('runtime closing consumes the handle before stop or worker cleanup', async () => {
    let delivered = 0;
    addon.initialize('closing', () => ++delivered);
    const before = addon.snapshot();
    addon.forceClosing();
    addon.emit(3);
    const closed = addon.snapshot();
    assert.equal(closed.closing - before.closing, 1, 'Only the first emission may observe runtime closing');
    assert.equal(closed.attempts - before.attempts, 1, 'Later emissions must not use the consumed handle');
    addon.stop();
    assert.equal(addon.snapshot().aborts, before.aborts, 'Stop must not release a handle consumed by napi_closing');
    await waitForDrain();
    assert.equal(delivered, 0);

    const workerBefore = addon.snapshot();
    const target = worker('closing-owner');
    assert.equal(await messageFrom(target), 'ready');
    assert.equal(addon.snapshot().closing - workerBefore.closing, 1);
    await target.terminate();
    await waitForDrain();
    assert.equal(addon.snapshot().aborts, workerBefore.aborts, 'Environment cleanup must not release a consumed handle');
    assert.equal(addon.snapshot().destroyed - workerBefore.destroyed, 1);
    assert.equal(addon.snapshot().owned, false);
    addon.initialize('after-closing', () => {});
  });

  await check('concurrent emission closes safely and SDK exceptions unwind', async () => {
    let delivered = 0;
    addon.initialize('thread', () => ++delivered);
    addon.startMeeting('emit-thread', '', '', '');
    addon.stop();
    await waitForDrain();
    assert.equal(delivered, 0);
    addon.mode('stop-throw');
    addon.initialize('throw', () => {});
    assert.throws(() => addon.startMeeting('throw', '', '', ''), /fake meeting exception/);
    addon.stop();
    assert.equal(addon.snapshot().owned, false);
  });

  assert.equal(addon.snapshot().created, addon.snapshot().destroyed);
  assert.equal(addon.snapshot().lockedCalls, 0, 'An SDK call held the addon mutex');
  assert.equal(addon.snapshot().missingReservation, 0, 'An SDK call ran without singleton reservation');
  assert.equal(addon.snapshot().environments, 1);
  console.log(`PASS ${passed} native Zoom lifecycle scenarios (${process.versions.electron ? 'Electron' : 'Node'})`);
}

if (isMainThread) {
  runMain().catch((error) => {
    console.error(error);
    addon.blockDestroy(false);
    addon.stop();
    process.exitCode = 1;
  });
} else if (workerData.action === 'foreign') {
  const calls = [
    () => addon.initialize('foreign', () => {}),
    () => addon.startMeeting('', '', '', ''),
    () => addon.startProductionStudio(2, 2),
    () => addon.sendVideoFrame(Buffer.alloc(6), 2, 2),
    () => addon.sendAudioFrame(Buffer.alloc(4), 48000, 2),
    () => addon.stop(),
  ];
  for (const call of calls) assert.throws(call, foreignOwner);
  addon.registerAgain();
  parentPort.postMessage({ rejected: calls.length, registrations: addon.snapshot().environments });
  parentPort.on('message', () => {});
} else {
  addon.initialize('worker', () => {});
  addon.emit(1000);
  if (workerData.action === 'closing-owner') {
    addon.forceClosing();
    addon.emit(3);
  }
  parentPort.postMessage('ready');
  if (workerData.action === 'stop') {
    parentPort.on('message', () => {
      addon.stop();
      parentPort.postMessage('stopped');
    });
  } else {
    // Keep queued callbacks pending until Worker.terminate tears down the env.
    while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}
