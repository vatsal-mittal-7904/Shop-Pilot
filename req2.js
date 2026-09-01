async function run() {
  const loginRes = await fetch('http://localhost:3000/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=demo.customer@technest.com&password=technest-demo-2026&mode=sign-in'
  });
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Got cookie:', cookie);

  const chatRes = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'need mechanical keyboard budget 8000' }]
    })
  });
  console.log('Chat Status:', chatRes.status);
  const text = await chatRes.text();
  console.log('Chat Body:', text);
}
run();
