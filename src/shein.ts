import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

type Product = {
  title: string
  price: string
  link: string
  discount: string
}

function buildSheinUrl(query: string): string {
  const encoded = encodeURIComponent(query.trim())
  return `https://br.shein.com/pdsearch/${encoded}/`
}

function normalizePrice(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, '').trim()
  if (!cleaned) return Number.POSITIVE_INFINITY
  const normalized = cleaned.replace(/\./g, '').replace(',', '.')
  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function getSheinAuthPath(): string {
  const authDir = path.join(process.cwd(), '.auth')
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }
  return path.join(authDir, 'shein.json')
}

function getSheinUserDataDir(): string {
  const fromEnv = process.env.SHEIN_USER_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  const authDir = path.join(process.cwd(), '.auth', 'shein-profile')
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }
  return authDir
}

async function waitForUser(message: string): Promise<void> {
  const rl = readline.createInterface({ input, output })
  try {
    await rl.question(`${message}\n`)
  } finally {
    rl.close()
  }
}

async function handleSheinRisk(
  page: import('playwright').Page,
  context: import('playwright').BrowserContext,
  headless: boolean,
  authPath: string,
  usePersistent: boolean,
): Promise<boolean> {
  const url = page.url()
  const isRisk =
    url.includes('/risk/') ||
    url.includes('risk=') ||
    url.includes('/risk/action/limit')

  if (!isRisk) return true

  if (headless) {
    console.log(
      'Bloqueio da Shein detectado. Rode com HEADLESS=false para resolver.',
    )
    return false
  }

  console.log(
    'Bloqueio da Shein detectado. Resolva a verificacao no navegador.',
  )
  await waitForUser('Quando concluir, pressione Enter para continuar.')

  if (!usePersistent) {
    await context.storageState({ path: authPath })
  }

  return true
}

