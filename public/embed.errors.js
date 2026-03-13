export function createErrorNotifier({ ui, t }) {
  function showAuthError(type, err) {
    const detail = err ? ` (${String(err).slice(0, 120)})` : '';
    if (type === 'token') {
      ui.setStatus(`${t('authTokenFailed')}${detail}`);
      ui.setStatusBanner(`${t('authTokenFailed')}${detail}`);
      return;
    }
    if (type === 'pluginAuth') {
      ui.setStatus(`${t('authPluginAuthFailed')}${detail}`);
      ui.setStatusBanner(`${t('authPluginAuthFailed')}${detail}`);
      return;
    }
    if (type === 'scene') {
      ui.setStatus(`${t('scenesFailed')}${detail}`);
      ui.setStatusBanner(`${t('scenesFailed')}${detail}`);
      return;
    }
    ui.setStatus(`${t('failed')}${detail}`);
    ui.setStatusBanner(`${t('failed')}${detail}`);
  }

  return { showAuthError };
}
