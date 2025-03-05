const puppeteer = require('puppeteer');

(async () => {
    // Inicia o navegador no modo headless
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos necessários para ambientes como Render
    });
    const page = await browser.newPage();

    const m3u8Links = [];
    await page.setRequestInterception(true);

    page.on('request', (request) => {
        console.log('Requisição feita:', request.url());
        if (request.url().endsWith('.m3u8')) {
            console.log('Link .m3u8 capturado:', request.url());
            m3u8Links.push(request.url());
        }
        request.continue();
    });

    await page.goto('https://betteranime.net/filme/legendado/kizumonogatari-ii-nekketsu-hen/episodio-01', { waitUntil: 'networkidle2', timeout: 60000 });

    // Função para clicar em um botão de qualidade
    const clickQualityButton = async (quality) => {
        try {
            console.log(`Alterando qualidade para ${quality}...`);
            await page.evaluate((q) => {
                window.changePlayerResolution(q); // Simula a troca de qualidade diretamente
            }, quality);

            // Aguarda uma nova requisição .m3u8
            await page.waitForResponse((response) => response.url().endsWith('.m3u8'), { timeout: 30000 });
            console.log(`Qualidade ${quality} alterada.`);
        } catch (error) {
            console.error(`Erro ao alterar qualidade para ${quality}:`, error.message);
        }
    };

    // Captura links .m3u8 para cada qualidade
    const qualities = ['480p', '720p', '1080p'];
    for (const quality of qualities) {
        await clickQualityButton(quality);
    }

    console.log('Todos os links .m3u8 capturados:', m3u8Links);
    await browser.close();
})();