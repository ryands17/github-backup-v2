import { Resource } from 'sst';
import { Octokit } from '@octokit/rest';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import invariant from './utils';

const ssm = new SSMClient();
const s3 = new S3Client();

export async function handler() {
  console.info('fetching token');
  const token = await getSecret();
  console.info('fetched token');

  console.info('downloading repos');
  await downloadRepos(token);
  console.info('repos downloaded successfully');

  return 'backup successful!';
}

async function downloadRepos(token: string) {
  const owner = 'ryands17';
  const gh = new Octokit({ auth: token });

  for await (const res of gh.paginate.iterator(
    gh.repos.listForAuthenticatedUser,
    { visibility: 'all', affiliation: 'owner', per_page: 20 },
  )) {
    const repositoryNames = res.data.map((r) => ({
      name: r.name,
      ref: r.default_branch,
    }));

    await Promise.all(
      repositoryNames.map(async (repo) => {
        const archive = await gh.repos.downloadTarballArchive({
          repo: repo.name,
          owner,
          ref: repo.ref,
        });

        console.info(`Downloaded repo: ${repo.name}, now uploading to S3`);

        return uploadToS3(repo.name, archive.data as any);
      }),
    );
  }
}

function uploadToS3(name: string, data: any) {
  return s3.send(
    new PutObjectCommand({
      Bucket: Resource.githubReposBucket.name,
      Key: `${name}.tar.gz`,
      Body: Buffer.from(data),
      StorageClass: 'ONEZONE_IA',
    }),
  );
}

async function getSecret() {
  const { Parameter } = await ssm.send(
    new GetParameterCommand({
      Name: Resource.githubToken.name,
      WithDecryption: true,
    }),
  );

  invariant(!!Parameter);
  invariant(!!Parameter.Value);

  return Parameter.Value;
}
