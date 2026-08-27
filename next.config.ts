import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Bundle examples/*.md into the serverless function output on Vercel.
  // fs.readFileSync paths built at runtime aren't statically traceable,
  // so we declare them explicitly. Cast bypasses missing type declarations.
  experimental: {
    outputFileTracingIncludes: {
      '/api/generate': ['./examples/**/*.md'],
      '/api/generate-cover': ['./examples/**/*.md'],
    },
  } as Record<string, unknown>,
}

export default nextConfig
