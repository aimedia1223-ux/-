import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { contentSecurityPolicy } from './securityPolicy'

// https://vite.dev/config/
export default defineConfig(({command,mode}) => {
const env = loadEnv(mode, process.cwd(), 'VITE_SUPABASE_URL');
const policy = contentSecurityPolicy(env.VITE_SUPABASE_URL || '', command === 'serve');
const revision = /^[a-f0-9]{40}$/i.test(process.env.VITE_BUILD_REVISION || '') ? process.env.VITE_BUILD_REVISION : 'local';
return {
  base: './',
  plugins: [react(), { name: 'connexy-browser-policy', transformIndexHtml: { order: 'pre', handler: () => [
    {tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:policy},injectTo:'head-prepend'},
  ] }, generateBundle() { this.emitFile({type:'asset',fileName:'review-build.json',source:JSON.stringify({purpose:'function-and-design-review',revision})}); } }],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        passwordReset: fileURLToPath(new URL('./reset-password.html', import.meta.url)),
      },
    },
  },
}})
