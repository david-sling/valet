import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import rehypeSlug from 'rehype-slug'
import rehypeShiki from '@shikijs/rehype'

const docs = mdx({
  remarkPlugins: [remarkGfm, remarkFrontmatter, [remarkMdxFrontmatter, { name: 'frontmatter' }]],
  rehypePlugins: [rehypeSlug, [rehypeShiki, { theme: 'github-light' }]],
})

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  nitro: {
    vercel: {
      functions: { maxDuration: 60 },
      config: { version: 3, crons: [{ path: '/api/cron/sweep', schedule: '0 4 * * *' }] },
    },
  },
  plugins: [
    devtools(),
    {
      ...docs,
      enforce: 'pre',
      transform(code: string, id: string) {
        return id.includes('?raw') ? null : docs.transform.call(this, code, id)
      },
    } as Plugin,
    tanstackStart(),
    nitro(),
    viteReact({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
  ],
})

export default config
