/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'github-backup-v2',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: ['production'].includes(input?.stage),
      home: 'aws',
      providers: { aws: { region: 'eu-west-1' } },
    };
  },
  async run() {
    const githubReposBucket = new sst.aws.Bucket('githubReposBucket');

    const githubBackupToken = new aws.ssm.Parameter('githubBackupToken', {
      name: '/gh-backup/token',
      description: 'Token for backing up GitHub repos',
      value: 'temp-value',
      type: 'SecureString',
    });

    const githubToken = new sst.Linkable('githubToken', {
      properties: { name: githubBackupToken.name },
    });

    new sst.aws.Cron('saveRepos', {
      function: {
        handler: 'functions/index.handler',
        runtime: 'nodejs22.x',
        memory: '1792 MB',
        timeout: '15 minutes',
        link: [githubReposBucket, githubToken],
        permissions: [
          {
            actions: ['ssm:GetParameter'],
            resources: [githubBackupToken.arn],
          },
          {
            actions: ['ssm:DescribeParameters'],
            resources: ['*'],
          },
          {
            actions: ['kms:Decrypt'],
            resources: ['arn:aws:kms:eu-west-1:*:key/*'],
          },
        ],
      },
      schedule: 'rate(7 days)',
    });
  },
});
