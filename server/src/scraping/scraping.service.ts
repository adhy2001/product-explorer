import { Injectable, Logger } from '@nestjs/common';
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------
  // 1. SCRAPE NAVIGATION (Fixed: No Deletion)
  // -------------------------------------------------------
  async scrapeNavigation() {
    // REMOVED: await this.prisma.navigation.deleteMany({}); <--- THIS WAS THE CAUSE OF THE CRASH
    
    this.logger.log('Starting navigation update...');
    
    // 1. Use the Hardcoded "Safety List" (Guaranteed to work)
    let categories = [
        { title: 'Fiction', url: 'https://www.worldofbooks.com/en-gb/collections/fiction-books', slug: 'fiction-books' },
        { title: 'Non-Fiction', url: 'https://www.worldofbooks.com/en-gb/collections/non-fiction-books', slug: 'non-fiction-books' },
        { title: 'Children\'s', url: 'https://www.worldofbooks.com/en-gb/collections/childrens-books', slug: 'childrens-books' },
        { title: 'Rare Books', url: 'https://www.worldofbooks.com/en-gb/rare-books', slug: 'rare-books' },
        { title: 'History', url: 'https://www.worldofbooks.com/en-gb/collections/history-books', slug: 'history-books' },
        { title: 'Adventure', url: 'https://www.worldofbooks.com/en-gb/collections/adventure-books', slug: 'adventure-books' }
    ];

    this.logger.log(`Upserting ${categories.length} categories...`);

    // 2. Save/Update them in the Database
    for (const item of categories) {
      await this.prisma.navigation.upsert({
        where: { slug: item.slug }, // If this slug exists...
        update: { 
            title: item.title, 
            url: item.url, 
            last_scraped_at: new Date() 
        }, // ...update it.
        create: { 
            title: item.title, 
            slug: item.slug,
            url: item.url 
        }, // If not, create it.
      });
    }

    this.logger.log('Database navigation updated successfully!');
    return this.prisma.navigation.findMany({ orderBy: { title: 'asc' }});
  }

  // -------------------------------------------------------
  // 2. SCRAPE CATEGORY (Memory Optimized)
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

    // Fallback: If not found in DB, construct manually
    if (!navItem) {
        const cleanSlug = categorySlug.includes('-books') ? categorySlug : `${categorySlug}-books`;
        navItem = { 
            id: 999, 
            title: categorySlug, 
            slug: categorySlug, 
            url: `https://www.worldofbooks.com/en-gb/collections/${cleanSlug}`,
            created_at: new Date(), 
            last_scraped_at: new Date() 
        } as any;
    }

    // Ensure Category Exists
    if (!navItem) {
        this.logger.warn('Navigation item is null, cannot proceed with category lookup.');
        return [];
    }
    let category = await this.prisma.category.findFirst({ where: { slug: navItem.slug } });
    if (!category) {
        // Handle "Category does not exist" creation logic safely
        // We use upsert on the Navigation ID to allow it to link properly
        if (navItem && navItem.id !== 999) {
             category = await this.prisma.category.create({
                data: { title: navItem.title, slug: navItem.slug, navigation_id: navItem.id, last_scraped_at: new Date() }
            });
        } else {
             // If using dummy navItem, we can't link foreign key easily, so we skip saving or create dummy
             // Ideally, we just return empty or rely on the scrape
             this.logger.warn("Using fallback navigation, skipping DB category creation for now.");
        }
    }

    this.logger.log(`Targeting URL: ${navItem.url}`);
    const products: any[] = [];

    const crawler = new PlaywrightCrawler({
      headless: true,
      maxRequestsPerCrawl: 20, 
      requestHandlerTimeoutSecs: 45,
      launchContext: {
        launcher: chromium,
        launchOptions: { 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
        },
      },
      requestHandler: async ({ page, log }) => {
        // BLOCK EVERYTHING except HTML to save RAM
        await page.route('**/*.{png,jpg,jpeg,svg,gif,webp,css,woff,woff2,ico,js}', route => route.abort());

        log.info(`Scraping products from ${page.url()}`);
        
        try {
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        } catch {
            log.warning('Page load timed out, trying to scrape what we have...');
        }

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
             let img = imgEl?.src;
             if (imgEl) img = imgEl.getAttribute('data-src') || imgEl.getAttribute('srcset') || imgEl.src;

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

    if (!navItem) {
      this.logger.warn('Unable to determine category URL, skipping scrape.');
      return [];
    }

    await crawler.run([navItem.url]);

    this.logger.log(`Found ${products.length} books.`);
    
    if (products.length === 0) return [];
    
    // Safety check: if category is null (fallback mode), we can't save to DB easily without breaking FK.
    // For this fix, we will only save if we have a valid category ID.
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