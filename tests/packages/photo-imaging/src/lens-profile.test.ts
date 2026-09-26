// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { matchLensProfile } from '../../../../packages/photo-imaging/src/lens-profiles';
import { correctProfile } from '../../../../packages/photo-imaging/src/profile-render';
import { recipeSchema } from '../../../../packages/photo-model/src/model';

const metadata = {
  Camera: 'Canon Canon EOS 5D Mark II',
  Lens: 'Canon EF 50mm f/1.8 II',
  'Focal length': '50 mm',
  Aperture: 'f/4',
};

describe('lens profile matching', () => {
  it('lens matching requires metadata and uses calibrated lens/camera, including JPEG EXIF', () => {
    expect(matchLensProfile({}).profile).toBeNull();
    expect(matchLensProfile({ ...metadata, Lens: 'Unknown 50mm' }).profile).toBeNull();
    const result = matchLensProfile(metadata);
    expect(result.profile, result.message).toBeTruthy();
    expect(result.profile!.name).toMatch(/50mm/);
    expect(result.profile!.cameraCrop).toBe(1);
    expect(
      recipeSchema.parse({ lensProfile: result.profile }).lensProfile?.id,
    ).toBe(result.profile!.id);
    expect(
      matchLensProfile({ ...metadata, 'Focal length': '500 mm' }).profile,
    ).toBeNull();
  });

  it('lens matching rejects unknown camera/missing focal rather than inferring equipment', () => {
    expect(
      matchLensProfile({ ...metadata, Camera: 'Unknown camera' }).profile,
    ).toBeNull();
    expect(matchLensProfile({ ...metadata, 'Focal length': '' }).profile).toBeNull();
    expect(recipeSchema.parse({}).lensProfile).toBeNull();
  });

  it('zoom correction interpolates within calibration range and changes for each focal length', () => {
    const base = {
      Camera: 'Canon EOS 7D',
      Lens: 'Canon EF-S 10-22mm f/3.5-4.5 USM',
    };
    const at = (n: number) =>
      matchLensProfile({ ...base, 'Focal length': `${n} mm` }).profile;
    const a = at(10)!,
      b = at(12)!,
      mid = at(11)!;
    expect(a && b && mid).toBeTruthy();
    expect(mid.cameraCrop).toBe(1.62);
    a.distortion!.terms.forEach((v, i) =>
      expect(
        Math.abs(mid.distortion!.terms[i] - (v + b.distortion!.terms[i]) / 2) < 1e-9,
      ).toBe(true),
    );
    expect(at(22)!.distortion).not.toEqual(a.distortion);
    expect(at(25)).toBeNull();
  });
});

describe('calibrated profile rendering', () => {
  it('calibrated identity preserves bytes; correction stays opaque and does not mutate source', () => {
    const data = Buffer.alloc(80 * 60 * 4, 255);
    for (let i = 0; i < data.length; i += 4) data[i] = ((i / 4) % 80) * 3;
    const profile = matchLensProfile(metadata).profile!;
    const original = Buffer.from(data);
    const out = correctProfile(data, 80, 60, profile);
    expect(data).toEqual(original);
    expect(out).not.toEqual(data);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    const identity = {
      ...profile,
      distortion: {
        model: 'poly3' as const,
        terms: [0, 0, 0] as [number, number, number],
      },
      tca: null,
      vignette: null,
    };
    expect(correctProfile(data, 80, 60, identity)).toEqual(data);
  });
});
