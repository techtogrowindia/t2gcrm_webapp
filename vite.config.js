import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Simple plugin to emulate Vercel serverless functions in Vite dev server
const vercelApiPlugin = () => ({
  name: 'vercel-api-dev',
  configureServer(server) {
    // 💡 Automated CRON Simulator
    // This runs the automation logic in the background every minute 
    // so you don't have to manually trigger the API or log in.
    let cronRunning = false;
    const runCron = async () => {
      if (cronRunning) return;
      cronRunning = true;
      try {
        const cronPath = path.join(__dirname, 'api/cron/process-automations.js');
        if (fs.existsSync(cronPath)) {
          const module = await import('file://' + cronPath.replace(/\\/g, '/') + '?t=' + Date.now());
          const handler = module.default;
          // Create minimal mock for req/res
          const mockReq = { env: process.env, method: 'POST' };
          const mockRes = { 
            status: () => ({ json: () => {}, end: () => {} }), 
            json: () => {}, 
            setHeader: () => {},
            end: () => {}
          };
          await handler(mockReq, mockRes);
        }
      } catch (e) {
        // Silently fail if DB is not ready during startup
        if (!String(e).includes('init')) {
          console.error('[CRON-SIMULATOR] Error:', e);
        }
      } finally {
        cronRunning = false;
      }
    };

    // Run every 60 seconds
    const cronInterval = setInterval(runCron, 60000);
    setTimeout(runCron, 2000); // Initial run after 2s

    // Auto-sync scheduler for integrations — runs every 5 minutes in dev
    let integrationsRunning = false;
    const runIntegrationsCron = async () => {
      if (integrationsRunning) return;
      integrationsRunning = true;
      try {
        const p = path.join(__dirname, 'api/cron/process-integrations.js');
        if (fs.existsSync(p)) {
          const module = await import('file://' + p.replace(/\\/g, '/') + '?t=' + Date.now());
          const mockReq = { env: process.env, method: 'POST', query: {}, body: {} };
          const mockRes = {
            setHeader: () => {},
            status: () => ({ json: () => {}, end: () => {} }),
            json: () => {},
            end: () => {},
          };
          await module.default(mockReq, mockRes);
        }
      } catch (e) {
        if (!String(e).includes('init')) {
          console.error('[INTEGRATIONS-CRON] Error:', e?.message || e);
        }
      } finally {
        integrationsRunning = false;
      }
    };
    const integrationsInterval = setInterval(runIntegrationsCron, 5 * 60 * 1000);
    setTimeout(runIntegrationsCron, 10 * 1000);

    server.httpServer?.on('close', () => {
      clearInterval(cronInterval);
      clearInterval(integrationsInterval);
    });

    server.middlewares.use(async (req, res, next) => {
      if (req.url.startsWith('/api')) {
        try {
          const [urlPath] = req.url.split('?')
          let filePath = path.join(__dirname, urlPath + '.js')
          if (!fs.existsSync(filePath)) {
            filePath = path.join(__dirname, urlPath, 'index.js')
          }
          if (fs.existsSync(filePath)) {
            // Read body
            let bodyStr = ''
            req.on('data', chunk => { bodyStr += chunk })
            await new Promise(resolve => req.on('end', resolve))
            
            try {
              req.body = bodyStr ? JSON.parse(bodyStr) : {}
            } catch (e) {
              req.body = {}
            }

            // Vercel function polyfills
            res.status = (code) => { res.statusCode = code; return res; }
            res.json = (data) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
            }
            // Pass the loaded dotenv vars down
            req.env = process.env;

            // Import handler dynamically (adding timestamp to bypass cache if it's changing)
            const module = await import('file://' + filePath.replace(/\\/g, '/') + '?t=' + Date.now())
            const handler = module.default
            await handler(req, res)
            return
          }
        } catch (err) {
          console.error('API Error:', err)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
          return
        }
      }
      next()
    })
  }
})

export default defineConfig({
  plugins: [react(), vercelApiPlugin()],
  build: {
    chunkSizeWarningLimit: 600
  }
})
