import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import User from '../models/User.js';
import axios from 'axios';

const router = express.Router();

// Initialize OpenAI client
let openai: any;
const initOpenAI = async () => {
  if (!openai) {
    try {
      const { OpenAI } = await import('openai');
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
    }
  }
  return openai;
};

router.post('/insights', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById((req.user as any).id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const openaiClient = await initOpenAI();
    if (!openaiClient) {
      return res.status(500).json({ message: 'AI service unavailable' });
    }

    const marketResponse = await axios.get(`${process.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/market/prices`);
    const marketData = marketResponse.data;

    const portfolio = user.portfolio || new Map();
    const portfolioSummary = Array.from(portfolio.entries())
      .map(([symbol, amount]) => `${amount} ${symbol.toUpperCase()}`)
      .join(', ');

    const prompt = `
      You are a professional financial AI assistant for the "Vibe" fintech platform.
      Current Market Data (Top Assets): ${JSON.stringify(marketData).slice(0, 1000)}
      User Portfolio: ${portfolioSummary || 'No crypto assets yet'}
      User Fiat Balance: $${user.fiatBalance || 0}

      Provide a concise 2-3 sentence financial insight or recommendation.
      Focus on recent trends or portfolio diversification.
      Be encouraging but professional.
      Format the response as a JSON object with 'insight' (string) and 'sentiment' (bullish, bearish, or neutral).
      Do not use markdown code blocks, just raw JSON.
    `;

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful financial assistant. Return raw JSON only." },
        { role: "user", content: prompt }
      ],
    });

    const text = completion.choices[0].message?.content || '{}';
    const content = JSON.parse(text);
    res.json(content);

  } catch (error: any) {
    console.error('AI Agent error:', error);
    res.json({
      insight: "Market volatility is high. Consider diversifying your portfolio.",
      sentiment: "neutral"
    });
  }
});

export default router;
