const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('http://localhost:3000/');
  await page.click('button:has-text("New customer?")');
  await page.fill('label:has-text("Name") input', 'Test User');
  await page.fill('input[type="email"]', `test-${Date.now()}@example.com`);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button:has-text("Create customer account")');
  await page.waitForURL('**/store');
  
  await page.goto('http://localhost:3000/agent');
  
  page.on('response', async (response) => {
    if (response.url().includes('/api/chat')) {
      console.log('API/CHAT response:', response.status());
    }
  });

  await page.fill('input[placeholder="E.g. I need a mechanical keyboard under 8000 rupees..."]', 'need mechanical keyboard budget 8000');
  await page.click('button:has(svg)');
  
  // wait for response in chat
  await page.waitForTimeout(5000);
  const text = await page.content();
  if (text.includes("temporarily unavailable")) {
    console.log("FAILED: Chat is still unavailable");
  } else {
    console.log("SUCCESS: Chat responded!");
  }
  
  await browser.close();
})();
