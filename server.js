const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// Libera CORS para qualquer origem
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['*']
}));

app.get('/', (req, res) => {
  res.send('SOARES TV Proxy Backend está rodando!');
});

app.use('/stream', (req, res, next) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('URL do canal não informada.');
  }

  try {
    const parsedUrl = new URL(targetUrl);

    return createProxyMiddleware({
      target: parsedUrl.origin,
      changeOrigin: true,
      followRedirects: true,
      secure: false, // Permite conexões HTTP/HTTPS sem checagem estrita de SSL
      pathRewrite: (path, req) => {
        // Redireciona o caminho completo exato da transmissão
        return parsedUrl.pathname + parsedUrl.search;
      },
      on: {
        proxyReq: (proxyReq, req, res) => {
          // Força o User-Agent do VLC/FFmpeg (que os servidores de IPTV aceitam sem bloquear)
          proxyReq.setHeader('User-Agent', 'VLC/3.0.18 LibVLC/3.0.18');
          proxyReq.setHeader('Accept', '*/*');
          proxyReq.setHeader('Connection', 'keep-alive');
          proxyReq.removeHeader('origin');
          proxyReq.removeHeader('referer');
        },
        proxyRes: (proxyRes, req, res) => {
          // Garante os cabeçalhos de CORS na resposta de cada fragmento
          proxyRes.headers['access-control-allow-origin'] = '*';
          proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
          proxyRes.headers['access-control-allow-headers'] = '*';
        },
        error: (err, req, res) => {
          console.error('Erro no proxy:', err.message);
          if (!res.headersSent) {
            res.status(502).send('Falha ao conectar com o servidor da fonte do canal.');
          }
        }
      }
    })(req, res, next);
  } catch (err) {
    return res.status(400).send('URL inválida.');
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`SOARES TV Proxy rodando na porta ${PORT}`);
});
