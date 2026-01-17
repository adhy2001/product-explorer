import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapingService } from './scraping/scraping.service';
import { ScrapingController } from './scraping/scraping.controller';
import { PrismaModule } from './prisma/prisma.module';
import { NavigationModule } from './navigation/navigation.module';

@Module({
  imports: [PrismaModule, NavigationModule],
  controllers: [AppController, ScrapingController],
  providers: [AppService, ScrapingService],
})
export class AppModule {}
