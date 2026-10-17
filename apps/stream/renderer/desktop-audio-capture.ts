export function retainDesktopAudioTracks(stream: Pick<MediaStream, 'getAudioTracks' | 'getTracks'>): MediaStreamTrack[] {
  const audioTracks = stream.getAudioTracks();
  for (const track of stream.getTracks()) {
    if (track.kind === 'video') track.stop();
  }
  return audioTracks;
}
