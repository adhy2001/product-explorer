import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 👇 THIS LINE FIXES THE CONNECTION ERROR
  // It allows your Vercel frontend to talk to this Render backend.
  app.enableCors(); 

  await app.listen(process.env.PORT || 3000);
}
bootstrap();