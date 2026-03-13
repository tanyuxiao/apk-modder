export function createHostClient({ i18n }) {
  let token = '';
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
  }

  function withApiBase(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${apiBase}${url}`;
  }

  function authFetch(url, opts = {}) {
    opts.headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
    if (tenantId) {
      opts.headers['X-Tenant-Id'] = tenantId;
    }
    return fetch(withApiBase(url), opts);
  }

  function getState() {
    return {
      token,
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
    getState,
    setStandardLibraryItemId,
    setPreviousStandardLibraryItemId,
  };
}
