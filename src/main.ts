import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>("port") || 3000;

  // Global pipes & interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Distributed URL Shortener API")
    .setDescription(
      "Production-oriented URL Shortener service built with NestJS, Snowflake ID, Base62, Redis Cache, PostgreSQL, and Kafka Analytics.",
    )
    .setVersion("1.0.0")
    .addTag("URLs", "URL creation, lookup, and deletion management")
    .addTag("Redirect", "Fast HTTP 302 redirect engine")
    .addTag("Health", "System components health check")
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(port);
  logger.log(`Application is running on port ${port}`);
  logger.log(
    `Swagger OpenAPI Documentation available at http://localhost:${port}/docs`,
  );
}

bootstrap();
