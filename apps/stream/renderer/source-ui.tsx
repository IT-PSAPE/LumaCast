import { FileAudio, FileVideo, Globe, Grid2X2, Headphones, Image as ImageIcon, Layers2, Mic, Monitor, PanelsTopLeft, Type, Webcam } from 'lucide-react';
import type { MediaKind, SourceKind, StreamSource } from '../shared/desktop-api';

/** Icon shown for a source of the given kind in the sources dock, mixer, and source properties panel. */
export function sourceIcon(kind: SourceKind, mediaKind?: MediaKind) {
  if (kind === 'display') return <Monitor size={15} />;
  if (kind === 'window') return <Grid2X2 size={15} />;
  if (kind === 'camera') return <Webcam size={15} />;
  if (kind === 'microphone') return <Mic size={15} />;
  if (kind === 'desktop-audio' || kind === 'application-audio') return <Headphones size={15} />;
  if (kind === 'image') return <ImageIcon size={15} />;
  if (kind === 'slideshow') return <ImageIcon size={15} />;
  if (kind === 'media') return mediaKind === 'audio' ? <FileAudio size={15} /> : <FileVideo size={15} />;
  if (kind === 'browser') return <Globe size={15} />;
  if (kind === 'text') return <Type size={15} />;
  if (kind === 'scene') return <PanelsTopLeft size={15} />;
  return <Layers2 size={15} />;
}

export function supportsSourceTransform(source: StreamSource): boolean {
  return source.kind !== 'microphone' && source.kind !== 'desktop-audio' && source.kind !== 'application-audio' && !(source.kind === 'media' && source.mediaKind === 'audio');
}
