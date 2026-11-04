const url = process.env.TEST_REDIS_URL
if (url) {
  // the shared Redis holds Wave's live data; tests only ever run against a local one
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('TEST_REDIS_URL must be a local Redis')
  Object.assign(process.env, {
    STORAGE_REDIS_URL: url,
    REDIS_PREFIX: 'valettest',
    HOST: 'http://localhost:3000',
    CRON_SECRET: 'test-only-cron-secret',
  })
}
