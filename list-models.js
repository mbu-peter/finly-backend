const https = require('https');
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY not set in environment');
  process.exit(1);
}
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Available models:');
      if (json.models && Array.isArray(json.models)) {
        json.models.forEach((m) => console.log(`- ${m.name}`));
      } else {
        console.log(JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.error('Failed to parse response:', e);
    }
  });
}).on('error', (e) => {
  console.error('Request error:', e);
});
