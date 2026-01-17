import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------
  // 1. SCRAPE NAVIGATION (Fixed URLs + No Delete)
  // -------------------------------------------------------
  async scrapeNavigation() {
    this.logger.log('Updating navigation with correct URLs...');
    
    // 1. Hardcoded "Safety List" with YOUR EXACT URLS
    const categories = [
        { title: 'Fiction', url: 'https://www.worldofbooks.com/en-gb/collections/fiction-books', slug: 'fiction-books' },
        { title: 'Non-Fiction', url: 'https://www.worldofbooks.com/en-gb/collections/non-fiction-books', slug: 'non-fiction-books' },
        { title: 'Children\'s', url: 'https://www.worldofbooks.com/en-gb/collections/childrens-books', slug: 'childrens-books' },
        { title: 'Rare Books', url: 'https://www.worldofbooks.com/en-gb/rare-books', slug: 'rare-books' },
        { title: 'History', url: 'https://www.worldofbooks.com/en-gb/collections/history-books', slug: 'history-books' },
        { title: 'Adventure', url: 'https://www.worldofbooks.com/en-gb/collections/adventure-books', slug: 'adventure-books' }
    ];

    // 2. Upsert (Update or Insert) - NEVER DELETE
    for (const item of categories) {
      await this.prisma.navigation.upsert({
        where: { slug: item.slug },
        update: { 
            title: item.title, 
            url: item.url, 
            last_scraped_at: new Date() 
        },
        create: { 
            title: item.title, 
            slug: item.slug,
            url: item.url 
        },
      });
    }

    this.logger.log('Database navigation updated successfully!');
    return this.prisma.navigation.findMany({ orderBy: { title: 'asc' }});
  }

  // -------------------------------------------------------
  // 2. SCRAPE CATEGORY (Low Memory Mode)
  // -------------------------------------------------------
  async scrapeCategory(categorySlug: string) {
    this.logger.log(`Looking up category: ${categorySlug}...`);

    let navItem = await this.prisma.navigation.findFirst({
      where: { slug: categorySlug }
    });

    // Smart Lookup
    if (!navItem) {
        const simpleSlug = categorySlug.replace('-books', '');
        navItem = await this.prisma.navigation.findFirst({
            where: { slug: simpleSlug }
        });
    }

    // Fallback: Manually construct the CORRECT URL if not in DB
    if (!navItem) {
        const cleanSlug = categorySlug.includes('-books') ? categorySlug : `${categorySlug}-books`;
        navItem = { 
            id: 999, 
            title: categorySlug, 
            slug: categorySlug, 
            // 👇 FORCING THE CORRECT URL STRUCTURE
            url: `https://www.worldofbooks.com/en-gb/collections/${cleanSlug}`,
            last_scraped_at: new Date() 
        };
        this.logger.warn(`Using fallback URL: ${navItem!.url}`);
    }

    // Ensure Category Exists
    let category = await this.prisma.category.findFirst({ where: { slug: navItem!.slug } });
    if (!category && navItem!.id !== 999) {
        category = await this.prisma.category.create({
            data: { title: navItem!.title, slug: navItem!.slug, navigation_id: navItem!.id, last_scraped_at: new Date() }
        });
    }

    this.logger.log(`Targeting URL: ${navItem!.url}`);
    const products: any[] = [];

    const crawler = new PlaywrightCrawler({
      headless: true,
      maxRequestsPerCrawl: 10, // Keep low to prevent memory crash
      requestHandlerTimeoutSecs: 60, // Give it time to load slowly
      launchContext: {
        launcher: chromium,
        launchOptions: { 
            // 👇 FLAGS TO REDUCE MEMORY USAGE
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--disable-extensions' 
            ] 
        },
      },
      requestHandler: async ({ page, log }) => {
        // 👇 AGGRESSIVE BLOCKING: Block Images, Fonts, CSS to save RAM
        await page.route('**/*.{png,jpg,jpeg,svg,gif,webp,css,woff,woff2,ico,js,json}', route => route.abort());

        log.info(`Scraping products from ${page.url()}`);
        
        try {
            // "domcontentloaded" is faster and uses less memory than "networkidle"
            await page.goto(navItem!.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch {
            log.warning('Page load timeout - attempting to scrape whatever loaded...');
        }

        try {
            const btn = await page.getByRole('button', { name: /accept|allow/i }).first();
            if (await btn.isVisible()) await btn.click();
        } catch {}

        // 👇 UPDATED SELECTOR LOGIC FOR "COLLECTIONS" PAGES
        const items = await page.$$eval('a', (links) => {
          return links.map((link) => {
             // Look for parent container
             const card = link.closest('li') || link.closest('div[class*="item"]') || link.closest('div[class*="Item"]') || link.parentElement?.parentElement;
             if (!card) return null;
             
             const fullText = card.innerText || "";
             if (!fullText.includes('£')) return null;

             let title = "";
             // Try standard title classes
             const titleEl = card.querySelector('h3') || card.querySelector('.title') || card.querySelector('[class*="Title"]');
             if (titleEl) title = titleEl['innerText'];
             if (!title) title = link.innerText;

             const priceMatch = fullText.match(/£\d+\.\d{2}/);
             const price = priceMatch ? priceMatch[0] : null;

             const imgEl = card.querySelector('img');
             let img = imgEl?.src;
             if (imgEl) img = imgEl.getAttribute('data-src') || imgEl.getAttribute('srcset') || imgEl.src;

             title = title?.replace(/\n/g, ' ').trim();
             // Strict check: Title must be longer than 2 chars, and we must have a price
             if (!title || title.length < 2 || !price) return null;

             const sourceId = title.replace(/\s+/g, '-').toLowerCase().slice(0, 50);
             return { title, price, image_url: img, source_id: sourceId, product_url: link.href };
          }).filter(p => p !== null); 
        });

        const unique = Array.from(new Map(items.map(i => [i.title, i])).values());
        products.push(...unique);
      },
    });

    try {
        await crawler.run([navItem.url]);
    } catch (e) {
        this.logger.error("Crawl failed slightly, but continuing with what we found.");
    }

    this.logger.log(`Found ${products.length} books.`);
    
    // Safety: If 0 books found, return empty (Frontend handles empty state)
    if (products.length === 0) return [];

    // Save to Database
    if (category && category.id) {
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
    }

    return products;
  }

  // -------------------------------------------------------
  // 3. SCRAPE PRODUCT DETAILS
  // -------------------------------------------------------
  async scrapeProductDetail(sourceId: string) {
    const product = await this.prisma.product.findUnique({
      where: { source_id: sourceId },
      include: { details: true } 
    });

    if (!product) throw new Error('Product not found in database.');
    if (product.details) return product;

    let detailsData: any = {};
    const crawler = new PlaywrightCrawler({
      headless: true,
      launchContext: {
        launcher: chromium,
        launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
      },
      requestHandler: async ({ page }) => {
        await page.route('**/*.{png,jpg,jpeg,svg,css,js}', route => route.abort());
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
            const description = await page.$eval('.description, #description, meta[name="description"]', (el) => {
                return (el as HTMLMetaElement).content || el.textContent || "";
            }).catch(() => "No description available.");
            detailsData = { description: description.slice(0, 1000) };
        } catch {
             detailsData = { description: "Description loading timed out." };
        }
      },
    });

    try { await crawler.run([product.source_url]); } catch (e) {}

    await this.prisma.productDetail.create({
        data: {
            product_id: product.id,
            description: detailsData.description || "Details not available",
        }
    });

    return this.prisma.product.findUnique({
        where: { id: product.id },
        include: { details: true }
    });
  }

  async searchBooks(query: string) {
    return this.prisma.product.findMany({
      where: { title: { contains: query, mode: 'insensitive' } },
      take: 20, 
    });
  }

  async getBooksByCategory(categorySlug: string, page: number = 1) {
    const pageSize = 12;
    const skip = (page - 1) * pageSize;

    let navItem = await this.prisma.navigation.findFirst({ where: { slug: categorySlug } });
    if (!navItem) navItem = await this.prisma.navigation.findFirst({ where: { slug: categorySlug.replace('-books', '') } });

    if (!navItem) return { books: [], total: 0 };

    const category = await this.prisma.category.findFirst({
        where: { navigation_id: navItem.id }
    });

    if (!category) return { books: [], total: 0 };

    const total = await this.prisma.product.count({ where: { category_id: category.id } });
    const books = await this.prisma.product.findMany({
      where: { category_id: category.id },
      take: pageSize,
      skip: skip,
      orderBy: { id: 'asc' }
    });

    return { books, total, page, totalPages: Math.ceil(total / pageSize) };
  }
}