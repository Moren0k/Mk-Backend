import {
  formatBogotaHourLabel,
  getBogotaHour,
  getNextHourBoundary,
  isOperatingHour,
} from './report-clock';

describe('report-clock', () => {
  describe('getNextHourBoundary', () => {
    it('returns the next top-of-hour instant, mid-hour', () => {
      const now = new Date('2026-08-01T13:27:41.123Z');

      expect(getNextHourBoundary(now).toISOString()).toBe(
        '2026-08-01T14:00:00.000Z',
      );
    });

    it('advances a full hour even when called exactly on the hour', () => {
      const now = new Date('2026-08-01T13:00:00.000Z');

      expect(getNextHourBoundary(now).toISOString()).toBe(
        '2026-08-01T14:00:00.000Z',
      );
    });

    it('rolls over to the next UTC day at 23:xx', () => {
      const now = new Date('2026-08-01T23:45:00.000Z');

      expect(getNextHourBoundary(now).toISOString()).toBe(
        '2026-08-02T00:00:00.000Z',
      );
    });
  });

  describe('getBogotaHour', () => {
    it('maps 15:00 UTC to 10:00 Bogotá (offset fijo -5)', () => {
      expect(getBogotaHour(new Date('2026-08-01T15:00:00.000Z'))).toBe(10);
    });

    it('maps 00:00 UTC to 19:00 Bogotá del día anterior', () => {
      expect(getBogotaHour(new Date('2026-08-01T00:00:00.000Z'))).toBe(19);
    });

    it('maps 04:59 UTC to 23:59 Bogotá', () => {
      expect(getBogotaHour(new Date('2026-08-01T04:59:00.000Z'))).toBe(23);
    });

    it('maps 05:00 UTC to 00:00 Bogotá', () => {
      expect(getBogotaHour(new Date('2026-08-01T05:00:00.000Z'))).toBe(0);
    });
  });

  describe('isOperatingHour', () => {
    it('is true for the block that starts at 10:00 Bogotá (15:00 UTC)', () => {
      expect(isOperatingHour(new Date('2026-08-01T15:00:00.000Z'))).toBe(true);
    });

    it('is false for the block right before, 09:00 Bogotá (14:00 UTC)', () => {
      expect(isOperatingHour(new Date('2026-08-01T14:00:00.000Z'))).toBe(false);
    });

    it('is true for the last operating block, 23:00 Bogotá (04:00 UTC)', () => {
      expect(isOperatingHour(new Date('2026-08-01T04:00:00.000Z'))).toBe(true);
    });

    it('is false right after midnight Bogotá, 00:00 (05:00 UTC)', () => {
      expect(isOperatingHour(new Date('2026-08-01T05:00:00.000Z'))).toBe(false);
    });
  });

  describe('formatBogotaHourLabel', () => {
    it('formats 15:00 UTC as "10:00"', () => {
      expect(formatBogotaHourLabel(new Date('2026-08-01T15:00:00.000Z'))).toBe(
        '10:00',
      );
    });

    it('formats 03:00 UTC as "22:00"', () => {
      expect(formatBogotaHourLabel(new Date('2026-08-01T03:00:00.000Z'))).toBe(
        '22:00',
      );
    });

    it('pads single-digit hours and minutes', () => {
      expect(formatBogotaHourLabel(new Date('2026-08-01T05:05:00.000Z'))).toBe(
        '00:05',
      );
    });
  });
});
