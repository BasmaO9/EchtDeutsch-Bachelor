// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';
// import { ValidationPipe } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import cookieParser from 'cookie-parser';
// import * as express from 'express';
// import { join } from 'path';
// import mongoose from 'mongoose';

// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);

//   // 1️⃣ Serve static files (for uploads or media files later)
//   app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

//   // 2️⃣ Enable global validation (ensures DTOs are validated)
//   app.useGlobalPipes(
//     new ValidationPipe({
//       transform: true,
//       whitelist: true,
//     }),
//   );

//   // 3️⃣ Parse cookies (needed if you ever use auth sessions later)
//   app.use(cookieParser());

//   // 4️⃣ Get environment variables
//   const configService = app.get(ConfigService);
//   const port = configService.get<number>('PORT') ?? 3000;
//   const mongoConnection = configService.get<string>('MONGO_URI') ?? '';
//   if (!mongoConnection) {
//     throw new Error('❌ MONGO_URI not found in .env file');
//   }
//   // 5️⃣ Connect to MongoDB
//   try {
//     const connection = await mongoose.connect(mongoConnection);
//     console.log('✅ Connected to MongoDB:', connection.connection.name);
//   } catch (err) {
//     console.error('❌ Failed to connect to MongoDB:', err);
//   }

//   // 6️⃣ Enable CORS (for connecting your Next.js frontend)
//   app.enableCors({
//     origin: '*', // You can restrict this later to your frontend URL
//     methods: 'GET,POST,PUT,PATCH,DELETE',
//     credentials: true,
//   });

//   // 7️⃣ Optional global route prefix
//   app.setGlobalPrefix('api');

//   // 8️⃣ Start server
//   await app.listen(port);
//   console.log(`🚀 Server running on http://localhost:${port}`);
// }

// bootstrap();



import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import mongoose from 'mongoose';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const configService = app.get(ConfigService);
  app.use(cookieParser());
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('German Learning System')
    .setDescription('API documentation')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const mongoConnection = configService.get<string>('MONGO_URI') ?? '';
  if (!mongoConnection) {
    throw new Error('❌ MONGO_URI not found in .env file');
  }

  try {
    const connection = await mongoose.connect(mongoConnection);
    console.log('✅ Connected to MongoDB:', connection.connection.name);
  } catch (err) {
    console.error('❌ Failed to connect to MongoDB:', err);
  }

 const frontendUrl = configService.get<string>('FRONTEND_URL') || '*';

 app.enableCors({
  origin: frontendUrl,
  methods: 'GET,POST,PUT,PATCH,DELETE',
  credentials: true,
});


  //const port = configService.get<number>('PORT') ?? 3000;
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap();

