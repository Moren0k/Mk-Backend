import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';

function buildConfigService(
  accessPassword: string | undefined,
  apiKey: string | undefined,
): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'auth.accessPassword') return accessPassword;
      if (key === 'api.key') return apiKey;
      return undefined;
    }),
  } as unknown as ConfigService;
}

describe('AuthController', () => {
  const PASSWORD = 'super-secret-password';
  const API_KEY = 'the-real-api-key';

  it('returns the API key when the password matches', () => {
    const controller = new AuthController(
      buildConfigService(PASSWORD, API_KEY),
    );

    expect(controller.login({ password: PASSWORD })).toEqual({
      apiKey: API_KEY,
    });
  });

  it('throws Unauthorized when the password is wrong', () => {
    const controller = new AuthController(
      buildConfigService(PASSWORD, API_KEY),
    );

    expect(() => controller.login({ password: 'wrong' })).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when no password is sent', () => {
    const controller = new AuthController(
      buildConfigService(PASSWORD, API_KEY),
    );

    expect(() => controller.login({})).toThrow(UnauthorizedException);
  });

  it('throws Unauthorized for any password when ACCESS_PASSWORD is not configured', () => {
    const controller = new AuthController(
      buildConfigService(undefined, API_KEY),
    );

    expect(() => controller.login({ password: PASSWORD })).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the password matches but API_KEY is not configured', () => {
    const controller = new AuthController(
      buildConfigService(PASSWORD, undefined),
    );

    expect(() => controller.login({ password: PASSWORD })).toThrow(
      UnauthorizedException,
    );
  });
});
