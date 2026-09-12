import { utilityProcess, type UtilityProcess } from 'electron';
import type { PersistenceHostCommand, PersistenceHostEvent } from './persistence-protocol';
import type { PersistenceHostTransport } from './persistence-service-proxy';

export function forkPersistenceHost(hostModulePath: string): PersistenceHostTransport {
  const host = utilityProcess.fork(hostModulePath, [], {
    serviceName: 'persistence-host',
    stdio: 'pipe',
  });
  host.stdout?.on('data', (chunk: Buffer | string) => {
    process.stdout.write(`[persistence-host] ${String(chunk)}`);
  });
  host.stderr?.on('data', (chunk: Buffer | string) => {
    process.stderr.write(`[persistence-host] ${String(chunk)}`);
  });
  return new ElectronUtilityProcessTransport(host);
}

class ElectronUtilityProcessTransport implements PersistenceHostTransport {
  constructor(private readonly host: UtilityProcess) {}

  postMessage(command: PersistenceHostCommand): void {
    this.host.postMessage(command);
  }

  onMessage(listener: (event: PersistenceHostEvent) => void): () => void {
    const wrapped = (event: PersistenceHostEvent) => listener(event);
    this.host.on('message', wrapped);
    return () => this.host.off('message', wrapped);
  }

  onExit(listener: (code: number | null) => void): () => void {
    const wrapped = (code: number) => listener(code);
    this.host.on('exit', wrapped);
    return () => this.host.off('exit', wrapped);
  }

  kill(): void {
    this.host.kill();
  }
}
