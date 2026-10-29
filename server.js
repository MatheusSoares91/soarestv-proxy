const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
app.use(cors());

// Rota de saúde para a Render saber que o servidor está online
app.get('/', (req, res) => {
  res.send('SOARES TV Proxy Backend is Running!');
});

// Rota de Proxy para os fluxos de IPTV
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
        // Mascara o User-Agent para parecer um player legítimo (ex: VLC) e evitar bloqueios
        proxyReq.setHeader('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Soares TV Proxy rodando na porta ${PORT}`);
});