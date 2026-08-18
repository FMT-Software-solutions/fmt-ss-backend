import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { json } from 'express';

async function bootstrap() {
  // rawBody keeps the untouched request bytes available on req.rawBody, which
  // the Paystack webhook needs: its x-paystack-signature is an HMAC over the
  // exact payload sent, so a re-serialised JSON.stringify would never match.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  const configService = app.get(ConfigService);

  app.use(helmet());

  // Behind Netlify/Cloudflare/reverse proxies, the client IP arrives via
  // x-forwarded-for; trust the first proxy hop so req.ip is meaningful.
  app.set('trust proxy', 1);

  // CORS allowlist. Server-to-server calls (webhooks, curl) send no Origin
  // header and are unaffected by CORS either way.
  const allowedOrigins = (configService.get<string>('ADMIN_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors(
    allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined,
  );

  // The analytics beacon uses navigator.sendBeacon, which cannot perform a
  // CORS preflight, so it must send a safelisted content type (text/plain).
  // Parse that one route's body as JSON whatever the declared type.
  app.use('/api/analytics/collect', json({ type: () => true }));

  // Set Global Prefix
  app.setGlobalPrefix('api');

  // Validation Pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  // Swagger: not exposed in production unless explicitly enabled.
  // An explicit SWAGGER_ENABLED always wins. Deriving it from NODE_ENV as a
  // fallback is only safe when nothing was set: hosts like Railway do not
  // define NODE_ENV by default, so an OR here would treat 'false' as 'true'
  // and publish the docs anyway.
  const swaggerFlag = configService.get<string>('SWAGGER_ENABLED');
  const swaggerEnabled =
    swaggerFlag !== undefined && swaggerFlag !== ''
      ? swaggerFlag === 'true'
      : configService.get<string>('NODE_ENV') !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('FMT Software Solutions API')
      .setDescription('The backend API for FMT Software Solutions')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get<number>('PORT') || 3001;

  await app.listen(port);
  console.log(`Application is running on: ${await app.getUrl()}`);
  if (swaggerEnabled) {
    console.log(`Swagger documentation is available at: ${await app.getUrl()}/api/docs`);
  }
}
bootstrap();
