
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Coloque aqui os domínios das fontes que você
// tem autorização para retransmitir.
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
    return res.status(400).send('URL não informada.');
  }

  try {
    const url = new URL(source);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !ALLOWED_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return res.status(403).send('Fonte não autorizada.');
    }

    const upstream = await fetch(url, {
      headers: {
        'Accept': '*/*'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!upstream.ok) {
      return res.status(upstream.status)
        .send(`Erro na fonte: ${upstream.status}`);
    }

    const contentType =
      upstream.headers.get('content-type') || '';

    const isPlaylist =
      url.pathname.toLowerCase().endsWith('.m3u8') ||
      contentType.includes('mpegurl');

    res.setHeader('Cache-Control', 'no-store');

    if (isPlaylist) {
      const playlist = await upstream.text();

      const rewritten = playlist
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();

          // Reescreve URI="..." em tags HLS,
          // como EXT-X-KEY e EXT-X-MAP.
          let result = line.replace(
            /URI="([^"]+)"/g,
            (_, uri) => {
              const absolute = new URL(uri, url).href;
              return `URI="/stream?url=${encodeURIComponent(absolute)}"`;
            }
          );

          // Mantém comentários e linhas vazias.
          if (!trimmed || trimmed.startsWith('#')) {
            return result;
          }

          // Reescreve playlists filhas e segmentos.
          const absolute = new URL(trimmed, url).href;
          return `/stream?url=${encodeURIComponent(absolute)}`;
        })
        .join('\n');

      res.type('application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    res.setHeader(
      'Content-Type',
      contentType || 'application/octet-stream'
    );

    const buffer = Buffer.from(
      await upstream.arrayBuffer()
    );

    return res.send(buffer);

  } catch (error) {
    console.error('Erro no proxy:', error.message);

    if (!res.headersSent) {
      return res.status(502)
        .send('Falha ao carregar a transmissão.');
    }
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`SOARES TV Proxy rodando na porta ${PORT}`);
});
