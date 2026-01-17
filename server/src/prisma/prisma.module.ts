import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // <--- This makes it available everywhere!
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}