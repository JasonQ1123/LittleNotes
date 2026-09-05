import 'reflect-metadata';
import 'dotenv/config';
import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Database } from './database';
import { AuthController, AuthService, Public, SessionGuard } from './auth';
import { SpacesController, SpacesService } from './spaces';
import { RecordsController, RecordsService } from './records';
import { AgreementsController, AgreementsService } from './agreements';
import { DashboardController, DashboardService } from './dashboard';
import { AiController, AiService } from './ai';

@Controller('health')
class HealthController {
  @Public() @Get() health() {
    return { ok: true, name: '小纸条', features: { ai: false } };
  }
}

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const result =
        typeof body === 'string'
          ? { message: body }
          : (body as { message?: string | string[]; code?: string });
      return res
        .status(error.getStatus())
        .json({
          ...result,
          message: Array.isArray(result.message) ? result.message.join('；') : result.message,
        });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2025', 'P2034'].includes(error.code)
    ) {
      return res.status(409).json({ message: '内容刚刚发生变化，请刷新后重试' });
    }
    console.error('API error:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ message: '暂时没有保存成功，请稍后再试' });
  }
}

@Module({
  controllers: [
    HealthController,
    AuthController,
    SpacesController,
    RecordsController,
    AgreementsController,
    DashboardController,
    AiController,
  ],
  providers: [
    Database,
    AuthService,
    SpacesService,
    RecordsService,
    AgreementsService,
    DashboardService,
    AiService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}

export async function createApp(quiet = false) {
  const app = await NestFactory.create(AppModule, {
    logger: quiet ? false : ['log', 'error', 'warn'],
  });
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const allowed = (process.env.WEB_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((s) => s.trim().replace(/\/$/, ''));
      if (!allowed.includes(req.headers.origin))
        return res.status(403).json({ message: '请求来源不受信任，请从小纸条页面操作' });
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new Errors());
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('小纸条 API')
      .setDescription('情侣空间、私密草稿、共同约定与独立回访。所有业务接口都验证登录和空间权限。')
      .setVersion('1.0')
      .addCookieAuth('paper_session')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
  app.enableShutdownHooks();
  await app.init();
  return app;
}

if (require.main === module) {
  createApp()
    .then((app) => app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
