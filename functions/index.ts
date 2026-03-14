import { Octokit } from '@octokit/rest';
import { Console, Effect, pipe, Stream } from 'effect';
import { Resource } from 'sst';
import { GitHubFetchError, S3UploadError } from './errors';
import * as services from './services';

export const handler = async () => {
  const program = Effect.gen(function* () {
    yield* Console.info('Fetching token from SSM');

    const parameterService = yield* services.ParameterService;
    const token = yield* parameterService.getParameter(
      Resource.githubToken.name,
    );
    yield* Console.info('Token is valid. Starting to download repos');

    yield* downloadAndStoreUserRepositories(token);
    yield* Console.info('Finished downloading repos');
  });

  await Effect.runPromise(Effect.provide(program, services.Layers));
};

function downloadAndStoreUserRepositories(
  token: string,
): Effect.Effect<
  void,
  GitHubFetchError | S3UploadError,
  services.StorageService
> {
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

    const storageService = yield* services.StorageService;

    yield* Stream.runForEach(stream, (page) =>
      Effect.forEach(
        page.data.map((r) => ({ name: r.name, ref: r.default_branch })),
        (repo) =>
          pipe(
            downloadUserRepository(gh, owner, repo),
            Effect.tap(() =>
              Console.info(
                `Downloaded repo: ${repo.name}, now uploading to storage`,
              ),
            ),
            Effect.flatMap((data) =>
              storageService.uploadRepo(repo.name, data),
            ),
          ),
        { concurrency: 4 },
      ),
    );
  });
}

function downloadUserRepository(
  gh: Octokit,
  owner: string,
  repo: { name: string; ref: string },
): Effect.Effect<any, GitHubFetchError, never> {
  return Effect.tryPromise({
    try: async () => {
      const archive = await gh.repos.downloadTarballArchive({
        owner,
        repo: repo.name,
        ref: repo.ref,
      });

      return archive.data;
    },
    catch: (error) => new GitHubFetchError({ message: String(error) }),
  });
}
