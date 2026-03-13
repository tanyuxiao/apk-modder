export function createSceneLoader({ host, ui, notify }) {
  const state = {
    scenes: [],
    scenesLoading: false,
    scenesLoaded: false,
    scenesError: '',
  };

  function render() {
    ui.renderScenes(state);
  }

  async function loadScenes() {
    if (state.scenesLoading) return;
    state.scenesLoading = true;
    state.scenesError = '';
    render();
    try {
      const { initConfig } = host.getState();
      const url = initConfig?.auth?.sceneListUrl || '';
      if (!url) {
        state.scenes = [{ id: 1001, name: 'Demo Scene' }];
        state.scenesLoaded = true;
        return;
      }
      // Scene list must use user token (identity)
      const res = await host.authFetchToken(url, { method: 'GET' });
      const json = await res.json();
      const list = json?.data || json?.scenes || json || [];
      state.scenes = Array.isArray(list) ? list : [];
      state.scenesLoaded = true;
    } catch (err) {
      state.scenesError = String(err || '');
      notify?.showAuthError?.('scene', err);
    } finally {
      state.scenesLoading = false;
      render();
    }
  }

  function getState() {
    return state;
  }

  return {
    loadScenes,
    getState,
    render,
  };
}
