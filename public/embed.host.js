export function createHostClient({ i18n, notify }) {
  let token = '';
  let pluginAuth = '';
  let tokenExp = 0;
  let pluginAuthExp = 0;
  let initConfig = {};
  let standardLibraryItemId = '';
  let previousStandardLibraryItemId = '';
  let isAdmin = false;
  let tenantId = '';
  let apiBase = '';
  let themeMode = 'light';
  let themeName = '';

  function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    const value = params.get(name);
    return value ? value.trim() : '';
  }

  function normalizeExp(raw) {
    if (!raw) return 0;
    const num = Number(raw);
    if (!Number.isFinite(num)) return 0;
    return num < 1e12 ? num * 1000 : num;
  }

  function isExpired(expMs) {
    if (!expMs) return false;
    return Date.now() >= expMs - 5000;
  }

  function resolveApiBase(config) {
    const fromConfig = typeof config?.apiBase === 'string' ? config.apiBase.trim() : '';
    if (fromConfig) return fromConfig;
    if (window.location.pathname.startsWith('/apk-rebuilder/')) return '/apk-rebuilder';
    return '';
  }

  function applyTheme(mode, name) {
    const normalized = mode === 'dark' ? 'dark' : 'light';
    document.body.setAttribute('data-mode', normalized);
    if (name) {
      document.body.setAttribute('data-theme', name);
    } else {
      document.body.removeAttribute('data-theme');
    }
  }

  function applyThemeFromParam(theme) {
    if (!theme) return;
    themeName = theme;
    themeMode = theme.toLowerCase().includes('dark') ? 'dark' : 'light';
    applyTheme(themeMode, themeName);
  }

  function applyUrlParams() {
    const lang = getUrlParam('lang');
    if (lang) i18n.setLocale(lang);
    const theme = getUrlParam('theme');
    if (theme) applyThemeFromParam(theme);
  }

  function handleInit(payload = {}) {
    token = payload?.token || '';
    pluginAuth = payload?.pluginAuth || pluginAuth;
    tokenExp = normalizeExp(payload?.tokenExp || tokenExp);
    pluginAuthExp = normalizeExp(payload?.pluginAuthExp || pluginAuthExp);
    initConfig = payload?.config || {};
    apiBase = resolveApiBase(initConfig);
    standardLibraryItemId = initConfig.standardLibraryItemId || initConfig.standard_library_item_id || '';
    previousStandardLibraryItemId =
      initConfig.previousStandardLibraryItemId || initConfig.previous_standard_library_item_id || '';
    tenantId = String(initConfig.tenantId || initConfig.tenant || '').trim();
    const roles = Array.isArray(initConfig.roles) ? initConfig.roles : [];
    const role = initConfig.role || '';
    isAdmin = roles.includes('admin') || roles.includes('root') || role === 'admin' || role === 'root';
  }

  function handleTokenUpdate(payload = {}) {
    token = payload?.token || token;
    if (payload?.pluginAuth) pluginAuth = payload.pluginAuth;
    if (payload?.tokenExp) tokenExp = normalizeExp(payload.tokenExp);
    if (payload?.pluginAuthExp) pluginAuthExp = normalizeExp(payload.pluginAuthExp);
  }

  function withApiBase(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${apiBase}${url}`;
  }

  async function refreshToken() {
    const url = initConfig?.auth?.refreshTokenUrl || '';
    if (!url) throw new Error('missing refreshTokenUrl');
    const res = await fetch(url, { method: 'POST' });
    const json = await res.json();
    token = json?.token || token;
    tokenExp = normalizeExp(json?.tokenExp || tokenExp);
    return token;
  }

  async function ensureToken() {
    if (token && !isExpired(tokenExp)) return token;
    if (token && isExpired(tokenExp)) {
      try {
        return await refreshToken();
      } catch (err) {
        notify?.showAuthError?.('token', err);
        throw err;
      }
    }
    if (token) return token;
    throw new Error('missing token');
  }

  async function fetchPluginAuth() {
    const url = initConfig?.auth?.pluginAuthUrl || '';
    if (!url) {
      pluginAuth = token;
      pluginAuthExp = tokenExp;
      return pluginAuth;
    }
    const bearer = await ensureToken();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      const json = await res.json();
      pluginAuth = json?.pluginAuth || pluginAuth;
      pluginAuthExp = normalizeExp(json?.pluginAuthExp || pluginAuthExp);
      return pluginAuth;
    } catch (err) {
      notify?.showAuthError?.('pluginAuth', err);
      throw err;
    }
  }

  async function ensurePluginAuth() {
    if (pluginAuth && !isExpired(pluginAuthExp)) return pluginAuth;
    return fetchPluginAuth();
  }

  async function authFetch(url, opts = {}) {
    const bearer = await ensurePluginAuth();
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${bearer}` };
    if (tenantId) {
      opts.headers['X-Tenant-Id'] = tenantId;
    }
    return fetch(withApiBase(url), opts);
  }

  async function authFetchToken(url, opts = {}) {
    const bearer = await ensureToken();
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${bearer}` };
    if (tenantId) {
      opts.headers['X-Tenant-Id'] = tenantId;
    }
    return fetch(url, opts);
  }

  function getState() {
    return {
      token,
      pluginAuth,
      tokenExp,
      pluginAuthExp,
      initConfig,
      standardLibraryItemId,
      previousStandardLibraryItemId,
      isAdmin,
      tenantId,
      apiBase,
      themeMode,
      themeName,
    };
  }

  function setStandardLibraryItemId(value) {
    standardLibraryItemId = value || '';
  }

  function setPreviousStandardLibraryItemId(value) {
    previousStandardLibraryItemId = value || '';
  }

  return {
    applyUrlParams,
    handleInit,
    handleTokenUpdate,
    withApiBase,
    authFetch,
    authFetchToken,
    ensureToken,
    ensurePluginAuth,
    getState,
    setStandardLibraryItemId,
    setPreviousStandardLibraryItemId,
  };
}
