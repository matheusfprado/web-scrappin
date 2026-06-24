import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

type Product = {
  title: string
  price: string
  link: string
  discount: string
}

function buildMercadoLivreUrl(query: string): string {
  const slug = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  return `https://lista.mercadolivre.com.br/${slug}`
}

function buildExcelPath(query: string): string {
  const safeQuery = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  const outDir = path.join(process.cwd(), 'output')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(outDir, `mercado-livre-${safeQuery}-${stamp}.xlsx`)
}

function saveAsExcel(items: Product[], outputPath: string): void {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(items)
  XLSX.utils.book_append_sheet(workbook, sheet, 'Resultados')
  XLSX.writeFile(workbook, outputPath)
}

async function run(query: string): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  })

  const url = buildMercadoLivreUrl(query)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const results: Product[] = []
  const seenLinks = new Set<string>()

  while (results.length < 50) {
    await page.waitForSelector('.ui-search-layout__item', {
      timeout: 30000,
      state: 'attached',
    })

    const data = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll('.ui-search-layout__item'),
      ).map((item) => {
        const titleAnchor =
          item.querySelector<HTMLAnchorElement>(
            '.poly-component__title-wrapper a',
          ) ?? item.querySelector<HTMLAnchorElement>('.ui-search-link')
        const title =
          item.querySelector('.ui-search-item__title')?.textContent?.trim() ??
          titleAnchor?.textContent?.trim() ??
          titleAnchor?.getAttribute('title')?.trim() ??
          titleAnchor?.getAttribute('aria-label')?.trim() ??
          ''
        const price =
          item
            .querySelector('.andes-money-amount__fraction')
            ?.textContent?.trim() ?? ''
        const link = titleAnchor?.href ?? ''
        const discount =
          item
            .querySelector('.ui-search-price__discount')
            ?.textContent?.trim() ??
          item
            .querySelector('.ui-search-item__discount')
            ?.textContent?.trim() ??
          ''

        return { title, price, link, discount }
      })
    })

    for (const item of data) {
      if (!item.link || seenLinks.has(item.link)) continue
      seenLinks.add(item.link)
      results.push(item)
      if (results.length >= 50) break
    }

    if (results.length >= 50) break

    const nextButton = await page.$(
      ".andes-pagination__button--next:not([aria-disabled='true'])",
    )
    if (!nextButton) break

    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      nextButton.click(),
    ])
  }

  const withNumbers = results.map((item) => {
    const numeric = Number.parseFloat(
      item.price.replace(/\./g, '').replace(',', '.'),
    )
    return {
      ...item,
      numericPrice: Number.isFinite(numeric)
        ? numeric
        : Number.POSITIVE_INFINITY,
    }
  })

  const top5 = withNumbers
    .sort((a, b) => a.numericPrice - b.numericPrice)
    .slice(0, 50)
    .map(({ numericPrice, ...rest }) => rest)

  const outputPath = buildExcelPath(query)
  saveAsExcel(top5, outputPath)
  console.log(`Arquivo Excel gerado em: ${outputPath}`)
  console.log(top5)
  await browser.close()
}

const query = process.argv.slice(2).join(' ').trim()
if (!query) {
  console.error('Uso: npm run ml -- "iphone 14"')
  process.exit(1)
}

void run(query)
