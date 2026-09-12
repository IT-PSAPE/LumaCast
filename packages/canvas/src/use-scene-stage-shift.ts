import { useEffect, useState } from 'react';

export function useSceneStageShift(editable: boolean): boolean {
  const [shiftPressed, setShiftPressed] = useState(false);

  useEffect(() => {
    if (!editable) {
      setShiftPressed(false);
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Shift') setShiftPressed(true);
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === 'Shift') setShiftPressed(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [editable]);

  return shiftPressed;
}
