import { CastRepository } from '@lumacast/persistence-sqlite';
import { PersistenceHostDispatcher, type PersistenceRepository } from './persistence-host-dispatcher';
import type { PersistenceHostCommand } from './persistence-protocol';

const parentPort = process.parentPort;
if (!parentPort) {
  throw new Error('persistence-host must run as an Electron utility process (process.parentPort is null)');
}

const dispatcher = new PersistenceHostDispatcher({
  createRepository: (options, onProgress) => {
    const repository = new CastRepository({ ...options, onProgress });
    return {
      repository: repository as unknown as PersistenceRepository,
      close: () => repository.close(),
    };
  },
  emit: (event) => parentPort.postMessage(event),
});

parentPort.on('message', (event: { data: PersistenceHostCommand }) => {
  dispatcher.accept(event.data);
});
