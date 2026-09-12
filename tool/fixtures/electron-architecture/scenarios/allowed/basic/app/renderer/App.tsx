import { DeckEditorScreen } from './screens/deck-editor/page';
import { AppContext } from './contexts/app-context';

export function App(): JSX.Element {
  return <AppContext><DeckEditorScreen /></AppContext>;
}