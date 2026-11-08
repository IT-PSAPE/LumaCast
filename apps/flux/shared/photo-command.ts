import type {
  AppState,
  AutoToneSuggestion,
  EditRequest,
  ExportJob,
  ExportOptions,
  LensProfile,
  MetadataPatch,
  Photo,
  PhotoAnalysis,
} from '@lumacast/photo-model';

export interface FolderListing {
  path: string;
  parent: string;
  folders: { name: string; path: string }[];
  files: { name: string; path: string }[];
}

type PhotoId = { id: string };
type RevisionInput = PhotoId & { expectedRevision: number };
type RevisionResult = Pick<Photo, 'id' | 'revision'>;
type LensResult = { profile: LensProfile | null; message: string; warnings: string[]; applied: boolean };
type ToneResult = AutoToneSuggestion & {
  id: string;
  expectedRevision: number;
  referenceId: string | undefined;
  referenceRevision: number | undefined;
};
type Contract<Args, Result> = { args: Args; result: Result };

/** The desktop command contract. Runtime validation remains in Commands.run. */
export interface PhotoCommandMap {
  browse_folder: Contract<{ path: string }, FolderListing>;
  get_lens_match: Contract<PhotoId, LensResult>;
  auto_lens_correction: Contract<RevisionInput, LensResult>;
  analyze_photo: Contract<PhotoId, {
    id: string;
    revision: number;
    format: string;
    metadata: Photo['metadata'];
    analysis: PhotoAnalysis;
  }>;
  suggest_adjustments: Contract<PhotoId & { referenceId?: string }, ToneResult>;
  auto_adjust: Contract<RevisionInput & { referenceId?: string }, ToneResult>;
  get_app_state: Contract<undefined, AppState>;
  get_photo: Contract<PhotoId, Photo>;
  get_selection: Contract<undefined, string[]>;
  import_photos: Contract<{ paths: string[] }, {
    imported: string[];
    errors: { path: string; message: string }[];
  }>;
  set_selection: Contract<{ ids: string[] }, void>;
  remove_photos_from_library: Contract<{ ids: string[] }, string[]>;
  update_metadata: Contract<PhotoId & MetadataPatch, void>;
  update_photos_metadata: Contract<{ ids: string[] } & MetadataPatch, string[]>;
  apply_edits: Contract<EditRequest, RevisionResult[]>;
  apply_batch_edits: Contract<{ edits: EditRequest[] }, RevisionResult[]>;
  reset_edits: Contract<RevisionInput, RevisionResult[]>;
  undo: Contract<RevisionInput, RevisionResult>;
  redo: Contract<RevisionInput, RevisionResult>;
  relink: Contract<PhotoId & { path: string }, void>;
  // The runtime export schema defaults format, quality and suffix. The two
  // destination/selection fields remain required at the type boundary too.
  export_photos: Contract<Pick<ExportOptions, 'ids' | 'directory'> & Partial<Omit<ExportOptions, 'ids' | 'directory'>>, ExportJob>;
  get_export_job: Contract<PhotoId, ExportJob>;
  cancel_export_job: Contract<PhotoId, ExportJob>;
}

export type PhotoCommandName = keyof PhotoCommandMap;
export type PhotoCommandArgs<Name extends PhotoCommandName> = PhotoCommandMap[Name]['args'] extends undefined
  ? [args?: undefined]
  : [args: PhotoCommandMap[Name]['args']];
export type PhotoCommandResult<Name extends PhotoCommandName> = PhotoCommandMap[Name]['result'];
export type PhotoCommandRequest = {
  [Name in PhotoCommandName]: [name: Name, ...args: PhotoCommandArgs<Name>];
}[PhotoCommandName];
export type PhotoCommand = <Request extends PhotoCommandRequest>(
  ...request: Request
) => Promise<PhotoCommandResult<Request[0]>>;