async function run(queryOrUrl: string): Promise<void> {
  const headless = process.env.HEADLESS !== 'false'
  const debug = true
  const authPath = getSheinAuthPath()
  const usePersistent = process.env.SHEIN_PERSISTENT_CONTEXT !== 'false'
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  let context: import('playwright').BrowserContext
  let closeContext: () => Promise<void>

  const launchArgs = ['--disable-blink-features=AutomationControlled']
  if (usePersistent) {
    const userDataDir = getSheinUserDataDir()
    context = await chromium.launchPersistentContext(userDataDir, {
      headless,
      args: launchArgs,
      userAgent,
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
    })
    closeContext = async () => {
      await context.close()
    }
  } else {
    const browser = await chromium.launch({ headless, args: launchArgs })
    context = await browser.newContext({
      userAgent,
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      storageState: fs.existsSync(authPath) ? authPath : undefined,
    })
    closeContext = async () => {
      await browser.close()
    }
  }

  const page = context.pages()[0] ?? (await context.newPage())
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    })
  })
  await page.setExtraHTTPHeaders({
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  })

  try {
    const isUrl = /^https?:\/\//i.test(queryOrUrl)
    const query = isUrl ? '' : queryOrUrl

    if (isUrl) {
      await page.goto(queryOrUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => null)
    } else {
      await page.goto('https://br.shein.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => null)

      const acceptSelectors = [
        '#onetrust-accept-btn-handler',
        "button:has-text('Aceitar')",
        "button:has-text('Accept')",
        "button[aria-label='Aceitar']",
        "button[aria-label='Accept']",
      ]
      for (const selector of acceptSelectors) {
        const button = await page.$(selector)
        if (button) {
          await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            button.click(),
          ])
          break
        }
      }

      const searchToggleSelectors = [
        "button[aria-label*='Buscar']",
        "button[aria-label*='Search']",
        "[data-testid='header-search']",
        '.header-search__icon',
        '.icon-search',
        "button:has-text('Buscar')",
      ]
      for (const selector of searchToggleSelectors) {
        const toggle = page.locator(selector).first()
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click({ timeout: 3000 }).catch(() => null)
          await page.waitForTimeout(300)
          break
        }
      }

      const searchSelectors = [
        '.search-input',
        "input[name='header-search']",
        "input[name='keyword']",
        "input[name='keywords']",
        "input[aria-label*='Buscar']",
        "input[placeholder*='Buscar']",
        "input[type='search']",
      ]

      let filled = false
      for (const selector of searchSelectors) {
        const input = page.locator(selector).first()
        const visible = await input.isVisible().catch(() => false)
        if (!visible) continue
        try {
          await input.click({ timeout: 3000 })
          await input.fill(query, { timeout: 5000 })
          await Promise.all([
            page.waitForLoadState('domcontentloaded'),
            input.press('Enter'),
          ])
          filled = true
          break
        } catch {
          continue
        }
      }

      if (!filled) {
        const url = buildSheinUrl(query)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page
          .waitForLoadState('networkidle', { timeout: 10000 })
          .catch(() => null)
      }

      if (!page.url().includes('/pdsearch/')) {
        const url = buildSheinUrl(query)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page
          .waitForLoadState('networkidle', { timeout: 10000 })
          .catch(() => null)
      }
    }

    const riskOk = await handleSheinRisk(
      page,
      context,
      headless,
      authPath,
      usePersistent,
    )
    if (!riskOk) {
      return
    }

    const acceptSelectors = [
      '#onetrust-accept-btn-handler',
      "button:has-text('Aceitar')",
      "button:has-text('Accept')",
      "button[aria-label='Aceitar']",
      "button[aria-label='Accept']",
    ]
    for (const selector of acceptSelectors) {
      const button = await page.$(selector)
      if (button) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded'),
          button.click(),
        ])
        break
      }
    }

    await page.waitForTimeout(1500)

    const results: Array<Product & { numericPrice: number }> = []
    const seenLinks = new Set<string>()

    const resultSelectors = [
      "[data-testid='product-card']",
      '.product-card',
      '.product-item',
      '.product-card__wrapper',
      '.product-item__wrapper',
    ]

    if (debug) {
      const debugInfo = await page.evaluate(() => {
        const selectors = [
          "[data-testid='product-card']",
          '.product-card',
          '.product-item',
          '.product-card__wrapper',
          '.product-item__wrapper',
          "a[href*='-p-']",
          "a[href*='/p/']",
        ]
        const counts = Object.fromEntries(
          selectors.map((selector) => [
            selector,
            document.querySelectorAll(selector).length,
          ]),
        )
        const sampleLinks = Array.from(
          document.querySelectorAll<HTMLAnchorElement>(
            "a[href*='-p-'], a[href*='/p/']",
          ),
        )
          .map((node) => node.getAttribute('href') || '')
          .filter(Boolean)
          .slice(0, 5)
        return {
          title: document.title,
          url: location.href,
          counts,
          sampleLinks,
        }
      })
      console.log('DEBUG_SHEIN', debugInfo)
    }

    let stagnation = 0
    while (results.length < 50) {
      const waitAttempts = await Promise.all(
        resultSelectors.map(async (selector) => {
          try {
            await page.waitForSelector(selector, {
              timeout: 20000,
              state: 'attached',
            })
            return true
          } catch {
            return false
          }
        }),
      )

      if (!waitAttempts.some(Boolean)) {
        break
      }

      const data = await page.evaluate(() => {
        const cardSelectors = [
          "[data-testid='product-card']",
          '.product-card',
          '.product-item',
          '.product-card__wrapper',
          '.product-item__wrapper',
        ]
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(cardSelectors.join(',')),
        )
        const sources = cards.length
          ? cards
          : Array.from(document.querySelectorAll<HTMLElement>("a[href*='-p-']"))

        return sources.map((item) => {
          const anchor =
            item instanceof HTMLAnchorElement
              ? item
              : (item.querySelector<HTMLAnchorElement>("a[href*='-p-']") ??
                item.querySelector<HTMLAnchorElement>("a[href*='/p/']") ??
                item.querySelector<HTMLAnchorElement>('a'))
          const titleFromImg =
            anchor?.querySelector<HTMLImageElement>('img[alt]')?.alt?.trim() ??
            anchor
              ?.querySelector<HTMLImageElement>('img[title]')
              ?.title?.trim() ??
            ''
          const title =
            item
              .querySelector("[data-testid='product-card-title']")
              ?.textContent?.trim() ??
            item.querySelector('.product-card__title')?.textContent?.trim() ??
            item.querySelector('.product-card__name')?.textContent?.trim() ??
            item.querySelector('.product-item__name')?.textContent?.trim() ??
            item.getAttribute('data-title')?.trim() ??
            item.getAttribute('data-name')?.trim() ??
            anchor?.getAttribute('aria-label')?.trim() ??
            anchor?.getAttribute('title')?.trim() ??
            titleFromImg ??
            anchor?.textContent?.trim() ??
            ''
          const priceText =
            item.querySelector("[data-testid*='price']")?.textContent?.trim() ??
            item.querySelector('.product-card__price')?.textContent?.trim() ??
            item.querySelector('.product-item__price')?.textContent?.trim() ??
            item.querySelector('.price')?.textContent?.trim() ??
            item.querySelector('.sale-price')?.textContent?.trim() ??
            ''
          const price =
            priceText ||
            item.textContent?.match(/R\$\s*[\d.,]+/)?.[0]?.trim() ||
            ''
          let link = anchor?.getAttribute('href') ?? ''
          if (link && !link.startsWith('http')) {
            link = new URL(link, window.location.origin).toString()
          }
          const discount =
            item
              .querySelector('.product-card__discount')
              ?.textContent?.trim() ??
            item.querySelector('.discount')?.textContent?.trim() ??
            item.querySelector('.product-card__tag')?.textContent?.trim() ??
            ''

          return { title, price, link, discount }
        })
      })

      const previousCount = results.length
      for (const item of data) {
        if (!item.link || !item.title || seenLinks.has(item.link)) continue
      if (!item.price?.trim()) continue
      const numericPrice = normalizePrice(item.price)
        if (
          !Number.isFinite(numericPrice) ||
          numericPrice === Number.POSITIVE_INFINITY
        )
          continue
        seenLinks.add(item.link)
        results.push({ ...item, numericPrice })
        if (results.length >= 50) break
      }

      if (results.length >= 50) break

      const nextButton = await page.$(
        "a[aria-label='Next'], button[aria-label='Next'], .pagination__next, .sui-pagination__next",
      )
      if (nextButton) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded'),
          nextButton.click(),
        ])
        await page.waitForTimeout(1500)
        stagnation = 0
        continue
      }

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight)
      })
      await page.waitForTimeout(1500)

      if (results.length === previousCount) {
        stagnation += 1
      } else {
        stagnation = 0
      }

      if (stagnation >= 2) break
    }

    if (!results.length) {
      const jsonLdProducts = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLScriptElement>(
            'script[type="application/ld+json"]',
          ),
        )
      const items: Array<{ name: string; price: string; url: string }> = []
        for (const node of nodes) {
          if (!node.textContent) continue
          try {
            const data = JSON.parse(node.textContent)
            const list = Array.isArray(data) ? data : [data]
            for (const entry of list) {
              const elements = entry?.itemListElement ?? entry?.itemList ?? []
              if (!Array.isArray(elements)) continue
              for (const element of elements) {
                const item = element?.item ?? element
                const name = item?.name ?? item?.title ?? ''
                const url = item?.url ?? ''
              const price =
                item?.offers?.price ??
                item?.offers?.lowPrice ??
                item?.offers?.highPrice ??
                ''
              if (name && url && price) {
                items.push({
                  name: String(name),
                  price: String(price),
                  url: String(url),
                })
              }
            }
          }
        } catch {
            continue
          }
        }
        return items.slice(0, 100)
      })

      for (const item of jsonLdProducts) {
        const link = item.url
        if (!link || seenLinks.has(link)) continue
        const numericPrice = normalizePrice(item.price)
        if (
          !Number.isFinite(numericPrice) ||
          numericPrice === Number.POSITIVE_INFINITY
        )
          continue
        seenLinks.add(link)
        results.push({
          title: item.name,
          price: item.price,
          link,
          discount: '',
          numericPrice,
        })
        if (results.length >= 50) break
      }
    }

    const top50 = results
      .sort((a, b) => a.numericPrice - b.numericPrice)
      .slice(0, 50)
      .map(({ numericPrice, ...rest }) => rest)

    console.log(top50)
  } finally {
    await closeContext()
  }
}

const queryOrUrl = process.argv.slice(2).join(' ').trim()
if (!queryOrUrl) {
  console.error('Uso: npm run shein -- "vestido" ou uma URL completa')
  process.exit(1)
}

void run(queryOrUrl)
