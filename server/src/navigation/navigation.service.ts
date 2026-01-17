import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NavigationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.navigation.findMany({
      orderBy: { title: 'asc' } // Sort A-Z for the frontend
    });
  }

  // We don't need these yet, but keep them empty or throw error
  findOne(id: number) { return `This action returns a #${id} navigation`; }
  update(id: number, updateNavigationDto: any) { return `This action updates a #${id} navigation`; }
  remove(id: number) { return `This action removes a #${id} navigation`; }
}