export function assertHostedStagingDatabaseUrl(connectionString: string): void {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.')
  const host = url.hostname.toLowerCase()
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host) || database === 'te_kaupapa_dev' || database === 'te_kaupapa_m2_test') {
    throw new Error('The staging bootstrap refuses local development and disposable test database targets.')
  }
}
