import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------
  // 1. SCRAPE NAVIGATION (Menu)
  // -------------------------------------------------------
  async scrapeNavigation() {
    this.logger.log('Clearing old navigation data...');
    await this.prisma.navigation.deleteMany({}); 

    this.logger.log('Starting new navigation scrape...');
    
    const categories: any[] = [];

    const crawler = new PlaywrightCrawler({
      headless: true, // <--- CRITICAL FIX: Must be true for Render
      maxRequestsPerCrawl: 5,
      launchContext: {
        launcher: chromium,
        launchOptions: { args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] },
      },
      requestHandler: async ({ page, log }) => {
        log.info(`Processing ${page.url()}`);
        await page.waitForTimeout(2000);

        try {
            const btn = await page.getByRole('button', { name: /accept|allow/i }).first();
            if (await btn.isVisible()) await btn.click();
        } catch {}

        try {
          await page.waitForSelector('header', { timeout: 5000 });
        } catch (e) {
          log.error('Could not find header');
          return;
        }

        const navItems = await page.$$eval('header a', (elements) => {
          return elements.map((el) => {
            const link = el as HTMLAnchorElement;
            return {
              title: link.innerText?.trim() || '',
              url: link.href || '',
            };
          }).filter(item => 
              item.title.length > 2 && 
              item.url.includes('worldofbooks.com') &&
              !item.url.includes('video-games') &&
              !item.url.includes('dvd') &&
              !item.url.includes('cd-') &&
              !item.url.includes('music')
          );
        });

        const uniqueItems = Array.from(new Map(navItems.map(item => [item.title, item])).values());
        categories.push(...uniqueItems);
      },
    });

    await crawler.run(['https://www.worldofbooks.com/']);

    this.logger.log(`Found ${categories.length} items. Saving to database...`);

    for (const item of categories) {
      const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) continue;

      await this.prisma.navigation.upsert({
        where: { slug: slug },
        update: { 
            title: item.title, 
            url: item.url, 
            last_scraped_at: new Date() 
        },
        create: { 
            title: item.title, 
            slug: slug,
            url: item.url 
        },
      });
    }

    this.logger.log('Database update complete!');
    return this.prisma.navigation.findMany({ orderBy: { title: 'asc' }});
  }

  // -------------------------------------------------------
  // 2. SCRAPE CATEGORY (Smart Matching + 50 Books)
  // -------------------------------------------------------
  async scrapeCategory(categorySlug: string) {
    this.logger.log(`Looking up category: ${categorySlug}...`);

    // FIX: Smart Lookup. Try exact match first.
    let navItem = await this.prisma.navigation.findFirst({
      where: { slug: categorySlug }
    });

    // FIX: If not found, try removing "-books" (e.g. history-books -> history)
    if (!navItem) {
        const simpleSlug = categorySlug.replace('-books', '');
        this.logger.warn(`Exact match for '${categorySlug}' not found. Trying '${simpleSlug}'...`);
        navItem = await this.prisma.navigation.findFirst({
            where: { slug: simpleSlug }
        });
    }

    if (!navItem) {
        // Log available options to help debug
        const available = await this.prisma.navigation.findMany({ select: { slug: true } });
        this.logger.error(`Available slugs: ${available.map(a => a.slug).join(', ')}`);
        throw new Error(`Category '${categorySlug}' not found. Run navigation scrape first.`);
    }

    let category = await this.prisma.category.findFirst({
        where: { navigation_id: navItem.id }
    });

    if (!category) {
        this.logger.log(`Creating new category entry for ${navItem.title}...`);
        category = await this.prisma.category.create({
            data: {
                title: navItem.title,
                slug: navItem.slug,
                navigation_id: navItem.id,
                last_scraped_at: new Date()
            }
        });
    }

    this.logger.log(`Targeting URL: ${navItem.url}`);
    const products: any[] = [];

    const crawler = new PlaywrightCrawler({
      headless: true, // <--- CRITICAL FIX: Must be true for Render
      maxRequestsPerCrawl: 50, // <--- UPGRADE: Unlocked to 50 books!
      launchContext: {
        launcher: chromium,
        launchOptions: { args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] },
      },
      requestHandler: async ({ page, log }) => {
        log.info(`Scraping products from ${page.url()}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000); 

        try {
            const btn = await page.getByRole('button', { name: /accept|allow/i }).first();
            if (await btn.isVisible()) await btn.click();
        } catch {}

        const items = await page.$$eval('a', (links) => {
          return links.map((link) => {
             const card = link.closest('li') || link.closest('div[class*="item"]') || link.closest('div[class*="Item"]') || link.parentElement?.parentElement;
             
             if (!card) return null;

             const fullText = card.innerText || "";
             if (!fullText.includes('£')) return null;

             const titleElement = card.querySelector('h3') || card.querySelector('.title') || link.querySelector('img');
             let title = "";
             if (titleElement) {
                title = titleElement['innerText'] || titleElement['alt'] || "";
             }
             if (!title || title.length < 3) title = link.innerText;

             const priceMatch = fullText.match(/£\d+\.\d{2}/);
             const price = priceMatch ? priceMatch[0] : null;

             const imgEl = card.querySelector('img');
             let img = imgEl?.src;
             if (imgEl && img && (img.includes('data:image') || img.length < 100)) {
                 img = imgEl.getAttribute('data-src') || imgEl.getAttribute('srcset') || img;
             }

             title = title.replace(/\n/g, ' ').trim();

             if (!title || !price || title.includes('£')) return null;

             const sourceId = title.replace(/\s+/g, '-').toLowerCase().slice(0, 50);
             
             // Save the REAL link to the product page
             return { title, price, image_url: img, source_id: sourceId, product_url: link.href };
          }).filter(p => p !== null); 
        });

        const unique = Array.from(new Map(items.map(i => [i.title, i])).values());
        products.push(...unique);
      },
    });

    await crawler.run([navItem.url]);

    this.logger.log(`Found ${products.length} books.`);
    
    if (products.length === 0) return [];

    for (const p of products) {
        await this.prisma.product.upsert({
            where: { source_id: p.source_id },
            update: {
                title: p.title,
                price: p.price,
                image_url: p.image_url,
                source_url: p.product_url || `https://www.worldofbooks.com/product/${p.source_id}`,
                last_scraped_at: new Date(),
                category_id: category.id
            },
            create: {
                source_id: p.source_id,
                title: p.title,
                price: p.price,
                image_url: p.image_url,
                source_url: p.product_url || `https://www.worldofbooks.com/product/${p.source_id}`,
                category_id: category.id
            }
        });
    }

    return products;
  }

  // -------------------------------------------------------
  // 3. SCRAPE PRODUCT DETAILS
  // -------------------------------------------------------
  async scrapeProductDetail(sourceId: string) {
    this.logger.log(`Fetching details for product: ${sourceId}...`);

    const product = await this.prisma.product.findUnique({
      where: { source_id: sourceId },
      include: { details: true } 
    });

    if (!product) throw new Error('Product not found in database.');
    if (product.details) {
        this.logger.log('Returning cached details.');
        return product;
    }

    this.logger.log(`Scraping product page: ${product.source_url}`);
    let detailsData: any = {};

    const crawler = new PlaywrightCrawler({
      headless: true, // <--- CRITICAL FIX: Must be true for Render
      launchContext: {
        launcher: chromium,
        launchOptions: { args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] },
      },
      requestHandler: async ({ page, log }) => {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000);

        try {
            const btn = await page.getByRole('button', { name: /accept|allow/i }).first();
            if (await btn.isVisible()) await btn.click();
        } catch {}

        const description = await page.$eval('.description, #description, [class*="Description"], meta[name="description"]', (el) => {
            return (el as HTMLMetaElement).content || el.textContent || "";
        }).catch(() => "No description available.");

        const extraInfo = await page.$$eval('li, tr', (rows) => {
            let data: any = {};
            rows.forEach(row => {
                const text = row instanceof HTMLElement ? row.innerText : row.textContent || "";
                if (text.includes('ISBN')) data.isbn = text.replace('ISBN', '').trim();
                if (text.includes('Author')) data.author = text.replace('Author', '').trim();
                if (text.includes('Publisher')) data.publisher = text.replace('Publisher', '').trim();
            });
            return data;
        });

        detailsData = {
            description: description.slice(0, 1000),
            isbn: extraInfo.isbn || null,
            publisher: extraInfo.publisher || null,
            author: extraInfo.author || null 
        };
      },
    });

    try {
        await crawler.run([product.source_url]);
    } catch (e) {
        this.logger.error(`Failed to crawl product URL: ${product.source_url}`);
    }

    await this.prisma.productDetail.create({
        data: {
            product_id: product.id,
            description: detailsData.description || "Details not available",
            isbn: detailsData.isbn,
            publisher: detailsData.publisher
        }
    });

    return this.prisma.product.findUnique({
        where: { id: product.id },
        include: { details: true }
    });
  }

  // -------------------------------------------------------
  // 4. SEARCH BOOKS
  // -------------------------------------------------------
  async searchBooks(query: string) {
    this.logger.log(`Searching for: ${query}`);
    return this.prisma.product.findMany({
      where: {
        title: {
          contains: query,
          mode: 'insensitive', 
        },
      },
      take: 20, 
    });
  }

  // -------------------------------------------------------
  // 5. GET BOOKS (With Pagination) - NEW
  // -------------------------------------------------------
  async getBooksByCategory(categorySlug: string, page: number = 1) {
    const pageSize = 12; // Show 12 books per page
    const skip = (page - 1) * pageSize;

    // Smart Lookup Here Too
    let navItem = await this.prisma.navigation.findFirst({ where: { slug: categorySlug } });
    if (!navItem) {
        navItem = await this.prisma.navigation.findFirst({ where: { slug: categorySlug.replace('-books', '') } });
    }

    if (!navItem) return { books: [], total: 0 };

    const category = await this.prisma.category.findFirst({
        where: { navigation_id: navItem.id }
    });

    if (!category) return { books: [], total: 0 };

    const total = await this.prisma.product.count({
        where: { category_id: category.id }
    });

    const books = await this.prisma.product.findMany({
      where: { category_id: category.id },
      take: pageSize,
      skip: skip,
      orderBy: { id: 'asc' }
    });

    return { books, total, page, totalPages: Math.ceil(total / pageSize) };
  }
}