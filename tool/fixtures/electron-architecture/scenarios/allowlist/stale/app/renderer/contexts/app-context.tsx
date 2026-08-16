import { recordObsEvent } from '../features/observability/metrics-store';

export function AppContext(): JSX.Element {
  recordObsEvent('mount');
  return null;
}