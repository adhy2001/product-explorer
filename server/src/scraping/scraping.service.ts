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
    
    let categories: any[] = [];

    // 1. Try to Scrape Real Data
    try {
        const crawler = new PlaywrightCrawler({
          headless: true,
          maxRequestsPerCrawl: 5,
          requestHandlerTimeoutSecs: 30, // Timeout faster if stuck
          launchContext: {
            launcher: chromium,
            launchOptions: { 
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox', 
                    '--disable-dev-shm-usage', // Critical for Docker/Render
                    '--disable-gpu'
                ] 
            },
          },
          requestHandler: async ({ page, log }) => {
            // OPTIMIZATION: Block images and fonts to save memory!
            await page.route('**/*.{png,jpg,jpeg,svg,css,woff,woff2}', route => route.abort());
            
            log.info(`Processing ${page.url()}`);
            await page.waitForTimeout(1000);

            // Try to find header links
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
    } catch (e) {
        this.logger.error('Scraping failed, switching to backup mode.');
    }

    // 2. THE SAFETY NET: If scraping failed or found nothing, use Backup Data
    if (categories.length === 0) {
        this.logger.warn('⚠️ Scraping found 0 items. Using BACKUP CATEGORIES to ensure app works.');
        categories = [
            { title: 'Fiction', url: 'https://www.worldofbooks.com/en-gb/category/fiction-books' },
            { title: 'Non-Fiction', url: 'https://www.worldofbooks.com/en-gb/category/non-fiction-books' },
            { title: 'Children\'s', url: 'https://www.worldofbooks.com/en-gb/category/childrens-books' },
            { title: 'Rare Books', url: 'https://www.worldofbooks.com/en-gb/rare-books' },
            { title: 'History', url: 'https://www.worldofbooks.com/en-gb/category/history-books' },
            { title: 'Adventure', url: 'https://www.worldofbooks.com/en-gb/category/adventure-books' }
        ];
    }

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
  // 2. SCRAPE CATEGORY
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

    if (!navItem) {
        // Double check fallback for common IDs
        if (categorySlug.includes('history')) navItem = { id: 999, title: 'History', slug: 'history-books', url: 'https://www.worldofbooks.com/en-gb/category/history-books', created_at: new Date(), last_scraped_at: new Date() } as any;
        else if (categorySlug.includes('fiction')) navItem = { id: 998, title: 'Fiction', slug: 'fiction-books', url: 'https://www.worldofbooks.com/en-gb/category/fiction-books', created_at: new Date(), last_scraped_at: new Date() } as any;
        else throw new Error(`Category '${categorySlug}' not found. Run navigation scrape first.`);
    }

    if (!navItem) {
        this.logger.error(`Navigation item for category '${categorySlug}' could not be determined.`);
        return [];
    }

    // Ensure Category Exists
    let category = await this.prisma.category.findFirst({
        where: { slug: navItem.slug }
    });

    if (!category) {
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
      headless: true,
      maxRequestsPerCrawl: 30, // Reduced slightly for stability
      launchContext: {
        launcher: chromium,
        launchOptions: { 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
        },
      },
      requestHandler: async ({ page, log }) => {
        // BLOCK IMAGES & CSS TO SAVE MEMORY
        await page.route('**/*.{png,jpg,jpeg,svg,css,woff,woff2}', route => route.abort());

        log.info(`Scraping products from ${page.url()}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(2000); 

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

             let title = "";
             const titleEl = card.querySelector('h3') || card.querySelector('.title');
             if (titleEl) title = titleEl['innerText'];
             if (!title) title = link.innerText;

             const priceMatch = fullText.match(/£\d+\.\d{2}/);
             const price = priceMatch ? priceMatch[0] : null;

             const imgEl = card.querySelector('img');
             let img = imgEl?.src || '';
             if (imgEl && (img.includes('data:') || !img)) img = imgEl.getAttribute('data-src') || imgEl.getAttribute('srcset') || '';

             title = title?.replace(/\n/g, ' ').trim();
             if (!title || !price) return null;

             const sourceId = title.replace(/\s+/g, '-').toLowerCase().slice(0, 50);
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
    if (product.details) return product;

    let detailsData: any = {};
    const crawler = new PlaywrightCrawler({
      headless: true,
      launchContext: {
        launcher: chromium,
        launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
      },
      requestHandler: async ({ page }) => {
        await page.route('**/*.{png,jpg,jpeg,svg,css}', route => route.abort());
        await page.waitForLoadState('domcontentloaded');
        const description = await page.$eval('.description, #description, meta[name="description"]', (el) => {
            return (el as HTMLMetaElement).content || el.textContent || "";
        }).catch(() => "No description available.");
        detailsData = { description: description.slice(0, 1000) };
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

  // -------------------------------------------------------
  // 4. SEARCH BOOKS
  // -------------------------------------------------------
  async searchBooks(query: string) {
    return this.prisma.product.findMany({
      where: { title: { contains: query, mode: 'insensitive' } },
      take: 20, 
    });
  }

  // -------------------------------------------------------
  // 5. GET BOOKS BY CATEGORY
  // -------------------------------------------------------
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