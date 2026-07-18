import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { type Express, type Request, type Response } from 'express';
import { AppModule } from './app.module';

let cachedApp: Express | null = null;

async function createApp(): Promise<Express> {
  if (cachedApp) return cachedApp;

  const expressApp = express();
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
    {
      rawBody: true,
      logger: ['error', 'warn', 'log'],
    },
  );

  const config = app.get(ConfigService);
  const origins = config
    .get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('Tempat Kost API')
      .setDescription('Multi-property boarding house SaaS API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('docs', app, document);
  }

  await app.init();
  cachedApp = expressApp;
  return expressApp;
}

/** Vercel serverless entry (CommonJS + ESM interop) */
export default async function handler(req: Request, res: Response) {
  try {
    const app = await createApp();
    return app(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Nest bootstrap failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'error',
        message: err instanceof Error ? err.message : 'Bootstrap failed',
      });
    }
  }
}

async function bootstrapLocal() {
  try {
    const expressApp = await createApp();
    const port = Number(process.env.PORT ?? 4000);
    expressApp.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`API listening on http://localhost:${port}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
}

const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_ENV;
if (!isVercel) {
  void bootstrapLocal();
}
