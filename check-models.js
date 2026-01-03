const https = require('https');
const fs = require('fs');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error("No GEMINI_API_KEY found in environment variables.");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

https.get(url, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode !== 200) {
        console.error(`Request failed with status ${res.statusCode}: ${data}`);
        fs.writeFileSync('models_error.txt', `Status: ${res.statusCode}\nBody: ${data}`);
    } else {
        console.log("Models fetched successfully.");
        fs.writeFileSync('models.json', data);
    }
  });

}).on('error', (err) => {
  console.error("Error fetching models:", err.message);
  fs.writeFileSync('models_error.txt', err.message);
});
