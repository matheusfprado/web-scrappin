import { chromium } from "playwright";

type Product = {
  title: string;
  price: string;
  link: string;
  discount: string;
};

function buildAmazonUrl(query: string): string {
  const encoded = encodeURIComponent(query.trim());
  return `https://www.amazon.com.br/s?k=${encoded}`;
}

function normalizePrice(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return Number.POSITIVE_INFINITY;
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

async function run(queryOrUrl: string): Promise<void> {
  const headless = process.env.HEADLESS !== "false";
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  await page.setExtraHTTPHeaders({
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  });

  const isUrl = /^https?:\/\//i.test(queryOrUrl);
  const query = isUrl ? "" : queryOrUrl;

  if (isUrl) {
    await page.goto(queryOrUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  } else {
    await page.goto("https://www.amazon.com.br/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForSelector("#twotabsearchtextbox", { timeout: 30000 });
    await page.fill("#twotabsearchtextbox", query);
    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      page.click("#nav-search-submit-button"),
    ]);

    const url = buildAmazonUrl(query);
    if (!page.url().includes("/s?") && !page.url().includes("/s/")) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    }
  }

  const acceptSelectors = ["#sp-cc-accept", "input[name='accept']"];
  for (const selector of acceptSelectors) {
    const button = await page.$(selector);
    if (button) {
      await Promise.all([page.waitForLoadState("domcontentloaded"), button.click()]);
      break;
    }
  }

  await page.waitForTimeout(1500);

  const results: Array<Product & { numericPrice: number }> = [];
  const seenLinks = new Set<string>();

  const resultSelectors = [
    "[data-component-type='s-search-result']",
    ".s-main-slot .s-result-item[data-asin]",
    ".s-main-slot .s-card-container",
  ];

  while (results.length < 50) {
    const waitAttempts = await Promise.all(
      resultSelectors.map(async (selector) => {
        try {
          await page.waitForSelector(selector, { timeout: 30000, state: "attached" });
          return true;
        } catch {
          return false;
        }
      })
    );

    if (!waitAttempts.some(Boolean)) {
      break;
    }

    const data = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          "[data-component-type='s-search-result'], .s-main-slot .s-result-item[data-asin], .s-main-slot .s-card-container"
        )
      ).map((item) => {
        const anchor =
          item.querySelector<HTMLAnchorElement>("h2 a.a-link-normal") ??
          item.querySelector<HTMLAnchorElement>("a.a-link-normal.s-no-outline");
        const title =
          item.querySelector("h2 span")?.textContent?.trim() ??
          anchor?.textContent?.trim() ??
          anchor?.getAttribute("title")?.trim() ??
          "";
        const price =
          item.querySelector(".a-price .a-offscreen")?.textContent?.trim() ?? "";
        const link = anchor?.href ?? "";
        const discount =
          item.querySelector(".a-text-price .a-offscreen")?.textContent?.trim() ??
          item.querySelector(".a-price.a-text-price .a-offscreen")?.textContent?.trim() ??
          item.querySelector(".s-coupon-highlight-color")?.textContent?.trim() ??
          item.querySelector(".a-badge-text")?.textContent?.trim() ??
          "";

        return { title, price, link, discount };
      });
    });

    for (const item of data) {
      if (!item.link || !item.title || seenLinks.has(item.link)) continue;
      if (!item.price?.trim()) continue;
      const numericPrice = normalizePrice(item.price);
      if (!Number.isFinite(numericPrice) || numericPrice === Number.POSITIVE_INFINITY) continue;
      seenLinks.add(item.link);
      results.push({ ...item, numericPrice });
      if (results.length >= 50) break;
    }

    if (results.length >= 50) break;

    const nextButton = await page.$(
      ".s-pagination-next:not(.s-pagination-disabled)"
    );
    if (!nextButton) break;

    await Promise.all([
      page.waitForLoadState("domcontentloaded"),
      nextButton.click(),
    ]);
    await page.waitForTimeout(1500);
  }

  const top50 = results
    .sort((a, b) => a.numericPrice - b.numericPrice)
    .slice(0, 50)
    .map(({ numericPrice, ...rest }) => rest);

  console.log(top50);
  await browser.close();
}

const queryOrUrl = process.argv.slice(2).join(" ").trim();
if (!queryOrUrl) {
  console.error("Uso: npm run amazon -- \"iphone 14\" ou uma URL completa");
  process.exit(1);
}

void run(queryOrUrl);
