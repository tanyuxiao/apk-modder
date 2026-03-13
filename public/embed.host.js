export function createHostClient({ i18n, notify }) {
  let token = '';
  let accessToken = '';
  let pluginToken = '';
  let accessTokenExp = 0;
  let pluginTokenExp = 0;
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
    accessToken = payload?.accessToken || accessToken;
    pluginToken = payload?.pluginToken || pluginToken;
    accessTokenExp = normalizeExp(payload?.accessTokenExp || accessTokenExp);
    pluginTokenExp = normalizeExp(payload?.pluginTokenExp || pluginTokenExp);
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
    if (payload?.accessToken) accessToken = payload.accessToken;
    if (payload?.pluginToken) pluginToken = payload.pluginToken;
    if (payload?.accessTokenExp) accessTokenExp = normalizeExp(payload.accessTokenExp);
    if (payload?.pluginTokenExp) pluginTokenExp = normalizeExp(payload.pluginTokenExp);
  }

  function withApiBase(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${apiBase}${url}`;
  }

  async function refreshAccessToken() {
    const url = initConfig?.auth?.refreshAccessTokenUrl || '';
    if (!url) throw new Error('missing refreshAccessTokenUrl');
    const res = await fetch(url, { method: 'POST' });
    const json = await res.json();
    accessToken = json?.accessToken || accessToken;
    accessTokenExp = normalizeExp(json?.accessTokenExp || accessTokenExp);
    return accessToken;
  }

  async function ensureAccessToken() {
    if (accessToken && !isExpired(accessTokenExp)) return accessToken;
    if (accessToken && isExpired(accessTokenExp)) {
      try {
        return await refreshAccessToken();
      } catch (err) {
        notify?.showAuthError?.('accessToken', err);
        throw err;
      }
    }
    if (token) return token;
    throw new Error('missing accessToken');
  }

  async function fetchPluginToken() {
    const url = initConfig?.auth?.pluginTokenUrl || '';
    if (!url) {
      pluginToken = accessToken || token;
      pluginTokenExp = accessTokenExp || accessTokenExp;
      return pluginToken;
    }
    const bearer = await ensureAccessToken();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      const json = await res.json();
      pluginToken = json?.pluginToken || pluginToken;
      pluginTokenExp = normalizeExp(json?.pluginTokenExp || pluginTokenExp);
      return pluginToken;
    } catch (err) {
      notify?.showAuthError?.('pluginToken', err);
      throw err;
    }
  }

  async function ensurePluginToken() {
    if (pluginToken && !isExpired(pluginTokenExp)) return pluginToken;
    return fetchPluginToken();
  }

  async function authFetch(url, opts = {}) {
    const bearer = await ensurePluginToken();
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${bearer}` };
    if (tenantId) {
      opts.headers['X-Tenant-Id'] = tenantId;
    }
    return fetch(withApiBase(url), opts);
  }

  async function authFetchAccess(url, opts = {}) {
    const bearer = await ensureAccessToken();
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${bearer}` };
    if (tenantId) {
      opts.headers['X-Tenant-Id'] = tenantId;
    }
    return fetch(url, opts);
  }

  function getState() {
    return {
      token,
      accessToken,
      pluginToken,
      accessTokenExp,
      pluginTokenExp,
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
    authFetchAccess,
    ensureAccessToken,
    ensurePluginToken,
    getState,
    setStandardLibraryItemId,
    setPreviousStandardLibraryItemId,
  };
}
