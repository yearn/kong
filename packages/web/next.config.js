/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the Sentry SDK out of the bundle; lib/sentry loads it lazily on first capture.
  serverExternalPackages: ['@sentry/node'],
  images: { unoptimized: true }
}

module.exports = nextConfig
