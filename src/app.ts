import express from 'express';
import path from 'path';
import cors from 'cors';
import playerAuthRouter from './routes/player-auth';
import applicationsRouter from './routes/applications';
import curatorRouter from './routes/curator';
import moderatorAuthRouter from './routes/moderator-auth';
import moderatorPanelRouter from './routes/moderator-panel';
import internalRouter from './routes/internal';
import panelRouter from './routes/panel';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Railway запускает `node dist/index.js` из корня проекта (/app),
// поэтому process.cwd() === '/app' и public/ доступна как '/app/public/'.
// Для надёжности пробуем несколько вариантов.
function resolvePublicDir(): string {
  const candidates = [
    path.join(process.cwd(), 'public'),           // /app/public  (Railway, стандарт)
    path.join(process.cwd(), '..', 'public'),      // на случай запуска из dist/
    path.join(__dirname, '..', 'public'),          // dist/../public
    path.join(__dirname, 'public'),                // dist/public (маловероятно)
  ];
  const fs = require('fs');
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('[Static] public dir resolved to:', dir);
      return dir;
    }
  }
  // Фоллбек — Railway всегда монтирует в /app
  console.warn('[Static] Could not auto-detect public dir, falling back to /app/public');
  return path.join(process.cwd(), 'public');
}

const PUBLIC_DIR = resolvePublicDir();

app.use(express.static(PUBLIC_DIR));

// Отдельные страницы панелей (не в навигации — только по прямой ссылке)
app.get('/panel/mod', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'mod-panel.html'));
});
app.get('/panel/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-panel.html'));
});

// API роуты
app.use('/api', playerAuthRouter);
app.use('/api', applicationsRouter);
app.use('/api', curatorRouter);
app.use('/api', moderatorAuthRouter);
app.use('/api', moderatorPanelRouter);
app.use('/api', internalRouter);
app.use('/api', panelRouter);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

export default app;
