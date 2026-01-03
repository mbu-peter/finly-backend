
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  try {
    // This is a direct API call simulation as the SDK might not expose listModels directly in this version
    // Or we use the model's info if possible. 
    // Actually, let's just try to get a model we know exists and print it, 
    // but the issue is we don't know what exists.
    
    // The previous error suggested "Call ListModels to see the list".
    // Let's try to find a way to list models via the SDK if available, or just fetch via REST if needed.
    // The SDK often doesn't export listModels on the main client in checking some versions.
    // However, let's try assuming it might not be easy via SDK directly without looking at docs.
    // Let's rely on a basic fetch to the API directly using the key.
    
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("No API Key found");
        return;
    }

    console.log("Checking models for key ending in...", key.slice(-4));
    
    // Use fetch to query the API directly
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    
    if (!response.ok) {
        console.error("Failed to fetch models:", response.status, response.statusText);
        const text = await response.text();
        console.error("Response:", text);
        return;
    }

    const data = await response.json();
    console.log("Available Models:");
    if (data.models) {
        data.models.forEach((m: any) => {
            console.log(`- ${m.name}`);
            if (m.supportedGenerationMethods) {
                console.log(`  Methods: ${m.supportedGenerationMethods.join(', ')}`);
            }
        });
    } else {
        console.log("No models found in response", data);
    }

  } catch (error) {
    console.error('Error listing models:', error);
  }
}

listModels();
