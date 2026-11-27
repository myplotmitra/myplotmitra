'use strict';

/**
 * Creates a small dispatcher for several existing API handlers.
 * The public endpoint URLs remain unchanged; vercel.json rewrites each URL
 * to the shared function and supplies the allow-listed __mpm_route value.
 */
function readRouteKey(req) {
  const fromQuery = req && req.query && req.query.__mpm_route;
  if (typeof fromQuery === 'string' && fromQuery.length > 0) return fromQuery;
  if (fromQuery !== undefined) return null;

  const rawUrl = req && typeof req.url === 'string' ? req.url : '/';
  try {
    return new URL(rawUrl, 'http://localhost').searchParams.get('__mpm_route');
  } catch (_) {
    return null;
  }
}

function createDispatcher(handlers) {
  const routes = new Map(Object.entries(handlers || {}));

  return async function dispatch(req, res) {
    const key = readRouteKey(req);
    const handler = typeof key === 'string' ? routes.get(key) : null;

    if (typeof handler !== 'function') {
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'no-store');
      }
      return res.status(404).json({ success: false, error: 'API route not found' });
    }

    // Pass the original request and response through unchanged. In particular,
    // do not parse, rewrite, or consume req.body in this dispatch layer.
    return handler(req, res);
  };
}

module.exports = { createDispatcher, readRouteKey };
