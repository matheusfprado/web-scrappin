"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const XLSX = __importStar(require("xlsx"));
function buildMercadoLivreUrl(query) {
    const slug = query
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    return `https://lista.mercadolivre.com.br/${slug}`;
}
function buildExcelPath(query) {
    const safeQuery = query
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
    const outDir = node_path_1.default.join(process.cwd(), 'output');
    if (!node_fs_1.default.existsSync(outDir)) {
        node_fs_1.default.mkdirSync(outDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return node_path_1.default.join(outDir, `mercado-livre-${safeQuery}-${stamp}.xlsx`);
}
function saveAsExcel(items, outputPath) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(items);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Resultados');
    XLSX.writeFile(workbook, outputPath);
}
async function run(query) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
    });
    const url = buildMercadoLivreUrl(query);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const results = [];
    const seenLinks = new Set();
    while (results.length < 50) {
        await page.waitForSelector('.ui-search-layout__item', {
            timeout: 30000,
            state: 'attached',
        });
        const data = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.ui-search-layout__item')).map((item) => {
                const titleAnchor = item.querySelector('.poly-component__title-wrapper a') ?? item.querySelector('.ui-search-link');
                const title = item.querySelector('.ui-search-item__title')?.textContent?.trim() ??
                    titleAnchor?.textContent?.trim() ??
                    titleAnchor?.getAttribute('title')?.trim() ??
                    titleAnchor?.getAttribute('aria-label')?.trim() ??
                    '';
                const price = item
                    .querySelector('.andes-money-amount__fraction')
                    ?.textContent?.trim() ?? '';
                const link = titleAnchor?.href ?? '';
                const discount = item
                    .querySelector('.ui-search-price__discount')
                    ?.textContent?.trim() ??
                    item
                        .querySelector('.ui-search-item__discount')
                        ?.textContent?.trim() ??
                    '';
                return { title, price, link, discount };
            });
        });
        for (const item of data) {
            if (!item.link || seenLinks.has(item.link))
                continue;
            seenLinks.add(item.link);
            results.push(item);
            if (results.length >= 50)
                break;
        }
        if (results.length >= 50)
            break;
        const nextButton = await page.$(".andes-pagination__button--next:not([aria-disabled='true'])");
        if (!nextButton)
            break;
        await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            nextButton.click(),
        ]);
    }
    const withNumbers = results.map((item) => {
        const numeric = Number.parseFloat(item.price.replace(/\./g, '').replace(',', '.'));
        return {
            ...item,
            numericPrice: Number.isFinite(numeric)
                ? numeric
                : Number.POSITIVE_INFINITY,
        };
    });
    const top5 = withNumbers
        .sort((a, b) => a.numericPrice - b.numericPrice)
        .slice(0, 50)
        .map(({ numericPrice, ...rest }) => rest);
    const outputPath = buildExcelPath(query);
    saveAsExcel(top5, outputPath);
    console.log(`Arquivo Excel gerado em: ${outputPath}`);
    console.log(top5);
    await browser.close();
}
const query = process.argv.slice(2).join(' ').trim();
if (!query) {
    console.error('Uso: npm run ml -- "iphone 14"');
    process.exit(1);
}
void run(query);
