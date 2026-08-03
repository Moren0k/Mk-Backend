/**
 * Headers que un navegador real envía al visitar tipminer.com. La API es
 * pública mesa "sin autenticación" (ver API.MD), pero eso no significa que
 * acepte cualquier request: sin estos headers, un `fetch`/EventSource de
 * Node se identifica con un User-Agent genérico y sin Referer/Origin, la
 * firma típica que un WAF (Cloudflare u otro) bloquea antes de llegar
 * siquiera a la aplicación de Tipminer — sin importar la IP de origen.
 *
 * No es una garantía de que esto evite un bloqueo (si el bloqueo es
 * puramente por rango de IP, esto no alcanza), pero es gratis de probar
 * antes de asumir que hace falta un proxy.
 */
export const TIPMINER_BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.tipminer.com/',
  Origin: 'https://www.tipminer.com',
};
