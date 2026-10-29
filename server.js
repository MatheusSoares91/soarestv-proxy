
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['*']
}));

// Domínios autorizados configurados no Render.
// Exemplo: ALLOWED_STREAM_HOSTS=exemplo.com,outro-exemplo.com
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_STREAM_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);

app.get('/', (req, res) => {
  res.send('SOARES TV Proxy Backend está rodando!');
});

app.get('/stream', async (req, res) => {
  const source = req.query.url;

  if (typeof source !== 'string' || !source) {
    return res.status(400).send('URL do canal não informada.');
  }

  let url;

  try {
    url = new URL(source);
  } catch {
    return res.status(400).send('URL inválida.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return res.status(400).send('Protocolo não permitido.');
  }

  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return res.status(403).send(
      'Domínio não autorizado. Configure ALLOWED_STREAM_HOSTS no Render.'
    );
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: '*/*'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(
        `A fonte respondeu com HTTP ${upstream.status}.`
      );
    }

    const contentType =
      upstream.headers.get('content-type') || '';

    const isPlaylist =
      /\.m3u8(?:$|\?)/i.test(url.href) ||
      contentType.toLowerCase().includes('mpegurl');

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (isPlaylist) {
      const playlist = await upstream.text();

      const rewritten = playlist
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();

          if (!trimmed) {
            return line;
          }

          // Corrige URIs presentes em tags HLS.
          if (trimmed.startsWith('#')) {
            return line.replace(
              /URI="([^"]+)"/g,
              (match, uri) => {
                try {
                  const absoluteUrl = new URL(uri, url).href;

                  return `URI="/stream?url=${encodeURIComponent(
                    absoluteUrl
                  )}"`;
                } catch {
                  return match;
                }
              }
            );
          }

          // Converte caminhos relativos em URLs absolutas
          // encaminhadas pelo endpoint /stream.
          try {
            const absoluteUrl = new URL(trimmed, url).href;

            return `/stream?url=${encodeURIComponent(
              absoluteUrl
            )}`;
          } catch {
            return line;
          }
        })
        .join('\n');

      res.setHeader(
        'Content-Type',
        'application/vnd.apple.mpegurl; charset=utf-8'
      );

      return res.send(rewritten);
    }

    // Mantém o conteúdo binário dos segmentos de vídeo.
    res.setHeader(
      'Content-Type',
      contentType || 'application/octet-stream'
    );

    const data = Buffer.from(await upstream.arrayBuffer());

    return res.send(data);

  } catch (error) {
    console.error('Erro no proxy:', error.message);

    if (!res.headersSent) {
      return res.status(502).send(
        'Falha ao conectar com a fonte da transmissão.'
      );
    }
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`SOARES TV Proxy rodando na porta ${PORT}`);
});
