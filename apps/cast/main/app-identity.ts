export interface AppIdentity {
  name: string;
  id: string;
}

export function resolveAppIdentity(environment: Record<string, string | undefined>): AppIdentity {
  return {
    name: environment.MAIN_VITE_APP_NAME || 'LumaCast',
    id: environment.MAIN_VITE_APP_ID || 'com.lumacast.app',
  };
}
