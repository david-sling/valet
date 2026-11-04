import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'

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
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
})

export default config
