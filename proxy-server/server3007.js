const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
app.use(cors());

// Intercept /v1/models if needed
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
    target: 'http://localhost:3006',
    changeOrigin: true,
    onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy error');
    }
}));

const PORT = 3007;
app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT} and forwarding to http://localhost:3006`);
});
