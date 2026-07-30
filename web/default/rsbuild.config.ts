import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { tanstackRouter } from '@tanstack/router-plugin/rspack'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** `ANALYZE=1 bun run build` → dist/stats.json, consumed by scripts/analyze-bundle.mjs. */
const bundleStatsPlugin = {
  apply(compiler: {
    hooks: {
      done: { tap: (name: string, fn: (stats: unknown) => void) => void }
    }
  }) {
    compiler.hooks.done.tap('boxai-bundle-stats', (stats) => {
      const json = (
        stats as { toJson: (opts: Record<string, boolean>) => unknown }
      ).toJson({
        assets: true,
        chunks: true,
        chunkModules: true,
        modules: true,
        // Import graphs blow the JSON string length limit, so tracing "why is
        // this module here?" is opt-in via ANALYZE_REASONS=1.
        reasons: Boolean(process.env.ANALYZE_REASONS),
        source: false,
      })
      const out = path.resolve(__dirname, 'dist/stats.json')
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, JSON.stringify(json))
    })
  },
}

function stripSecureCookieFlag(proxyRes: {
  headers: Record<string, string | string[] | undefined>
}) {
  const raw = proxyRes.headers['set-cookie']
  if (!raw) return
  const list = Array.isArray(raw) ? raw : [raw]
  proxyRes.headers['set-cookie'] = list.map((c) =>
    c
      .replaceAll(/;\s*Secure/gi, '')
      .replaceAll(/;\s*Domain=[^;]*/gi, '')
      .replaceAll(/;\s*SameSite=None/gi, '; SameSite=Lax')
  )
}

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  // Local frontend → production (or local) API. Override with VITE_REACT_APP_SERVER_URL.
  const serverUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    'https://you-box.com'

  const isProd = envMode === 'production'
  const isRemoteApi = !/localhost|127\.0\.0\.1/.test(serverUrl)
  const devProxy = Object.fromEntries(
    (['/api', '/mj', '/pg'] as const).map((key) => [
      key,
      {
        target: serverUrl,
        changeOrigin: true,
        secure: true,
        // So session cookies from the production API work on http://localhost:5173
        ...(isRemoteApi
          ? {
              cookieDomainRewrite: 'localhost',
              onProxyRes: stripSecureCookieFlag,
            }
          : {}),
      },
    ])
  ) as Record<
    string,
    {
      target: string
      changeOrigin: boolean
      secure?: boolean
      cookieDomainRewrite?: string
      onProxyRes?: typeof stripSecureCookieFlag
    }
  >

  return {
    plugins: [pluginReact(), pluginTailwindcss({ optimize: false })],
    // Rsbuild 2: replaces deprecated `performance.chunkSplit` (RSPack 2 aligned)
    splitChunks: {
      preset: 'default',
      cacheGroups: {
        // `chunks: 'initial'` is load-bearing: with 'all' these groups also
        // absorb the copies of a package that only route chunks import, and a
        // group referenced by the entry becomes an initial chunk, so the public
        // pages ended up downloading every console-only primitive up front.
        'vendor-tanstack': {
          test: /node_modules[\\/]@tanstack[\\/]/,
          name: 'vendor-tanstack',
          chunks: 'initial',
          priority: 0,
          enforce: true,
        },
        'vendor-ui-primitives': {
          test: /node_modules[\\/](@base-ui|@radix-ui)[\\/]/,
          name: 'vendor-ui-primitives',
          chunks: 'initial',
          priority: 0,
          enforce: true,
        },
      },
    },
    source: {
      entry: {
        index: './src/main.tsx',
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    html: {
      template: './index.html',
    },
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy: devProxy,
    },
    output: {
      // Production optimizations
      minify: isProd,
      target: 'web',
      distPath: {
        root: 'dist',
      },
      // Rely on Rsbuild default legalComments ("linked" → per-chunk *.LICENSE.txt) in all modes.
      // Do not set "none" in production: that strips minifier-preserved third-party notices and
      // extracted license files, which some distributions require for open-source compliance.
    },
    performance: {
      // Remove console in production
      removeConsole: isProd ? ['log'] : false,
      buildCache: false,
    },
    tools: {
      rspack: {
        plugins: [
          tanstackRouter({
            target: 'react',
            // Dev: avoid per-route async chunks (reduces white flash on navigation + faster HMR feedback).
            // Prod: keep route-based code splitting.
            autoCodeSplitting: isProd,
          }),
          ...(process.env.ANALYZE ? [bundleStatsPlugin] : []),
        ],
      },
    },
  }
})
