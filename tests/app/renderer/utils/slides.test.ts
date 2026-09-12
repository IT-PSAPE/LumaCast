import { describe, expect, it } from 'vitest';
import { detectMediaFileType, typeFromFile } from '../../../../app/renderer/utils/slides';

describe('media file classification', () => {
  it.each([['photo.PNG', 'image'], ['track.MP3', 'audio'], ['clip.MOV', 'video']])('recognizes %s without a MIME type', (name, type) => {
    const file = new File(['data'], name);
    expect(detectMediaFileType(file)).toBe(type);
    expect(typeFromFile(file)).toBe(type);
  });
  it('excludes bundle and unknown extensions from media drop targets', () => {
    expect(detectMediaFileType(new File(['bundle'], 'project.cst'))).toBeNull();
    expect(detectMediaFileType(new File(['text'], 'notes.txt'))).toBeNull();
  });
});
