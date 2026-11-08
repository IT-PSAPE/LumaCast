// Compile-only consumer examples, checked by the root tsc command. This
// function is never invoked and cannot send IPC or mutate a photo catalog.
import { expectTypeOf } from 'vitest';
import type { z } from 'zod';
import type { AppState, Photo, ExportJob } from '@lumacast/photo-model';
import type { PhotoService, ExportManager, exportSchema } from '@lumacast/photo-library';
import type { analyzePhoto, suggestAutoTone, matchLensProfile } from '@lumacast/photo-imaging';
import type { DesktopAPI } from '../../../../apps/flux/shared/desktop-api';
import type { FolderListing, PhotoCommandMap, PhotoCommandResult } from '../../../../apps/flux/shared/photo-command';

export function assertPhotoCommandContract(command: DesktopAPI['command'], readOrImport: 'get_photo' | 'import_photos') {
  expectTypeOf(command('get_app_state')).toEqualTypeOf<Promise<AppState>>();
  expectTypeOf(command('get_selection')).toEqualTypeOf<Promise<string[]>>();
  expectTypeOf(command('get_photo', { id: 'one' })).toEqualTypeOf<Promise<Photo>>();
  expectTypeOf(command('browse_folder', { path: '/photos' })).toEqualTypeOf<Promise<FolderListing>>();
  expectTypeOf(command('import_photos', { paths: ['/photos/one.jpg'] })).toEqualTypeOf<Promise<{
    imported: string[]; errors: { path: string; message: string }[];
  }>>();
  expectTypeOf(command('apply_edits', { id: 'one', expectedRevision: 0, patch: { exposure: 1 } }))
    .toEqualTypeOf<Promise<{ id: string; revision: number }[]>>();
  expectTypeOf(command('undo', { id: 'one', expectedRevision: 1 }))
    .toEqualTypeOf<Promise<{ id: string; revision: number }>>();
  expectTypeOf(command('set_selection', { ids: ['one'] })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(command('update_metadata', { id: 'one', favorite: true })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(command('relink', { id: 'one', path: '/photos/one.jpg' })).toEqualTypeOf<Promise<void>>();
  expectTypeOf(command('export_photos', { ids: ['one'], directory: '/exports' })).toEqualTypeOf<Promise<ExportJob>>();
  expectTypeOf(command('cancel_export_job', { id: 'export-one' })).toEqualTypeOf<Promise<ExportJob>>();

  // @ts-expect-error unknown command names cannot cross the renderer bridge
  command('erase_originals');
  // @ts-expect-error get_photo requires its argument
  command('get_photo');
  // @ts-expect-error state reads have no argument payload
  command('get_app_state', { ids: [] });
  // @ts-expect-error args cannot widen the name inferred from the first parameter
  command('get_photo', { paths: ['/photos'] });
  // @ts-expect-error a union command name cannot be paired with only one branch's payload
  command(readOrImport, { id: 'one' });
  // @ts-expect-error edits must name the revision they are based on
  command('apply_edits', { id: 'one', patch: { exposure: 1 } });
  // @ts-expect-error recipe patches reject unknown fields
  command('apply_edits', { id: 'one', expectedRevision: 0, patch: { eraseOriginal: true } });
  // @ts-expect-error auto edits also require the expected revision
  command('auto_adjust', { id: 'one' });
  // @ts-expect-error no-arg commands do not accept export options
  command('get_selection', { directory: '/exports' });
  // @ts-expect-error format defaults are optional; the destination is required
  command('export_photos', { ids: ['one'] });
  // @ts-expect-error unsupported export encodings fail at the shared contract
  command('export_photos', { ids: ['one'], directory: '/exports', format: 'tiff' });
  // @ts-expect-error metadata values retain their domain types
  command('update_photos_metadata', { ids: ['one'], favorite: 'yes' });
}

// The shared declarations must agree with real service/imaging outputs. These
// checks catch changes to a return shape without copying handler implementations.
expectTypeOf<PhotoCommandResult<'get_app_state'>>().toEqualTypeOf<ReturnType<PhotoService['state']>>();
expectTypeOf<PhotoCommandResult<'get_photo'>>().toEqualTypeOf<ReturnType<PhotoService['photo']>>();
expectTypeOf<PhotoCommandResult<'import_photos'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['importPaths']>>>();
expectTypeOf<PhotoCommandResult<'apply_edits'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['edit']>>>();
expectTypeOf<PhotoCommandResult<'reset_edits'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['edit']>>>();
expectTypeOf<PhotoCommandResult<'undo'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['history']>>>();
expectTypeOf<PhotoCommandResult<'set_selection'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['select']>>>();
expectTypeOf<PhotoCommandResult<'update_metadata'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['metadata']>>>();
expectTypeOf<PhotoCommandResult<'update_photos_metadata'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['metadataMany']>>>();
expectTypeOf<PhotoCommandResult<'remove_photos_from_library'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['removeFromLibrary']>>>();
expectTypeOf<PhotoCommandResult<'relink'>>().toEqualTypeOf<Awaited<ReturnType<PhotoService['relink']>>>();
expectTypeOf<PhotoCommandResult<'get_export_job'>>().toEqualTypeOf<ReturnType<ExportManager['get']>>();
expectTypeOf<PhotoCommandResult<'cancel_export_job'>>().toEqualTypeOf<ReturnType<ExportManager['cancel']>>();
expectTypeOf<PhotoCommandResult<'analyze_photo'>['analysis']>().toEqualTypeOf<Awaited<ReturnType<typeof analyzePhoto>>>();
expectTypeOf<Omit<PhotoCommandResult<'get_lens_match'>, 'applied'>>().toEqualTypeOf<ReturnType<typeof matchLensProfile>>();
expectTypeOf<Omit<PhotoCommandResult<'suggest_adjustments'>, 'id' | 'expectedRevision' | 'referenceId' | 'referenceRevision'>>()
  .toEqualTypeOf<Awaited<ReturnType<typeof suggestAutoTone>>>();
expectTypeOf<PhotoCommandMap['export_photos']['args']>().toMatchTypeOf<z.input<typeof exportSchema>>();
expectTypeOf<z.input<typeof exportSchema>>().toMatchTypeOf<PhotoCommandMap['export_photos']['args']>();
