import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './configuration';

/**
 * Módulo de configuración global de la aplicación.
 *
 * Envuelve el ConfigModule de Nest para que toda la app lea variables de
 * entorno únicamente a través de ConfigService (nunca `process.env` directo).
 *
 * Se llama "AppConfigModule" (en vez de "ConfigModule") para no chocar con
 * el nombre del ConfigModule que exporta @nestjs/config.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
  ],
})
export class AppConfigModule {}
