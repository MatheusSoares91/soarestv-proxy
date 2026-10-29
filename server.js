const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['*']
}));
// URL pública do proxy no Render.
// Se mudar o domínio, atualize esta variável no Render.
const PROXY_BASE_URL = (
  process.env.PROXY_BASE_URL ||
  'https://soarestv-proxy.onrender.com'
).replace(/\/+$/, '');
// Hosts autorizados: separados por vírgula no Render.
// Inclua todos os hosts usados pelas playlists e pelos segmentos.
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_STREAM_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT = 20000;
function isAllowed(url) {
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}
function makeProxyUrl(url) {
  return `${PROXY_BASE_URL}/stream?url=${encodeURIComponent(url)}`;
}
// Busca a fonte, validando também os destinos de redirecionamento.
async function fetchAllowed(source, req) {
  let currentUrl = new URL(source);
 for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!['http:', 'https:'].includes(currentUrl.protocol)) {
      throw new Error('Protocolo não permitido.');
    }
    if (!isAllowed(currentUrl)) {
      throw new Error(
        `Host não autorizado: ${currentUrl.hostname}`
      );
    }
    const headers = {
      Accept: req.headers.accept || '*/*',
      'User-Agent': req.headers['user-agent'] || 'SOARES-TV'
    };
    // Preserva pedidos de intervalo, quando usados pelo player.
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }
    const response = await fetch(currentUrl, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      if (redirects === MAX_REDIRECTS) {
        await response.body?.cancel();
        throw new Error('Limite de redirecionamentos excedido.');
      }
      const nextUrl = new URL(location, currentUrl);
      await response.body?.cancel();
      currentUrl = nextUrl;
      continue;
    }
    return {
      response,
      finalUrl: currentUrl
    };
  }
  throw new Error('Não foi possível acessar a fonte.');
}
app.get('/', (req, res) => {
  res.type('text/plain').send(
    'SOARES TV Proxy Backend está rodando!'
  );
});
app.all('/stream', async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).send('Método não permitido.');
  }
  const source = req.query.url;
  if (typeof source !== 'string' || !source) {
    return res.status(400).send('URL do canal não informada.');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(source);
  } catch {
    return res.status(400).send('URL inválida.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).send('Protocolo não permitido.');
  }
  if (!isAllowed(parsedUrl)) {
    return res.status(403).send(
      `Domínio não autorizado: ${parsedUrl.hostname}. ` +
      'Configure ALLOWED_STREAM_HOSTS no Render.'
    );
  }
  try {
    const result = await fetchAllowed(source, req);
// Compatibilidade com uma resposta de redirecionamento sem Location.
    if (result instanceof Response) {
      return res.status(result.status).send(
        `A fonte respondeu com HTTP ${result.status}.`
      );
    }
    const { response: upstream, finalUrl } = result;
    if (!upstream.ok) {
      const status = upstream.status;
      await upstream.body?.cancel();
      return res.status(status).send(
        `A fonte respondeu com HTTP ${status}.`
      );
    }
    const contentType =
      upstream.headers.get('content-type') || '';
    const isPlaylist =
      /\.m3u8(?:$|\?)/i.test(finalUrl.href) ||
      contentType.toLowerCase().includes('mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (upstream.headers.get('content-range')) {
      res.setHeader(
        'Content-Range',
        upstream.headers.get('content-range')
      );
    }
    if (upstream.headers.get('accept-ranges')) {
      res.setHeader(
        'Accept-Ranges',
        upstream.headers.get('accept-ranges')
      );
    }
    if (upstream.status === 206) {
      res.status(206);
    }
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      return res.end();
    }
    if (isPlaylist) {
      const playlist = await upstream.text();
      const rewritten = playlist
        .split(/\r?\n/)
        .map(line => {
          const trimmed = line.trim();
          if (!trimmed) {
            return line;
          }
          // Reescreve URI="..." em tags HLS, como chaves
          // de criptografia e playlists alternativas.
          if (trimmed.startsWith('#')) {
            return line.replace(
              /URI="([^"]+)"/g,
              (match, uri) => {
                try {
                  const absoluteUrl = new URL(uri, finalUrl).href;
                  return `URI="${makeProxyUrl(absoluteUrl)}"`;
                } catch {
                  return match;
                }
              }
            );
          }
          // Reescreve playlists secundárias e segmentos,
          // inclusive quando a URL original é relativa.
          try {
            const absoluteUrl = new URL(trimmed, finalUrl).href;
            return makeProxyUrl(absoluteUrl);
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
    // Preserva o tipo e o status do conteúdo de vídeo.
    res.status(upstream.status);
    res.setHeader(
      'Content-Type',
      contentType || 'application/octet-stream'
    );
    const data = Buffer.from(await upstream.arrayBuffer());
    if (upstream.headers.get('content-length')) {
      res.setHeader('Content-Length', data.length);
    }
    return res.send(data);
  } catch (error) {
    console.error('Erro no proxy:', error.message);
    if (!res.headersSent) {
      const message = error.name === 'TimeoutError'
        ? 'Tempo limite ao conectar com a transmissão.'
        : 'Falha ao conectar com a fonte da transmissão.';
      return res.status(502).send(message);
    }
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`SOARES TV Proxy rodando na porta ${PORT}`);
});
