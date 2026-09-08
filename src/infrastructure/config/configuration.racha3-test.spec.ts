import configuration from './configuration';

/**
 * Solo el bloque `racha3Test`. Lo que se prueba acá no es "que lea la
 * variable" — es el caso que rompió el respaldo de bot/chat: `.env.example`
 * trae `RACHA3_TEST_TELEGRAM_BOT_TOKEN=` y dotenv entrega `""`, que no es
 * nullish, así que el `??` de `Racha3TestModule` se habría quedado con la
 * cadena vacía y nunca habría caído a `TELEGRAM_PRUEBAS_*`.
 */
describe('configuration() — bloque racha3Test', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
    delete process.env.RACHA3_TEST_ENABLED;
    delete process.env.RACHA3_TEST_SCORE_THRESHOLD;
    delete process.env.RACHA3_TEST_MIN_MUESTRA;
    delete process.env.RACHA3_TEST_MAX_REZAGO;
    delete process.env.RACHA3_TEST_TELEGRAM_BOT_TOKEN;
    delete process.env.RACHA3_TEST_TELEGRAM_CHAT_ID;
  });

  afterAll(() => {
    process.env = original;
  });

  it('arranca apagada y con los defaults documentados', () => {
    const { racha3Test } = configuration();

    expect(racha3Test.enabled).toBe(false);
    expect(racha3Test.umbralScore).toBe(86.87);
    expect(racha3Test.muestraMinima).toBe(500);
    expect(racha3Test.maxRezagoJugadas).toBe(50);
  });

  it('solo el literal "true" la enciende', () => {
    for (const valor of ['1', 'yes', 'TRUE', 'True', '']) {
      process.env.RACHA3_TEST_ENABLED = valor;
      expect(configuration().racha3Test.enabled).toBe(false);
    }

    process.env.RACHA3_TEST_ENABLED = 'true';
    expect(configuration().racha3Test.enabled).toBe(true);
  });

  it('respeta los valores explícitos', () => {
    process.env.RACHA3_TEST_SCORE_THRESHOLD = '90.5';
    process.env.RACHA3_TEST_MIN_MUESTRA = '1200';
    process.env.RACHA3_TEST_MAX_REZAGO = '10';

    const { racha3Test } = configuration();

    expect(racha3Test.umbralScore).toBe(90.5);
    expect(racha3Test.muestraMinima).toBe(1200);
    expect(racha3Test.maxRezagoJugadas).toBe(10);
  });

  describe('bot/chat del canal DEBUG', () => {
    it('sin definir quedan undefined, para que el respaldo aplique', () => {
      const { telegram } = configuration().racha3Test;

      expect(telegram.botToken).toBeUndefined();
      expect(telegram.chatId).toBeUndefined();
    });

    it('DEFINIDOS PERO VACÍOS también quedan undefined', () => {
      process.env.RACHA3_TEST_TELEGRAM_BOT_TOKEN = '';
      process.env.RACHA3_TEST_TELEGRAM_CHAT_ID = '   ';

      const { telegram } = configuration().racha3Test;

      expect(telegram.botToken).toBeUndefined();
      expect(telegram.chatId).toBeUndefined();
    });

    it('con valor real lo conserva tal cual', () => {
      process.env.RACHA3_TEST_TELEGRAM_BOT_TOKEN = '123:abc';
      process.env.RACHA3_TEST_TELEGRAM_CHAT_ID = '-1002';

      const { telegram } = configuration().racha3Test;

      expect(telegram.botToken).toBe('123:abc');
      expect(telegram.chatId).toBe('-1002');
    });
  });
});
