import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { ApiKeyGuard } from './api-key.guard';

function buildConfigService(apiKey: string | undefined): ConfigService {
  return {
    get: jest.fn().mockReturnValue(apiKey),
  } as unknown as ConfigService;
}

function buildReflector(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
}

function buildContext(headerValue: string | undefined): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-api-key': headerValue },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const REAL_KEY = 'super-secret-key';

  it('allows the request when the key matches', () => {
    const guard = new ApiKeyGuard(
      buildReflector(false),
      buildConfigService(REAL_KEY),
    );

    expect(guard.canActivate(buildContext(REAL_KEY))).toBe(true);
  });

  it('throws Unauthorized when the key is wrong', () => {
    const guard = new ApiKeyGuard(
      buildReflector(false),
      buildConfigService(REAL_KEY),
    );

    expect(() => guard.canActivate(buildContext('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when the header is missing', () => {
    const guard = new ApiKeyGuard(
      buildReflector(false),
      buildConfigService(REAL_KEY),
    );

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized for any key when API_KEY is not configured', () => {
    const guard = new ApiKeyGuard(
      buildReflector(false),
      buildConfigService(undefined),
    );

    expect(() => guard.canActivate(buildContext(REAL_KEY))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows the request without checking the key when the route is @Public()', () => {
    const guard = new ApiKeyGuard(
      buildReflector(true),
      buildConfigService(REAL_KEY),
    );

    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });
});
