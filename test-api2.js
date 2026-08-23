const { google } = require('@ai-sdk/google');
const { generateText } = require('ai');
require('dotenv').config({ path: '.env.local' });

(async () => {
  try {
    const { text } = await generateText({
      model: google('gemini-1.5-flash'),
      prompt: 'hello'
    });
    console.log('Result:', text);
  } catch (e) {
    console.error('Error flash:', e.message);
  }

  try {
    const { text } = await generateText({
      model: google('gemini-1.5-pro-latest'),
      prompt: 'hello'
    });
    console.log('Result pro:', text);
  } catch (e) {
    console.error('Error pro:', e.message);
  }
})();
