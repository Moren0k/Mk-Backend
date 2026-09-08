import { BadRequestException } from '@nestjs/common';

import {
  COTAS_POR_DEFECTO,
  MAX_COTAS,
  parseBooleano,
  parseCotas,
  parseEntero,
  parseEntre,
  parseFiltros,
  parseMetrica,
  parseTipo,
  parseVentana,
} from './racha3-query';

describe('racha3-query: validación de parámetros', () => {
  describe('tipo', () => {
    it('acepta PLAYER y BANKER', () => {
      expect(parseTipo('PLAYER')).toBe('PLAYER');
      expect(parseTipo('BANKER')).toBe('BANKER');
    });

    it('ausente o vacío significa "ambos"', () => {
      expect(parseTipo(undefined)).toBeUndefined();
      expect(parseTipo('')).toBeUndefined();
    });

    it('rechaza un valor desconocido en vez de caer a un default silencioso', () => {
      // Un typo que devolviera el total de ambos lados es peor que un error:
      // el cliente creería estar viendo lo que pidió.
      expect(() => parseTipo('PLAYERR')).toThrow(BadRequestException);
      expect(() => parseTipo('player')).toThrow(BadRequestException);
      expect(() => parseTipo('TIE')).toThrow(BadRequestException);
    });
  });

  describe('metrica y entre', () => {
    it('aceptan sus valores y tienen default', () => {
      expect(parseMetrica(undefined)).toBe('jugadas');
      expect(parseMetrica('segundos')).toBe('segundos');
      expect(parseEntre(undefined)).toBe('RACHA3');
      expect(parseEntre('PERDIDAS')).toBe('PERDIDAS');
    });

    it('rechazan valores fuera del catálogo', () => {
      expect(() => parseMetrica('minutos')).toThrow(BadRequestException);
      expect(() => parseEntre('perdidas')).toThrow(BadRequestException);
    });
  });

  describe('booleanos', () => {
    it('solo acepta "true" y "false" literales', () => {
      expect(parseBooleano('true', 'x', false)).toBe(true);
      expect(parseBooleano('false', 'x', true)).toBe(false);
      expect(parseBooleano(undefined, 'x', true)).toBe(true);
    });

    it('rechaza formas ambiguas: cambian el conjunto de datos devuelto', () => {
      for (const v of ['1', '0', 'yes', 'TRUE', 'on', '']) {
        if (v === '') {
          expect(parseBooleano(v, 'x', true)).toBe(true);
          continue;
        }
        expect(() => parseBooleano(v, 'x', false)).toThrow(BadRequestException);
      }
    });
  });

  describe('enteros', () => {
    it('respeta rango y default', () => {
      expect(parseEntero(undefined, 'n', 1, 10, 5)).toBe(5);
      expect(parseEntero('7', 'n', 1, 10, 5)).toBe(7);
    });

    it('rechaza no-enteros y valores fuera de rango', () => {
      expect(() => parseEntero('3.5', 'n', 1, 10, 5)).toThrow(
        BadRequestException,
      );
      expect(() => parseEntero('abc', 'n', 1, 10, 5)).toThrow(
        BadRequestException,
      );
      expect(() => parseEntero('0', 'n', 1, 10, 5)).toThrow(
        BadRequestException,
      );
      expect(() => parseEntero('11', 'n', 1, 10, 5)).toThrow(
        BadRequestException,
      );
      expect(() => parseEntero('-1', 'n', 1, 10, 5)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('ventana temporal', () => {
    it('acepta ISO-8601 y deja ambos extremos opcionales', () => {
      const v = parseVentana('2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z');
      expect(v.desde?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(v.hasta?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
      expect(parseVentana(undefined, undefined)).toEqual({
        desde: undefined,
        hasta: undefined,
      });
    });

    it('rechaza fechas no parseables', () => {
      expect(() => parseVentana('ayer', undefined)).toThrow(
        BadRequestException,
      );
      expect(() => parseVentana('2026-13-45', undefined)).toThrow(
        BadRequestException,
      );
    });

    it('exige desde < hasta', () => {
      expect(() =>
        parseVentana('2026-09-05T00:00:00Z', '2026-09-01T00:00:00Z'),
      ).toThrow(BadRequestException);
      // Iguales tampoco: la ventana es semiabierta, quedaría vacía.
      expect(() =>
        parseVentana('2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
      ).toThrow(BadRequestException);
    });

    it('rechaza rangos que superan el tope', () => {
      expect(() =>
        parseVentana('2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ).toThrow(BadRequestException);
    });

    it('permite acotar el tope por endpoint', () => {
      expect(() =>
        parseVentana('2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', 7),
      ).toThrow(BadRequestException);
    });
  });

  describe('cotas', () => {
    it('sin valor usa las cotas acordadas del dominio', () => {
      expect(parseCotas(undefined)).toEqual(COTAS_POR_DEFECTO);
    });

    it('acepta una lista creciente y tolera espacios', () => {
      expect(parseCotas('3,7,20')).toEqual([3, 7, 20]);
      expect(parseCotas(' 3 , 7 , 20 ')).toEqual([3, 7, 20]);
    });

    it('exige estrictamente creciente', () => {
      // Con cotas desordenadas o repetidas, el etiquetado generaría buckets
      // sin sentido ("8-5") en vez de fallar, y el cliente recibiría una
      // distribución incoherente en lugar de un error.
      expect(() => parseCotas('10,5')).toThrow(BadRequestException);
      expect(() => parseCotas('5,5')).toThrow(BadRequestException);
    });

    it('rechaza no-enteros, negativos y cero', () => {
      expect(() => parseCotas('5,a,10')).toThrow(BadRequestException);
      expect(() => parseCotas('5,-1')).toThrow(BadRequestException);
      expect(() => parseCotas('0,5')).toThrow(BadRequestException);
      expect(() => parseCotas('1.5')).toThrow(BadRequestException);
    });

    it('limita la cantidad de cortes', () => {
      const demasiadas = Array.from({ length: MAX_COTAS + 1 }, (_, i) => i + 1);
      expect(() => parseCotas(demasiadas.join(','))).toThrow(
        BadRequestException,
      );
      const justas = Array.from({ length: MAX_COTAS }, (_, i) => i + 1);
      expect(parseCotas(justas.join(','))).toHaveLength(MAX_COTAS);
    });

    it('rechaza valores absurdamente grandes', () => {
      expect(() => parseCotas('99999999')).toThrow(BadRequestException);
    });
  });

  describe('filtros completos', () => {
    it('excluye las bloqueadas por defecto e incluye la integridad dudosa', () => {
      const f = parseFiltros({});
      expect(f.incluirBloqueadas).toBe(false);
      expect(f.incluirIntegridadDudosa).toBe(true);
      expect(f.umbralMuestra).toBe(100);
      expect(f.tipo).toBeUndefined();
    });

    it('permite invertir ambos criterios explícitamente', () => {
      const f = parseFiltros({
        incluir_bloqueadas: 'true',
        incluir_integridad_dudosa: 'false',
        tipo: 'BANKER',
        umbral_muestra: '250',
      });
      expect(f).toMatchObject({
        incluirBloqueadas: true,
        incluirIntegridadDudosa: false,
        tipo: 'BANKER',
        umbralMuestra: 250,
      });
    });

    it('propaga el error del primer parámetro inválido', () => {
      expect(() => parseFiltros({ tipo: 'X' })).toThrow(BadRequestException);
      expect(() => parseFiltros({ umbral_muestra: '0' })).toThrow(
        BadRequestException,
      );
    });
  });
});
