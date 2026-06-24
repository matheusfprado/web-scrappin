"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const playwright_1 = require("playwright");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "1mb" }));
const MAX_ITEMS = 10;
const MERCADO_LIVRE_BASE = "https://www.mercadolivre.com.br/";
function getMercadoLivreSelectors() {
    return {
        product: ".ui-search-layout__item",
        title: ".ui-search-item__title",
        link: ".ui-search-link",
        price: ".andes-money-amount__fraction",
        discount: ".ui-search-price__discount",
    };
}
function buildMercadoLivreUrl(niche) {
    if (!niche)
        return "https://lista.mercadolivre.com.br/";
    const slug = niche
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
    return `https://lista.mercadolivre.com.br/${slug}`;
}
function normalizeText(value) {
    return (value ?? "").replace(/\s+/g, " ").trim();
}
function parseMoneyToNumber(raw) {
    const cleaned = raw.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned)
        return null;
    const hasComma = cleaned.includes(",");
    const hasDot = cleaned.includes(".");
    let normalized = cleaned;
    if (hasComma && hasDot) {
        normalized = cleaned.replace(/\./g, "").replace(",", ".");
    }
    else if (hasComma && !hasDot) {
        normalized = cleaned.replace(",", ".");
    }
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
}
function calculateFinalPrice(price, discountText) {
    const normalized = discountText.trim();
    if (!normalized)
        return price;
    if (/%/.test(normalized)) {
        const percent = parseMoneyToNumber(normalized);
        if (percent !== null) {
            return Math.max(0, price * (1 - percent / 100));
        }
    }
    const discountValue = parseMoneyToNumber(normalized);
    if (discountValue !== null) {
        return Math.max(0, price - discountValue);
    }
    return price;
}
function matchesNiche(title, niche) {
    if (!niche)
        return true;
    return title.toLowerCase().includes(niche.toLowerCase());
}
async function scrapeProducts(payload) {
    const selectors = payload.selectors ??
        (payload.site?.includes("mercadolivre.com.br") ||
            payload.url?.includes("mercadolivre.com.br")
            ? getMercadoLivreSelectors()
            : null);
    if (!selectors) {
        throw new Error("Seletores obrigatorios para este site.");
    }
    const browser = await playwright_1.chromium.launch({ headless: true });
    const page = await browser.newPage({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
    });
    await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
            void route.abort();
            return;
        }
        void route.continue();
    });
    await page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const productSelectors = [
        selectors.product,
        ".ui-search-layout__item",
        ".ui-search-layout__item > .ui-search-result__wrapper",
    ].filter(Boolean);
    const waitAttempts = await Promise.all(productSelectors.map(async (selector) => {
        try {
            await page.waitForSelector(selector, { timeout: 30000, state: "attached" });
            return true;
        }
        catch {
            return false;
        }
    }));
    if (!waitAttempts.some(Boolean)) {
        throw new Error(`Nenhum produto encontrado. Verifique a URL e os seletores. Testados: ${productSelectors.join(", ")}`);
    }
    const rawItems = await page.$$eval(selectors.product, (elements, selectors) => {
        return elements.map((element) => {
            const getText = (sel) => {
                if (!sel)
                    return "";
                const node = element.querySelector(sel);
                return node?.textContent?.trim() ?? "";
            };
            const getHref = (sel) => {
                if (!sel)
                    return "";
                const node = element.querySelector(sel);
                return node?.getAttribute("href") ?? "";
            };
            return {
                title: getText(selectors.title),
                link: getHref(selectors.link),
                priceText: getText(selectors.price),
                discountText: getText(selectors.discount),
            };
        });
    }, selectors);
    await browser.close();
    const baseUrl = payload.baseUrl ??
        payload.site ??
        payload.url ??
        MERCADO_LIVRE_BASE;
    const results = rawItems
        .map((item) => {
        const price = parseMoneyToNumber(item.priceText);
        if (price === null)
            return null;
        const finalPrice = calculateFinalPrice(price, item.discountText);
        let link = normalizeText(item.link);
        if (link) {
            try {
                link = new URL(link, baseUrl).toString();
            }
            catch {
                link = normalizeText(item.link);
            }
        }
        return {
            title: normalizeText(item.title),
            link,
            price,
            discount: normalizeText(item.discountText),
            finalPrice,
        };
    })
        .filter((item) => Boolean(item))
        .filter((item) => item.title && matchesNiche(item.title, payload.niche));
    return results;
}
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Web Scrappin</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; background: #f6f6f6; }
      .card { max-width: 720px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
      h1 { margin-top: 0; }
      label { display: block; margin: 12px 0 6px; font-weight: 600; }
      input, textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; }
      button { margin-top: 16px; padding: 10px 16px; border: 0; background: #0a7; color: #fff; border-radius: 6px; cursor: pointer; }
      button:disabled { background: #999; cursor: not-allowed; }
      pre { white-space: pre-wrap; background: #111; color: #eee; padding: 12px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Scraper</h1>
      <label>URL da busca (opcional)</label>
      <input id="url" placeholder="https://lista.mercadolivre.com.br/tenis" />
      <label>Nicho</label>
      <input id="niche" placeholder="tenis" />
      <label>Site base (opcional)</label>
      <input id="site" value="https://www.mercadolivre.com.br/" />
      <label>Seletores (JSON) - opcional</label>
      <textarea id="selectors" rows="6" placeholder='{"product":".ui-search-layout__item","title":".ui-search-item__title","link":".ui-search-link","price":".andes-money-amount__fraction","discount":".ui-search-price__discount"}'></textarea>
      <button id="run">Buscar 10 melhores</button>
      <pre id="out"></pre>
    </div>
    <script>
      const runBtn = document.getElementById("run");
      const out = document.getElementById("out");
      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        out.textContent = "Carregando...";
        const url = document.getElementById("url").value.trim();
        const niche = document.getElementById("niche").value.trim();
        const site = document.getElementById("site").value.trim();
        const selectorsText = document.getElementById("selectors").value.trim();
        let selectors = undefined;
        if (selectorsText) {
          try {
            selectors = JSON.parse(selectorsText);
          } catch {
            out.textContent = "Erro: seletores precisam ser JSON valido.";
            runBtn.disabled = false;
            return;
          }
        }

        const payload = {
          url,
          niche: niche || undefined,
          site: site || undefined,
          limit: 10,
          selectors,
        };

        try {
          const res = await fetch("/scrape", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          out.textContent = JSON.stringify(data, null, 2);
        } catch (err) {
          out.textContent = "Erro: " + String(err);
        } finally {
          runBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>`);
});
app.post("/scrape", async (req, res) => {
    const payload = req.body;
    const isMercadoLivre = payload?.site?.includes("mercadolivre.com.br") ||
        payload?.url?.includes("mercadolivre.com.br");
    const finalUrl = payload?.url || (isMercadoLivre ? buildMercadoLivreUrl(payload?.niche) : "");
    if (!finalUrl) {
        res.status(400).json({
            error: "Informe url ou niche para Mercado Livre.",
        });
        return;
    }
    const requested = payload.limit ?? MAX_ITEMS;
    const limit = Math.min(requested, MAX_ITEMS);
    try {
        const items = await scrapeProducts({ ...payload, url: finalUrl });
        const sorted = items.sort((a, b) => a.finalPrice - b.finalPrice);
        res.json({
            count: Math.min(sorted.length, limit),
            items: sorted.slice(0, limit),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Erro inesperado.";
        res.status(500).json({ error: message });
    }
});
app.get("/scrape", async (req, res) => {
    let selectors = null;
    const selectorsRaw = req.query.selectors;
    if (typeof selectorsRaw === "string") {
        try {
            selectors = JSON.parse(selectorsRaw);
        }
        catch {
            res.status(400).json({
                error: "selectors precisa ser um JSON valido.",
            });
            return;
        }
    }
    else {
        const product = typeof req.query.product === "string" ? req.query.product : "";
        const title = typeof req.query.title === "string" ? req.query.title : "";
        const link = typeof req.query.link === "string" ? req.query.link : "";
        const price = typeof req.query.price === "string" ? req.query.price : "";
        const discount = typeof req.query.discount === "string" ? req.query.discount : undefined;
        if (product && title && link && price) {
            selectors = {
                product,
                title,
                link,
                price,
                discount,
            };
        }
    }
    const payload = {
        url: String(req.query.url ?? ""),
        niche: typeof req.query.niche === "string" ? req.query.niche : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        selectors: selectors ?? undefined,
        site: typeof req.query.site === "string" ? req.query.site : undefined,
        baseUrl: typeof req.query.baseUrl === "string" ? req.query.baseUrl : undefined,
    };
    const isMercadoLivre = payload?.site?.includes("mercadolivre.com.br") ||
        payload?.url?.includes("mercadolivre.com.br");
    const finalUrl = payload?.url || (isMercadoLivre ? buildMercadoLivreUrl(payload?.niche) : "");
    if (!finalUrl) {
        res.status(400).json({
            error: "Informe url ou niche para Mercado Livre.",
        });
        return;
    }
    const requested = payload.limit ?? MAX_ITEMS;
    const limit = Math.min(requested, MAX_ITEMS);
    try {
        const items = await scrapeProducts({ ...payload, url: finalUrl });
        const sorted = items.sort((a, b) => a.finalPrice - b.finalPrice);
        res.json({
            count: Math.min(sorted.length, limit),
            items: sorted.slice(0, limit),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Erro inesperado.";
        res.status(500).json({ error: message });
    }
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
    console.log(`Scraper rodando na porta ${port}`);
});
