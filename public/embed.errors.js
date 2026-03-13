export function createErrorNotifier({ ui, t }) {
  function showAuthError(type, err) {
    const detail = err ? ` (${String(err).slice(0, 120)})` : '';
    if (type === 'accessToken') {
      ui.setStatus(`${t('authAccessTokenFailed')}${detail}`);
      ui.setStatusBanner(`${t('authAccessTokenFailed')}${detail}`);
      return;
    }
    if (type === 'pluginToken') {
      ui.setStatus(`${t('authPluginTokenFailed')}${detail}`);
      ui.setStatusBanner(`${t('authPluginTokenFailed')}${detail}`);
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
