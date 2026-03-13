import { createI18n } from './embed.i18n.js';
import { createHostClient } from './embed.host.js';
import { createEmbedUI } from './embed.ui.js';
import { createSceneLoader } from './embed.scenes.js';
import { createAdminSection } from './embed.admin.js';
import { createRunProgress } from './embed.progress.js';
import { createSubmitHandler } from './embed.submit.js';
import { createErrorNotifier } from './embed.errors.js';

const i18n = createI18n('zh-CN');
const ui = createEmbedUI({ t: i18n.t });
const notify = createErrorNotifier({ ui, t: i18n.t });
const host = createHostClient({ i18n, notify });
const scenes = createSceneLoader({ host, ui, notify });
const admin = createAdminSection({ host, ui, t: i18n.t });
const progress = createRunProgress({ host, ui, t: i18n.t });
const submit = createSubmitHandler({ host, ui, i18n, progress });
host.applyUrlParams();

function renderAllTexts() {
  ui.renderStaticTexts(scenes.getState());
  ui.renderScenes(scenes.getState());
  admin.render();
}

async function refreshStandardPackage() {
  try {
    const res = await host.authFetch('/plugin/standard-package', { method: 'GET' });
    const json = await res.json();
    const data = json?.data || json;
    host.setStandardLibraryItemId(
      data?.standardLibraryItemId || data?.standard_library_item_id || host.getState().standardLibraryItemId
    );
    host.setPreviousStandardLibraryItemId(
      data?.previousStandardLibraryItemId ||
        data?.previous_standard_library_item_id ||
        host.getState().previousStandardLibraryItemId
    );
  } catch {
    // ignore; admin section can still be used to set config
  }
}

submit.bind();


window.addEventListener('message', (e) => {
  const msg = e.data || {};
  switch (msg.type) {
    case 'INIT': {
      host.handleInit(msg.payload);
      parent.postMessage({ type: 'PLUGIN_READY', id: `ready-${Date.now()}` }, e.origin);
      renderAllTexts();
      scenes.render();
      void scenes.loadScenes();
      void refreshStandardPackage().then(() => admin.render());
      break;
    }
    case 'PAUSE':
      ui.setStatus('已暂停');
      break;
    case 'RESUME':
      ui.setStatus('');
      break;
    case 'TOKEN_UPDATE':
      host.handleTokenUpdate(msg.payload);
      break;
    case 'DESTROY':
      break;
    default:
      break;
  }
});
