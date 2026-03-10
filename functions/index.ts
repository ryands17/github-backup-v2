import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Octokit } from '@octokit/rest';
import { Console, Effect, pipe, Stream } from 'effect';
import { Resource } from 'sst';
import { GitHubFetchError, S3UploadError, SecretNotFoundError } from './errors';

const ssm = new SSMClient();
const s3 = new S3Client();

export const handler = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Console.info('Fetching token from SSM');
      const token = yield* getSecret();
      yield* Console.info('Token is valid. Starting to download repos');

      yield* downloadRepos(token);
      yield* Console.info('Finished downloading repos');
    }),
  );

function downloadRepos(
  token: string,
): Effect.Effect<void, GitHubFetchError | S3UploadError> {
  const PER_PAGE = 20;
  const owner = 'ryands17';
  const gh = new Octokit({ auth: token });

  return Effect.gen(function* () {
    const iterator = gh.paginate.iterator(gh.repos.listForAuthenticatedUser, {
      visibility: 'all',
      affiliation: 'owner',
      per_page: PER_PAGE,
    });

    const stream = Stream.fromAsyncIterable(
      iterator,
      (error) => new GitHubFetchError({ message: String(error) }),
    );

    yield* Stream.runForEach(stream, (page) =>
      Effect.forEach(
        page.data.map((r) => ({ name: r.name, ref: r.default_branch })),
        (repo) => downloadRepo(gh, owner, repo),
        { concurrency: 4 },
      ),
    );
  });
}

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
  return Effect.gen(function* () {
    const { Parameter } = yield* Effect.tryPromise({
      try: () =>
        ssm.send(
          new GetParameterCommand({
            Name: Resource.githubToken.name,
            WithDecryption: true,
          }),
        ),
      catch: (error) => new SecretNotFoundError({ message: String(error) }),
    });

    if (!Parameter?.Value) {
      return yield* Effect.fail(
        new SecretNotFoundError({
          message: `Parameter ${Resource.githubToken.name} not found`,
        }),
      );
    }

    return Parameter.Value;
  });
}
