import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import authRoutes from './src/server/routes/auth.ts';
import adminRoutes from './src/server/routes/admin.ts';
import recruitmentRoutes from './src/server/routes/recruitment.ts';
import onboardingRoutes from './src/server/routes/onboarding.ts';
import analyticsRoutes from './src/server/routes/analytics.ts';
import { csrfGuard } from './src/server/middleware.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrapServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers (relaxed CSP in dev for Vite inline module scripts)
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com'],
              imgSrc: ["'self'", 'data:', 'blob:'],
              connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'],
              frameSrc: ["'self'", 'https://*.firebaseapp.com'],
            },
          }
        : false,
      xFrameOptions: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Health probe
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: '9hr-india-portal', timestamp: new Date().toISOString() });
  });

  // CSRF protection for browser API mutations (skip multipart file upload check before multer or require X-Requested-With)
  app.use('/api', (req, res, next) => {
    // Allow public onboarding GET/POST/PUT with X-Requested-With or multipart
    if (req.path.startsWith('/documents/') && req.method === 'GET') {
      return next();
    }
    return csrfGuard(req, res, next);
  });

  // Mount API modules
  app.use('/api/auth', authRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', recruitmentRoutes);
  app.use('/api', onboardingRoutes);
  app.use('/api', analyticsRoutes);

  // Global API error handler
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled API Error:', err);
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Uploaded file exceeds the 10 MB security limit.' });
    }
    res.status(err?.status || 500).json({ error: err?.message || 'Internal server error.' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`9HR India Enterprise Portal listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrapServer().catch((err) => {
  console.error('Fatal server bootstrap error:', err);
  process.exit(1);
});
