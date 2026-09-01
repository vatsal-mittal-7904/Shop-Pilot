const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
app.use(cors());

// Intercept /v1/models
app.get('/v1/models', (req, res) => {
    res.json({
        object: 'list',
        data: [
            {
                id: 'claude-opus-5',
                object: 'model',
                created: 1729555200,
                owned_by: 'anthropic'
            },
            {
                id: 'claude-opus-4-8',
                object: 'model',
                created: 1729555200,
                owned_by: 'anthropic'
            }
        ]
    });
});

// Proxy everything else
app.use('/', createProxyMiddleware({
    target: 'https://agentrouter.org',
    changeOrigin: true,
    onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy error');
    }
}));

const PORT = 3006;
app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
});
