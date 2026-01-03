
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

async function listModels() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  try {
    console.log("Fetching models...");
    const response = await ai.models.list();
    
    console.log("Available Models:");
    // The response structure might depend on the SDK version, let's print what we find
    if (response) {
       // It might be an async iterable or an object with 'models' property
       // Based on docs for similar Google SDKs, let's try to iterate or print data
       console.log(JSON.stringify(response, null, 2));
    }
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
