// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloudBuildEnv } from './build-cloud.mjs';

describe('cloud build isolation', () => {
  it('disables production storage, provider calls and workers without modifying its input', () => {
    const input = { DATABASE_URL: 'postgresql://test.invalid/app', RESEND_API_KEY: 'fake', GROQ_API_KEY: 'fake',
      RENDER: 'true', VERCEL: '1', MVP_FUNNEL_WORKER: 'on', MVP_DURABLE_RESEARCH: 'on',
      MVP_LOCAL_AUTO_ENABLE: 'approved-inbox', MVP_NEXT_DIST_DIR: '.next-discovery', DEMO_EMAIL_ENABLED: '1', PORT: '10000' };
    const result = cloudBuildEnv(input, '/app');
    expect(result).toMatchObject({ DATABASE_URL: '', RENDER: '', VERCEL: '', RESEND_API_KEY: '', GROQ_API_KEY: '',
      MVP_FUNNEL_WORKER: 'off', MVP_DURABLE_RESEARCH: 'off', MVP_SCHEDULER: 'off', MVP_OUTREACH_WORKER: 'off',
      MVP_LOCAL_AUTO_ENABLE: 'off', MVP_NEXT_DIST_DIR: '', DEMO_EMAIL_ENABLED: '0', PORT: '10000' });
    expect(result.MVP_DATA_DIR).toBe(path.join('/app', 'tmp/cloud-build-db'));
    expect(input.DEMO_EMAIL_ENABLED).toBe('1');
  });
});
