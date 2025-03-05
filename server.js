const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const port = 3000;

// Rota principal para servir o HTML
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Rota para iniciar o processo de captura de links .m3u8 com SSE
app.get('/start-process', async (req, res) => {
  // Configura a resposta como Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const nameAnime = req.query.nameAnime; // Obtém o caminho completo do anime da query string
  const startEpisode = parseInt(req.query.startEpisode) || 1; // Obtém o episódio inicial da query string
  const endEpisode = parseInt(req.query.endEpisode); // Obtém o episódio final da query string (opcional)
  const specificEpisode = req.query.specificEpisode; // Obtém o episódio específico da query string

  if (!nameAnime) {
    res.write(`data: ${JSON.stringify({ message: 'Erro: O caminho do anime é obrigatório.' })}\n\n`);
    res.end();
    return;
  }

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const allLinks = {};

    // Função para enviar mensagens de progresso ou dados parciais para o frontend
    const sendProgress = (message, data = null) => {
      res.write(`data: ${JSON.stringify({ message, data })}\n\n`);
    };

    // Configura o monitoramento de requisições de rede
    await page.setRequestInterception(true);

    page.on('request', (request) => {
      if (request.url().endsWith('.m3u8')) {
        console.log('Link .m3u8 capturado:', request.url());
      }
      request.continue();
    });

    // Verifica se a URL contém "/filme/"
    const isMovie = nameAnime.includes('/filme/');

    if (specificEpisode || isMovie) {
      // Processa apenas o episódio específico ou o filme
      const formattedEpisode = isMovie ? '' : `episodio-${specificEpisode}`;
      const url = `${nameAnime}/${formattedEpisode}`;

      const episodeLabel = isMovie ? 'Filme' : `Episódio ${specificEpisode}`;
      sendProgress(`Buscando vídeos apenas do ${episodeLabel}...`);

      try {
        // Navega para a página do episódio ou filme
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

        // Verifica se a página contém algum elemento indicativo de erro (ex.: "Página não encontrada")
        const notFound = await page.evaluate(() => {
          return document.body.innerText.includes('Página não encontrada') || document.body.innerText.includes('404');
        });

        if (notFound) {
          console.log(`${episodeLabel} não encontrado.`);
          sendProgress(`${episodeLabel} não encontrado.`);
          res.end();
          return;
        }

        // Captura os links .m3u8 para o episódio ou filme atual
        const qualities = ['480p', '720p', '1080p'];
        const episodeLinks = {};
        for (const quality of qualities) {
          sendProgress(`Carregando ${episodeLabel} ${quality}...`);

          await page.evaluate((q) => {
            window.changePlayerResolution(q); // Chama a função diretamente no contexto da página
          }, quality);

          const response = await page.waitForResponse((response) => response.url().endsWith('.m3u8'), { timeout: 30000 });
          episodeLinks[quality] = response.url(); // Associa a qualidade ao link
          console.log(`Link .m3u8 capturado para ${quality}:`, response.url());

          // Envia os dados parciais para o frontend
          allLinks[episodeLabel] = episodeLinks;
          sendProgress(null, allLinks);
        }

        sendProgress(`Lista completa (Total de ${isMovie ? 'filmes' : 'episódios'}: 1)`, allLinks);
      } catch (error) {
        console.error(`Erro ao navegar para o ${episodeLabel}:`, error.message);
        sendProgress(`Erro ao carregar ${episodeLabel}. Encerrando...`);
      } finally {
        await browser.close();
        res.end();
        return;
      }
    }

    // Processa um intervalo de episódios (comportamento padrão)
    let episode = startEpisode; // Começa do episódio especificado pelo usuário
    while (true) {
      // Verifica se o episódio atual excede o episódio final (se fornecido)
      if (endEpisode && episode > endEpisode) {
        console.log(`Episódio ${episode} excede o limite configurado (${endEpisode}). Encerrando...`);
        break;
      }

      const formattedEpisode = String(episode).padStart(2, '0'); // Formata o número do episódio como "01", "02", etc.
      const episodeLabel = `Episódio ${formattedEpisode}`;
      const url = `${nameAnime}/episodio-${formattedEpisode}`;

      sendProgress(`Carregando ${episodeLabel}...`);

      try {
        // Navega para a página do episódio
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

        // Verifica se a página contém algum elemento indicativo de erro (ex.: "Página não encontrada")
        const notFound = await page.evaluate(() => {
          return document.body.innerText.includes('Página não encontrada') || document.body.innerText.includes('404');
        });

        if (notFound) {
          console.log(`${episodeLabel} não encontrado. Encerrando...`);
          sendProgress(`${episodeLabel} não encontrado. Encerrando...`);
          break; // Encerra o loop definitivamente
        }

        // Captura os links .m3u8 para o episódio atual
        const qualities = ['480p', '720p', '1080p'];
        const episodeLinks = {};
        for (const quality of qualities) {
          sendProgress(`Carregando ${episodeLabel} ${quality}...`);

          await page.evaluate((q) => {
            window.changePlayerResolution(q); // Chama a função diretamente no contexto da página
          }, quality);

          const response = await page.waitForResponse((response) => response.url().endsWith('.m3u8'), { timeout: 30000 });
          episodeLinks[quality] = response.url(); // Associa a qualidade ao link
          console.log(`Link .m3u8 capturado para ${quality}:`, response.url());

          // Envia os dados parciais para o frontend
          allLinks[episodeLabel] = episodeLinks;
          sendProgress(null, allLinks);
        }

        episode++; // Incrementa para o próximo episódio
      } catch (error) {
        console.error(`Erro ao navegar para o ${episodeLabel}:`, error.message);
        sendProgress(`Erro ao carregar ${episodeLabel}. Encerrando...`);
        break; // Encerra o loop definitivamente em caso de erro
      }
    }

    await browser.close();

    // Envia a mensagem final com o total de episódios ou filmes
    const totalEpisodes = Object.keys(allLinks).length;
    sendProgress(`Lista completa (Total de ${isMovie ? 'filmes' : 'episódios'}: ${totalEpisodes})`, allLinks);

    res.end();
  } catch (error) {
    console.error('Erro ao capturar links:', error.message);
    res.write(`data: ${JSON.stringify({ success: false })}\n\n`);
    res.end();
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
