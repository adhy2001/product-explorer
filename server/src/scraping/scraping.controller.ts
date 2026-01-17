import { Controller, Get, Param, Query } from '@nestjs/common';
import { ScrapingService } from './scraping.service';

@Controller('scraping')
export class ScrapingController {
  constructor(private readonly scrapingService: ScrapingService) {}

  // 1. Test Navigation (Existing)
  @Get('test')
  async testScrape() {
    return this.scrapingService.scrapeNavigation();
  }

  // 2. Scrape Specific Category (Existing)
  // Example: /scraping/category/fantasy-books
  @Get('category/:slug')
  async scrapeCategory(@Param('slug') slug: string) {
    return this.scrapingService.scrapeCategory(slug);
  }

  // 3. Scrape Product Details (Existing)
  // Example: /scraping/product/harry-potter-9780...
  @Get('product/:sourceId')
  async getProductDetails(@Param('sourceId') sourceId: string) {
    return this.scrapingService.scrapeProductDetail(sourceId);
  }

  // 4. Search Books (NEW)
  // Example: /scraping/search?q=harry
  @Get('search')
  async search(@Query('q') query: string) {
    return this.scrapingService.searchBooks(query);
  }
}