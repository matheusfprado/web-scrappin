"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:readline/promises"));
const node_process_1 = require("node:process");
function logStep(message) {
    console.log(`[Shopee] ${message}`);
}
async function sleep(ms) {
    if (ms <= 0)
        return;
    await new Promise((resolve) => setTimeout(resolve, ms));
}
function buildShopeeUrl(query) {
    const slug = query
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    return `https://shopee.com.br/list/${slug}`;
}
function normalizePrice(raw) {
    const cleaned = raw.replace(/[^\d,.-]/g, '').trim();
    if (!cleaned)
        return Number.POSITIVE_INFINITY;
    const normalized = cleaned.replace(/\./g, '').replace(',', '.');
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
function formatShopeePrice(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return '';
    let normalized = value;
    if (normalized >= 100000)
        normalized = normalized / 100000;
    const formatted = normalized.toFixed(2).replace('.', ',');
    return `R$ ${formatted}`;
}
function extractShopeeItems(data) {
    if (!data)
        return [];
    const results = [];
    const visited = new Set();
    const stack = [data];
    while (stack.length && results.length < 200) {
        const node = stack.pop();
        if (!node || typeof node !== 'object')
            continue;
        if (visited.has(node))
            continue;
        visited.add(node);
        if (Array.isArray(node)) {
            for (const entry of node)
                stack.push(entry);
            continue;
        }
        const anyNode = node;
        const itemid = anyNode.itemid ?? anyNode.item_id ?? anyNode.itemId;
        const shopid = anyNode.shopid ?? anyNode.shop_id ?? anyNode.shopId;
        const name = anyNode.name ?? anyNode.title;
        const price = anyNode.price ??
            anyNode.price_min ??
            anyNode.price_min_before_discount;
        if (itemid && shopid && name) {
            results.push({
                title: String(name).trim(),
                price: formatShopeePrice(typeof price === 'number' ? price : undefined),
                link: `https://shopee.com.br/product/${shopid}/${itemid}`,
                discount: '',
            });
        }
        for (const value of Object.values(anyNode)) {
            if (value && typeof value === 'object') {
                stack.push(value);
            }
        }
    }
    return results;
}
async function fetchShopeeApi(page, query) {
    const apiUrl = new URL('https://shopee.com.br/api/v4/search/search_items');
    apiUrl.searchParams.set('by', 'relevancy');
    apiUrl.searchParams.set('keyword', query);
    apiUrl.searchParams.set('limit', '60');
    apiUrl.searchParams.set('newest', '0');
    apiUrl.searchParams.set('order', 'desc');
    apiUrl.searchParams.set('page_type', 'search');
    apiUrl.searchParams.set('scenario', 'PAGE_GLOBAL_SEARCH');
    apiUrl.searchParams.set('version', '2');
    let data = null;
    const inPageResponse = await page
        .waitForResponse((resp) => resp.url().includes('/api/v4/search/search_items') &&
        resp.status() === 200, { timeout: 8000 })
        .catch(() => null);
    if (inPageResponse && inPageResponse.ok()) {
        data = await inPageResponse.json().catch(() => null);
    }
    const directResponse = await page.request
        .get(apiUrl.toString(), {
        headers: {
            accept: 'application/json',
            'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            referer: buildShopeeUrl(query),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'x-api-source': 'pc',
            'x-shopee-language': 'pt-BR',
        },
        timeout: 20000,
    })
        .catch(() => null);
    const directStatus = directResponse?.status();
    let status = directStatus;
    if (directResponse && directResponse.ok()) {
        data = await directResponse.json().catch(() => null);
    }
    if (!data) {
        data = await page
            .evaluate(async (url) => {
            const res = await fetch(url, {
                credentials: 'include',
                headers: {
                    accept: 'application/json',
                    'x-api-source': 'pc',
                    'x-shopee-language': 'pt-BR',
                },
            });
            if (!res.ok)
                return null;
            return res.json();
        }, apiUrl.toString())
            .catch(() => null);
    }
    if (!data) {
        const response = await page
            .waitForResponse((resp) => resp.url().includes('/api/v4/search/search_items') &&
            resp.request().method() === 'GET', { timeout: 10000 })
            .catch(() => null);
        if (response) {
            data = await response.json().catch(() => null);
        }
    }
    const items = data?.items ?? data?.data?.items ?? [];
    let products = [];
    if (Array.isArray(items)) {
        products = items
            .map((entry) => entry?.item_basic ?? entry?.item ?? entry)
            .filter(Boolean)
            .map((entry) => ({
            title: String(entry?.name ?? '').trim(),
            price: formatShopeePrice(typeof entry?.price === 'number'
                ? entry.price
                : typeof entry?.price_min === 'number'
                    ? entry.price_min
                    : entry?.price_min_before_discount),
            link: entry?.shopid && entry?.itemid
                ? `https://shopee.com.br/product/${entry.shopid}/${entry.itemid}`
                : '',
            discount: '',
        }))
            .filter((item) => item.title && item.link);
    }
    if (!products.length) {
        products = extractShopeeItems(data);
    }
    if (!products.length) {
        console.log(`Shopee API vazio (status=${directStatus ?? 'n/a'}). Tente HEADLESS=false.`);
    }
    if (!status && inPageResponse) {
        status = inPageResponse.status();
    }
    return { products, status };
}
async function scrapeShopeeDom(page) {
    const data = await page.evaluate(() => {
        const cardSelectors = [
            '.shopee-search-item-result__item',
            "[data-sqe='item']",
            '.search-item-card-wrapper',
        ];
        const cards = Array.from(document.querySelectorAll(cardSelectors.join(',')));
        const sources = cards.length
            ? cards
            : Array.from(document.querySelectorAll("a[href*='/product/']"));
        return sources.map((item) => {
            const anchor = item instanceof HTMLAnchorElement
                ? item
                : (item.querySelector("a[href*='/product/']") ??
                    item.querySelector('a'));
            const title = item.querySelector('img[alt]')?.getAttribute('alt')?.trim() ??
                item.querySelector("[data-sqe='name']")?.textContent?.trim() ??
                item.querySelector('div[title]')?.getAttribute('title')?.trim() ??
                anchor?.getAttribute('title')?.trim() ??
                anchor?.textContent?.trim() ??
                '';
            const priceText = item.querySelector("[data-sqe='price']")?.textContent?.trim() ??
                item.textContent?.match(/R\$\s*[\d.,]+/)?.[0]?.trim() ??
                '';
            const discount = item.querySelector("[data-sqe='discount']")?.textContent?.trim() ??
                item.querySelector('.shopee-badge')?.textContent?.trim() ??
                '';
            let link = anchor?.getAttribute('href') ?? '';
            if (link && !link.startsWith('http')) {
                link = new URL(link, window.location.origin).toString();
            }
            return { title, price: priceText, link, discount };
        });
    });
    return data.filter((item) => item.title && item.link && item.price);
}
async function handleShopeeRisk(page, context, headless, authPath, usePersistent, status) {
    const url = page.url();
    const lowerUrl = url.toLowerCase();
    const isRisk = status === 403 ||
        lowerUrl.includes('captcha') ||
        lowerUrl.includes('verify') ||
        lowerUrl.includes('security') ||
        lowerUrl.includes('blocked');
    if (!isRisk)
        return true;
    if (headless) {
        logStep('Bloqueio detectado. Rode com HEADLESS=false para resolver.');
        return false;
    }
    logStep(`Bloqueio detectado. URL atual: ${url}`);
    logStep('Resolva a verificacao no navegador aberto.');
    await waitForUser('Quando concluir o captcha, pressione Enter para continuar.');
    await page
        .waitForURL((url) => !url.toString().includes('/verify/captcha') &&
        !url.toString().includes('/verify/traffic'), { timeout: 120000 })
        .catch(() => null);
    if (!usePersistent) {
        await context.storageState({ path: authPath });
    }
    return true;
}
function getShopeeAuthPath() {
    const authDir = node_path_1.default.join(process.cwd(), '.auth');
    if (!node_fs_1.default.existsSync(authDir)) {
        node_fs_1.default.mkdirSync(authDir, { recursive: true });
    }
    return node_path_1.default.join(authDir, 'shopee.json');
}
function getShopeeUserDataDir() {
    const fromEnv = process.env.SHOPEE_USER_DATA_DIR?.trim();
    if (fromEnv)
        return fromEnv;
    const authDir = node_path_1.default.join(process.cwd(), '.auth', 'shopee-profile');
    if (!node_fs_1.default.existsSync(authDir)) {
        node_fs_1.default.mkdirSync(authDir, { recursive: true });
    }
    return authDir;
}
async function collectProducts(query, headless) {
    const delayMs = Number.parseInt(process.env.SHOPEE_DELAY_MS ?? '800', 10);
    const authPath = getShopeeAuthPath();
    const hasAuth = node_fs_1.default.existsSync(authPath);
    const usePersistent = true;
    const userDataDir = getShopeeUserDataDir();
    const launchArgs = ['--disable-blink-features=AutomationControlled'];
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    let context;
    let closeContext;
    if (usePersistent) {
        context = await playwright_1.chromium.launchPersistentContext(userDataDir, {
            headless,
            args: launchArgs,
            userAgent,
            viewport: { width: 1280, height: 800 },
            locale: 'pt-BR',
        });
        closeContext = async () => {
            await context.close();
        };
    }
    else {
        const browser = await playwright_1.chromium.launch({
            headless,
            args: launchArgs,
        });
        context = await browser.newContext({
            userAgent,
            viewport: { width: 1280, height: 800 },
            locale: 'pt-BR',
            storageState: hasAuth ? authPath : undefined,
        });
        closeContext = async () => {
            await browser.close();
        };
    }
    try {
        const page = context.pages()[0] ?? (await context.newPage());
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });
        await page.setExtraHTTPHeaders({
            'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        });
        if (process.env.LOGIN_GOOGLE === 'true' || !hasAuth) {
            logStep('Login necessario. Abrindo pagina de login.');
            await loginWithGoogle(page);
            await waitForUser('Conclua o login/verificacao e pressione Enter para continuar.');
            await context.storageState({ path: authPath });
        }
        const url = buildShopeeUrl(query);
        logStep(`Abrindo busca: ${url}`);
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await page
            .waitForLoadState('networkidle', { timeout: 10000 })
            .catch(() => null);
        await sleep(delayMs);
        const riskOk = await handleShopeeRisk(page, context, headless, authPath, usePersistent, response?.status());
        if (!riskOk)
            return [];
        logStep('Verificando erros de carregamento.');
        await handleShopeeInterruption(page);
        await sleep(delayMs);
        const results = [];
        const seenLinks = new Set();
        logStep('Buscando via API da Shopee.');
        const apiResult = await fetchShopeeApi(page, query);
        for (const item of apiResult.products) {
            if (!item.link || seenLinks.has(item.link))
                continue;
            seenLinks.add(item.link);
            results.push(item);
            if (results.length >= 50)
                break;
        }
        if (!results.length && apiResult.status === 403) {
            const riskOk = await handleShopeeRisk(page, context, headless, authPath, usePersistent, apiResult.status);
            if (!riskOk)
                return [];
        }
        if (!results.length) {
            logStep('API vazia. Tentando coleta pelo DOM.');
            const domProducts = await scrapeShopeeDom(page);
            for (const item of domProducts) {
                if (!item.link || seenLinks.has(item.link))
                    continue;
                seenLinks.add(item.link);
                results.push(item);
                if (results.length >= 50)
                    break;
            }
        }
        const withNumbers = results.map((item) => ({
            ...item,
            numericPrice: normalizePrice(item.price),
        }));
        return withNumbers
            .sort((a, b) => a.numericPrice - b.numericPrice)
            .slice(0, 50)
            .map(({ numericPrice, ...rest }) => rest);
    }
    finally {
        await closeContext();
    }
}
async function waitForUser(message) {
    const rl = promises_1.default.createInterface({ input: node_process_1.stdin, output: node_process_1.stdout });
    try {
        await rl.question(`${message}\n`);
    }
    finally {
        rl.close();
    }
}
async function handleShopeeInterruption(page) {
    const retryButton = page
        .locator('button:has-text("Tentar Novamente")')
        .first();
    const errorText = page.locator('text="Erro de Carregamento"').first();
    const hasError = (await retryButton.isVisible().catch(() => false)) ||
        (await errorText.isVisible().catch(() => false));
    if (hasError) {
        logStep('Erro de carregamento detectado. Tentando novamente.');
        await retryButton.click().catch(() => null);
        await page.waitForLoadState('domcontentloaded').catch(() => null);
    }
    const stillBlocked = (await retryButton.isVisible().catch(() => false)) ||
        (await errorText.isVisible().catch(() => false));
    if (process.env.SHOPEE_WAIT === 'true' || hasError || stillBlocked) {
        logStep('Aguardando resolucao manual.');
        await waitForUser('Se aparecer captcha/erro, resolva manualmente e pressione Enter.');
    }
}
async function loginWithGoogle(page) {
    await page.goto('https://shopee.com.br/buyer/login', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
    });
    const googleButton = page.locator('[aria-label="Entrar com Google"]').first();
    await googleButton.waitFor({ state: 'visible', timeout: 20000 });
    await googleButton.scrollIntoViewIfNeeded();
    await googleButton.waitFor({ state: 'attached', timeout: 20000 });
    const popupPromise = page.waitForEvent('popup').catch(() => null);
    await googleButton.click({ timeout: 10000 }).catch(async () => {
        await page.evaluate(() => {
            const button = document.querySelector('[aria-label="Entrar com Google"]');
            button?.click();
        });
    });
    const popup = await popupPromise;
    if (popup) {
        await popup.waitForLoadState('domcontentloaded').catch(() => null);
        console.log('Finalize o login do Google na nova janela para continuar.');
    }
    else {
        const loginUrl = page.url();
        await page
            .waitForURL((url) => url.toString().includes('accounts.google.com') ||
            url.toString().includes('/oauth') ||
            (loginUrl.includes('/buyer/login') &&
                !url.toString().includes('/buyer/login')), { timeout: 10000 })
            .catch(() => null);
        if (page.url().includes('/buyer/login')) {
            console.log('Cliquei no login do Google, mas nao abriu popup. Tente abrir manualmente o botao na pagina.');
        }
        else {
            console.log('Finalize o login do Google nesta mesma janela para continuar.');
        }
    }
    await page
        .waitForURL((url) => !url.toString().includes('/buyer/login'), {
        timeout: 120000,
    })
        .catch(() => null);
    await page.waitForTimeout(1000);
}
async function run(query) {
    const headless = process.env.HEADLESS !== 'false';
    const authPath = getShopeeAuthPath();
    const needsLogin = process.env.LOGIN_GOOGLE === 'true' || !node_fs_1.default.existsSync(authPath);
    const effectiveHeadless = needsLogin ? false : headless;
    if (needsLogin && headless) {
        console.log('Sem sessao salva. Forcando HEADLESS=false para login.');
    }
    let products = await collectProducts(query, effectiveHeadless);
    if (!products.length && headless) {
        console.log('Sem resultados no modo headless. Tentando HEADLESS=false.');
        products = await collectProducts(query, false);
    }
    console.log(products);
}
const query = process.argv.slice(2).join(' ').trim();
if (!query) {
    console.error('Uso: npm run shopee -- "iphone 14"');
    process.exit(1);
}
void run(query);
