import { App } from 'aws-cdk-lib';
import { createStudyStacks } from '../src/stacks.js';

const app = new App();
const account = process.env.STUDY_AWS_ACCOUNT_ID;
const region = process.env.AWS_REGION ?? 'ap-northeast-2';
if (account !== undefined && !/^\d{12}$/.test(account)) {
  throw new Error('STUDY_AWS_ACCOUNT_ID must contain 12 digits when set');
}
if (region !== 'ap-northeast-2') throw new Error('This architecture targets ap-northeast-2');

// No account lookup or .env reading: synth also works without AWS credentials.
createStudyStacks(app, {
  env: { ...(account ? { account } : {}), region },
});
