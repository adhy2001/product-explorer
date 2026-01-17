import { Module } from '@nestjs/common';
import { NavigationService } from './navigation.service';
import { NavigationController } from './navigation.controller';

@Module({
  controllers: [NavigationController],
  providers: [NavigationService],
})
export class NavigationModule {}
