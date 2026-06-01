import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import moviesRouter from './routes/movies.js';
import recRouter from './routes/recommendations.js';
import authRouter from './routes/auth.js';

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static
app.use(express.static(path.join(__dirname, '../frontend')));

// API routes
app.use('/api', moviesRouter);
app.use('/api', recRouter);
app.use('/api', authRouter);

// SSE endpoint path is defined in recommendations router

const port = process.env.PORT || 3000;
app.listen(port, ()=>{
  console.log(`Express API listening on port ${port}`);
});
