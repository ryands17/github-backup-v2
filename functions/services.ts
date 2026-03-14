import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Effect, Layer, ServiceMap } from 'effect';
import { Resource } from 'sst';
import { S3UploadError, SecretNotFoundError } from './errors';

export class StorageService extends ServiceMap.Service<
  StorageService,
  {
    readonly uploadRepo: (
      key: string,
      data: any,
    ) => Effect.Effect<void, S3UploadError, never>;
  }
>()('Storage') {}

const StorageServiceImpl = Layer.effect(
  StorageService,
  Effect.gen(function* () {
    const s3 = new S3Client();

    return {
      uploadRepo: (name, data) =>
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
    };
  }),
);

export class ParameterService extends ServiceMap.Service<
  ParameterService,
  {
    getParameter: (
      name: string,
    ) => Effect.Effect<string, SecretNotFoundError, never>;
  }
>()('Parameter') {}

const ParameterServiceImpl = Layer.effect(
  ParameterService,
  Effect.gen(function* () {
    const ssm = new SSMClient();

    return {
      getParameter: (name) =>
        Effect.gen(function* () {
          const { Parameter } = yield* Effect.tryPromise({
            try: () =>
              ssm.send(
                new GetParameterCommand({
                  Name: name,
                  WithDecryption: true,
                }),
              ),
            catch: (error) =>
              new SecretNotFoundError({ message: String(error) }),
          });

          if (!Parameter || !Parameter.Value) {
            throw new SecretNotFoundError({
              message: `Parameter ${name} not found`,
            });
          }

          return Parameter.Value;
        }),
    };
  }),
);

export const Layers = Layer.mergeAll(StorageServiceImpl, ParameterServiceImpl);
