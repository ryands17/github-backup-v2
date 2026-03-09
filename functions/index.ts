import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Octokit } from '@octokit/rest';
import { Console, Effect, pipe } from 'effect';
import { Resource } from 'sst';
import { GitHubFetchError, S3UploadError, SecretNotFoundError } from './errors';

const ssm = new SSMClient();
const s3 = new S3Client();

export async function handler() {
  console.info('Fetching token');

  await Effect.runPromise(
    pipe(
      getSecret(),
      Effect.tap((token) => Console.info('Token is defined:', Boolean(token))),
      Effect.tap(() => Console.info('Starting to download repos')),
      Effect.andThen(downloadRepos),
    ),
  );

  console.info('Repos downloaded successfully');
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

  let page = 1;
  let hasMore = true;

  return Effect.whileLoop({
    while: () => hasMore,
    body: () =>
      pipe(
        Effect.tryPromise({
          try: () =>
            gh.repos.listForAuthenticatedUser({
              visibility: 'all',
              affiliation: 'owner',
              per_page: PER_PAGE,
              page,
            }),
          catch: (error) => new GitHubFetchError({ message: String(error) }),
        }),
        Effect.andThen((res) =>
          Effect.forEach(
            res.data.map((r) => ({ name: r.name, ref: r.default_branch })),
            (repo) => downloadRepo(gh, owner, repo),
            { concurrency: 4 },
          ),
        ),
        Effect.map((res) => res.length),
      ),
    step: (count) => {
      page += 1;
      hasMore = count === PER_PAGE;
    },
  });
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
              message: 'Parameter or value not found',
            }),
          ),
    ),
  );
}
