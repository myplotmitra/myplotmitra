function parseHttpsUrl(value, label) {
  let url;

  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }

  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(`${label} must be a secure HTTPS URL`);
  }

  return url;
}

function getCashfreeCallbackUrls() {
  const deployment = String(
    process.env.VERCEL_ENV || 'development'
  ).trim().toLowerCase();

  const cashfree = String(
    process.env.CASHFREE_ENV || ''
  ).trim().toLowerCase();

  if (deployment === 'production') {
    if (!['production', 'prod'].includes(cashfree)) {
      throw new Error('Production callbacks require Cashfree Production');
    }

    return {
      returnUrl: 'https:' + '/' + '/' + 'www.myplotmitra.com' + '/?cashfree_return=1&order_id={order_id}',
      notifyUrl: 'https:' + '/' + '/' + 'www.myplotmitra.com' + '/api/cashfree-webhook'
    };
  }

  if (deployment === 'preview') {
    if (cashfree !== 'sandbox') {
      throw new Error('Preview callbacks require Cashfree Sandbox');
    }

    const host = String(process.env.VERCEL_URL || '')
      .trim()
      .toLowerCase();

    if (
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host)
    ) {
      throw new Error('A valid Vercel Preview deployment hostname is required');
    }

    const origin = `https://${host}`;

    return {
      returnUrl: `${origin}/?cashfree_return=1&order_id={order_id}`,
      notifyUrl: `${origin}/api/cashfree-webhook`
    };
  }

  if (deployment === 'development') {
    if (cashfree !== 'sandbox') {
      throw new Error('Local callbacks require Cashfree Sandbox');
    }

    const returnUrl = parseHttpsUrl(
      process.env.CASHFREE_RETURN_URL,
      'CASHFREE_RETURN_URL'
    );

    const notifyUrl = parseHttpsUrl(
      process.env.CASHFREE_NOTIFY_URL,
      'CASHFREE_NOTIFY_URL'
    );

    const productionHosts = [
      'myplotmitra.com',
      'www.myplotmitra.com'
    ];

    if (
      productionHosts.includes(returnUrl.hostname) ||
      productionHosts.includes(notifyUrl.hostname) ||
      returnUrl.hostname.endsWith('.myplotmitra.com') ||
      notifyUrl.hostname.endsWith('.myplotmitra.com')
    ) {
      throw new Error('Local Sandbox callbacks cannot target Production');
    }

    if (returnUrl.origin !== notifyUrl.origin) {
      throw new Error('Local return and webhook URLs must use the same tunnel');
    }

    if (
      returnUrl.pathname !== '/' ||
      returnUrl.searchParams.get('cashfree_return') !== '1' ||
      notifyUrl.pathname !== '/api/cashfree-webhook'
    ) {
      throw new Error('Local Cashfree callback paths are invalid');
    }

    return {
      returnUrl: returnUrl.toString(),
      notifyUrl: notifyUrl.toString()
    };
  }

  throw new Error('Unsupported deployment environment for Cashfree callbacks');
}

module.exports = { getCashfreeCallbackUrls };
