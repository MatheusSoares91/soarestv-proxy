const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
  res.send('SOARES TV Proxy Backend is Running!');
});

app.use('/stream', (req, res, next) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL do canal não informada.');
  }

  createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    ws: true,
    secure: false,
    on: {
      proxyReq: (proxyReq, req, res) => {
        // Força cabeçalhos para parecer um player real ou VLC e evitar bloqueios
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        proxyReq.setHeader('Referer', targetUrl);
      },
      proxyRes: (proxyRes, req, res) => {
        // Garante que o CORS continue liberado nas respostas do stream
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
      },
      error: (err, req, res) => {
        console.error('Erro no proxy:', err.message);
        if (!res.headersSent) {
          res.status(500).send('Erro ao conectar com o canal.');
        }
      }
    }
  })(req, res, next);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Soares TV Proxy rodando na porta ${PORT}`);
});
