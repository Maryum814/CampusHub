import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Lazy-loaded Gemini client
let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
      throw new Error(
        'GEMINI_API_KEY is not configured or is empty. Please set it in Settings > Secrets in AI Studio.'
      );
    }
    geminiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// 1. AI Summarize Endpoint
app.post('/api/ai/summarize', async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No content provided for summarization.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `You are an expert academic tutor. Please summarize the following study notes/content for a student. 
Title of material: ${title || 'Untitled Notes'}

Provide:
1. A brief high-level overview.
2. A detailed bulleted list of the core concepts.
3. 3-5 key takeaways/formulas/definitions.
4. Highlighted key points or advice for studying this material.

Content to summarize:
${text}`,
    });

    res.json({ summary: response.text });
  } catch (error: any) {
    console.error('Error in /api/ai/summarize:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during summarization.',
      isConfigError: error.message?.includes('GEMINI_API_KEY'),
    });
  }
});

// 2. AI Quiz/MCQ Generation Endpoint
app.post('/api/ai/quiz', async (req, res) => {
  try {
    const { text, title, count = 5 } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No content provided for generating quiz.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Generate a multiple-choice quiz with exactly ${count} questions based on the following academic text.
Title of material: ${title || 'Untitled'}

For each question, provide:
- The question text
- 4 options (A, B, C, D)
- The correct option letter (A, B, C, or D)
- A brief explanation of the correct answer.

Generate the response in strict JSON format.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'A list of multiple choice questions',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.NUMBER, description: 'Question index starting at 1' },
              question: { type: Type.STRING, description: 'The question text' },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Exactly 4 option strings corresponding to A, B, C, D'
              },
              correctAnswer: { type: Type.STRING, description: 'The correct letter choice: A, B, C, or D' },
              explanation: { type: Type.STRING, description: 'Explanation for why this is the correct answer' }
            },
            required: ['id', 'question', 'options', 'correctAnswer', 'explanation']
          }
        }
      }
    });

    const parsedQuiz = JSON.parse(response.text || '[]');
    res.json({ quiz: parsedQuiz });
  } catch (error: any) {
    console.error('Error in /api/ai/quiz:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during quiz generation.',
      isConfigError: error.message?.includes('GEMINI_API_KEY'),
    });
  }
});

// 3. AI Explain Difficult Topic Endpoint
app.post('/api/ai/explain', async (req, res) => {
  try {
    const { topic, context } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'No topic provided for explanation.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `You are an approachable university professor. Please explain the following difficult topic in a clear, intuitive, and structured manner.
Topic: "${topic}"
Additional Context (if any): "${context || 'None'}"

Use the "ELI5" (Explain Like I'm 5) analogy technique where possible to build core intuition, followed by a professional college-level breakdown of terms, step-by-step logic, and a quick practical real-world example. Use clear markdown formatting.`,
    });

    res.json({ explanation: response.text });
  } catch (error: any) {
    console.error('Error in /api/ai/explain:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during topic explanation.',
      isConfigError: error.message?.includes('GEMINI_API_KEY'),
    });
  }
});

// 4. AI Important Questions Endpoint
app.post('/api/ai/questions', async (req, res) => {
  try {
    const { text, title } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No content provided for extracting questions.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Analyze the following academic notes and generate a list of the top 10 most important exam-style questions that a student should prepare for.
Title: ${title || 'Untitled'}

For each question:
1. Provide the question.
2. Provide a brief hint or outline of what a high-scoring answer must include.
3. Rate its exam probability/importance (High, Medium, Critical).

Format with clean markdown.

Notes:
${text}`,
    });

    res.json({ questions: response.text });
  } catch (error: any) {
    console.error('Error in /api/ai/questions:', error);
    res.status(500).json({
      error: error.message || 'An error occurred during question generation.',
      isConfigError: error.message?.includes('GEMINI_API_KEY'),
    });
  }
});

// Unified start server function supporting both Dev and Prod modes
async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('Vite middleware loaded in development mode');
    } catch (e) {
      console.error('Failed to load Vite middleware:', e);
    }
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      // If request is for /api, don't serve index.html
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
          res.status(404).send('Not Found');
        }
      });
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
