const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, '..', '..')
  },
  experimental: {
    useTypeScriptCli: true
  }
}

module.exports = nextConfig
