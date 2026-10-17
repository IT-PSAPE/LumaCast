export function listenForMediaStreamEnd(stream: Pick<MediaStream, 'getTracks'>, listener: () => void): () => void {
  const tracks = stream.getTracks();
  let listening = true;
  const removeListeners = () => {
    if (!listening) return;
    listening = false;
    for (const track of tracks) track.removeEventListener('ended', onEnded);
  };
  const onEnded = () => {
    if (listening && tracks.length > 0 && tracks.every((track) => track.readyState === 'ended')) {
      removeListeners();
      listener();
    }
  };
  for (const track of tracks) track.addEventListener('ended', onEnded);
  return removeListeners;
}
