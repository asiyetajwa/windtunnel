// Serves the app and the recorded run. No model is called here: the loop runs with `npm run rounds`, which
// writes data/run.json, and the browser re-simulates every scene from it.

import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8790);
const RUN = process.env.WINDTUNNEL_RUN ?? join(process.cwd(), 'data', 'run.json');

const app = express();
app.get('/api/run', (_req, res) => {
  if (!existsSync(RUN)) {
    res.status(404).json({ error: 'No recorded run yet: run `npm run rounds` first.' });
    return;
  }
  res.type('application/json').send(readFileSync(RUN, 'utf8'));
});
app.use(express.static(join(process.cwd(), 'dist')));
app.listen(PORT, '127.0.0.1', () => console.log(`Wind Tunnel: http://127.0.0.1:${String(PORT)}`));
