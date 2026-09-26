import { ShowScreenProvider } from './screen-context';
import { ShowScreenContent } from './screen-content';

export function ShowScreen() {
  return (
    <ShowScreenProvider>
      <ShowScreenContent />
    </ShowScreenProvider>
  );
}
