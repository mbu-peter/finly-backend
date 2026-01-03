import express from 'express';
import OpenAI from 'openai';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import User from '../models/User.js';
import axios from 'axios';

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key'
});

/**
 * @route POST /api/agent/insights
 * @desc Get AI-driven market and portfolio insights
 */
router.post('/insights', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Fetch latest market data for context
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

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful financial assistant. Return raw JSON only." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const text = completion.choices[0].message.content || '{}';
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

/**
 * @route POST /api/agent/chat
 * @desc General chat with the ChartAgent
 */
router.post('/chat', authMiddleware, async (req: AuthRequest, res) => {
  const { message, history } = req.body;

  try {
    const messages: any[] = [
      { role: "system", content: "You are 'Vibe', the advanced AI assistant for the Finly platform. You are helpful, witty, and an expert in crypto and personal finance. Keep answers short and impactful." }
    ];

    if (history && Array.isArray(history)) {
      history.forEach((msg: any) => {
        messages.push({
          role: msg.role === 'model' ? 'assistant' : 'user',
          content: msg.parts[0].text
        });
      });
    }

    messages.push({ role: "user", content: message });

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
    });

    const reply = completion.choices[0].message.content;
    res.json({ response: reply });
  } catch (error: any) {
    console.error('AI Chat error:', error);
    res.status(500).json({ message: 'Failed to chat with AI', error: error.message });
  }
});

export default router;
