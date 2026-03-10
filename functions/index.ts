import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Octokit } from '@octokit/rest';
import { Console, Effect, pipe, Stream } from 'effect';
import { Resource } from 'sst';
import { GitHubFetchError, S3UploadError, SecretNotFoundError } from './errors';

const ssm = new SSMClient();
const s3 = new S3Client();

export async function handler() {
  console.info('Fetching token');

  await Effect.runPromise(
    pipe(
      getSecret(),
      Effect.tap(() =>
        Console.info('Token is valid. Starting to download repos'),
      ),
      Effect.andThen(downloadRepos),
      Effect.tap(() => Console.info('Finished downloading repos')),
    ),
  );
}

const PER_PAGE = 20;

function downloadRepo(
  gh: Octokit,
  owner: string,
  repo: { name: string; ref: string },
): Effect.Effect<void, GitHubFetchError | S3UploadError> {
  return pipe(
    Effect.tryPromise({
      try: () =>
        gh.repos.downloadTarballArchive({
          owner,
          repo: repo.name,
          ref: repo.ref,
        }),
      catch: (error) => new GitHubFetchError({ message: String(error) }),
    }),
    Effect.tap(() =>
      Console.info(`Downloaded repo: ${repo.name}, now uploading to S3`),
    ),
    Effect.andThen((archive) => uploadToS3(repo.name, archive.data)),
  );
}

function downloadRepos(
  token: string,
): Effect.Effect<void, GitHubFetchError | S3UploadError> {
  const owner = 'ryands17';
  const gh = new Octokit({ auth: token });

  const iterator = gh.paginate.iterator(gh.repos.listForAuthenticatedUser, {
    visibility: 'all',
    affiliation: 'owner',
    per_page: PER_PAGE,
  });

  return pipe(
    Stream.fromAsyncIterable(
      iterator,
      (error) => new GitHubFetchError({ message: String(error) }),
    ),
    Stream.runForEach((page) =>
      Effect.forEach(
        page.data.map((r) => ({ name: r.name, ref: r.default_branch })),
        (repo) => downloadRepo(gh, owner, repo),
        { concurrency: 4 },
      ),
    ),
  );
}

function uploadToS3(
  name: string,
  data: any,
): Effect.Effect<void, S3UploadError> {
  return pipe(
    Effect.tryPromise({
      try: () =>
        s3.send(
          new PutObjectCommand({
            Bucket: Resource.githubReposBucket.name,
            Key: `${name}.tar.gz`,
            Body: Buffer.from(data),
            StorageClass: 'ONEZONE_IA',
          }),
        ),
      catch: (error) => new S3UploadError({ message: String(error) }),
    }),
    Effect.asVoid,
  );
}

function getSecret(): Effect.Effect<string, SecretNotFoundError> {
  return pipe(
    Effect.tryPromise({
      try: () =>
        ssm.send(
          new GetParameterCommand({
            Name: Resource.githubToken.name,
            WithDecryption: true,
          }),
        ),
      catch: (error) => new SecretNotFoundError({ message: String(error) }),
    }),
    Effect.andThen(({ Parameter }) =>
      Parameter?.Value
        ? Effect.succeed(Parameter.Value)
        : Effect.fail(
            new SecretNotFoundError({
              message: `Parameter ${Resource.githubToken.name} not found`,
            }),
          ),
    ),
  );
}
