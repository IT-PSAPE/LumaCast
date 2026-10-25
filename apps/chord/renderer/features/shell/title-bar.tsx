// The custom window title bar: app name at the start (brand left, modes centre, actions right), plus (off
// macOS) a menu button. macOS keeps its real menu bar; Windows/Linux have none
// once the native title bar is hidden, so the button pops the same native
// application menu (File/Edit/Timeline/View/Window/Help) under itself.
import { Menu } from 'lucide-react';
import { detectWindowChromePlatform, ReacstButton, WindowChrome } from '@lumacast/ui';
import { getApi } from '../../api';

export function TitleBar() {
  const platform = detectWindowChromePlatform();

  return (
    <WindowChrome platform={platform}>
      <WindowChrome.Start>
        {platform !== 'darwin' ? (
          <ReacstButton.Icon
            label="Menu"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              void getApi().showApplicationMenu(rect.left, rect.bottom);
            }}
          >
            <Menu size={16} />
          </ReacstButton.Icon>
        ) : null}
        <WindowChrome.Title>LumaChord</WindowChrome.Title>
      </WindowChrome.Start>
    </WindowChrome>
  );
}
