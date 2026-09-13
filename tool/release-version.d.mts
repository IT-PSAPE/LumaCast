export interface StableReleaseInput {
  eventName: string;
  currentVersion: string;
  previousVersion?: string;
  tagExists: boolean;
}

export interface StableReleaseDecision {
  shouldRelease: boolean;
  reason:
    | 'tag-exists'
    | 'manual-unpublished-version'
    | 'unsupported-event'
    | 'initial-unpublished-version'
    | 'version-unchanged'
    | 'version-increased';
}

export function decideStableRelease(input: StableReleaseInput): StableReleaseDecision;
