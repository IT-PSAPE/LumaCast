/**
 * Starts the persistence-backed parts of the shell without waiting for the
 * utility process to finish migrations. The proxy owns its pre-ready FIFO.
 */
export function startPersistenceShell<Service>(options: {
  createService: () => Service;
  registerHandlers: (service: Service) => void;
  createWindow: () => void;
}): Service {
  const service = options.createService();
  options.registerHandlers(service);
  options.createWindow();
  return service;
}
