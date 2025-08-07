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

    const githubToken = new aws.ssm.Parameter('githubBackupToken', {
      name: '/gh-backup/token',
      description: 'Token for backing up GitHub repos',
      value: 'temp-value',
      type: 'SecureString',
    });

    const githubTokenLink = new sst.Linkable('githubTokenLink', {
      properties: { name: githubToken.name },
    });

    new sst.aws.Cron('saveRepos', {
      function: {
        handler: 'functions/index.handler',
        memory: '1792 MB',
        timeout: '15 minutes',
        link: [githubReposBucket, githubTokenLink],
        permissions: [
          {
            actions: ['ssm:GetParameter'],
            resources: [githubToken.arn],
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
