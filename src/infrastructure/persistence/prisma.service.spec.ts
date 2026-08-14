import { ConfigService } from '@nestjs/config';

type MockPrismaClient = {
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  $queryRaw: jest.Mock;
};

let mockClient: MockPrismaClient;

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockClient),
}));

import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let service: PrismaService;

  beforeEach(() => {
    mockClient = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $queryRaw: jest.fn(),
    };
    configService = { get: jest.fn() };
    service = new PrismaService(configService as unknown as ConfigService);
  });

  describe('sin DATABASE_URL configurada', () => {
    beforeEach(() => {
      configService.get.mockReturnValue(undefined);
    });

    it('no lanza al inicializar', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockClient.$connect).not.toHaveBeenCalled();
    });

    it('reporta el health check como no disponible', async () => {
      await service.onModuleInit();

      const health = await service.checkHealth();

      expect(health.ok).toBe(false);
      expect(health.error).toBeDefined();
    });

    it('getClient lanza con un mensaje explicativo', async () => {
      await service.onModuleInit();

      expect(() => service.getClient()).toThrow(/DATABASE_URL/);
    });

    it('onModuleDestroy no lanza aunque nunca se conectó', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(mockClient.$disconnect).not.toHaveBeenCalled();
    });
  });

  describe('con DATABASE_URL configurada y conexión exitosa', () => {
    beforeEach(() => {
      configService.get.mockReturnValue('postgresql://user:pass@host:5432/db');
      mockClient.$connect.mockResolvedValue(undefined);
    });

    it('conecta sin lanzar', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockClient.$connect).toHaveBeenCalledTimes(1);
    });

    it('getClient devuelve el cliente conectado', async () => {
      await service.onModuleInit();

      expect(service.getClient()).toBe(mockClient);
    });

    it('checkHealth reporta ok cuando la consulta responde', async () => {
      mockClient.$queryRaw.mockResolvedValue([{ '1': 1 }]);
      await service.onModuleInit();

      const health = await service.checkHealth();

      expect(health.ok).toBe(true);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('checkHealth reporta el error cuando la consulta falla', async () => {
      mockClient.$queryRaw.mockRejectedValue(new Error('conexión perdida'));
      await service.onModuleInit();

      const health = await service.checkHealth();

      expect(health.ok).toBe(false);
      expect(health.error).toBe('conexión perdida');
    });

    it('onModuleDestroy desconecta el cliente', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockClient.$disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('con DATABASE_URL configurada pero conexión fallida', () => {
    it('no lanza y deja el cliente deshabilitado', async () => {
      configService.get.mockReturnValue('postgresql://user:pass@host:5432/db');
      mockClient.$connect.mockRejectedValue(new Error('host inalcanzable'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(() => service.getClient()).toThrow();
    });
  });
});
