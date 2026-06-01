import express from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// POST /api/register  {email, display_name}
router.post('/register', (req,res)=>{
  const { email, display_name } = req.body;
  if(!email) return res.status(400).json({ error:'email required' });
  // Stub: create user in DB (omitted) and return token
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

// POST /api/login {email}
router.post('/login', (req,res)=>{
  const { email } = req.body;
  if(!email) return res.status(400).json({ error:'email required' });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

export default router;
