import { Data } from 'effect';

export class SecretNotFoundError extends Data.TaggedError(
  'SecretNotFoundError',
)<{
  message: string;
}> {}

export class GitHubFetchError extends Data.TaggedError('GitHubFetchError')<{
  message: string;
}> {}

export class S3UploadError extends Data.TaggedError('S3UploadError')<{
  message: string;
}> {}
