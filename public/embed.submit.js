export function createSubmitHandler({ host, ui, i18n, progress }) {
  async function uploadIconIfNeeded() {
    const file = ui.getSelectedIconFile();
    if (!file) return null;
    const form = new FormData();
    form.append('icon', file);
    const res = await host.authFetch('/plugin/icon-upload', { method: 'POST', body: form });
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`图标上传失败 ${res.status}: ${raw.slice(0, 200)}`);
    }
    if (!contentType.includes('application/json')) {
      throw new Error(`图标上传响应非 JSON: ${raw.slice(0, 200)}`);
    }
    const json = JSON.parse(raw);
    const data = json?.data || json;
    return data?.artifactId || null;
  }

  async function handleSubmit() {
    const { appName, sceneId } = ui.getFormValues();
    if (!appName || !sceneId) {
      ui.setStatus(`${i18n.t('appName')}/${i18n.t('sceneId')} ${i18n.t('failed')}`);
      ui.setProgress('idle', '');
      return;
    }
    const { standardLibraryItemId } = host.getState();
    if (!standardLibraryItemId) {
      ui.setStatus(`${i18n.t('failed')}`);
      ui.setProgress('idle', '');
      return;
    }

    ui.setStatus(i18n.t('submitting'));
    ui.disableSubmit(true);
    ui.setProgress('submit', i18n.t('submitting'));
    ui.setDownloadArea('');

    try {
      const unityPatchValue = /^\d+$/.test(sceneId) ? Number(sceneId) : sceneId;
      const iconArtifactId = await uploadIconIfNeeded();
      const payload = {
        input: {
          source: { libraryItemId: standardLibraryItemId },
          modifications: {
            appName,
            unityPatches: [{ path: 'sceneId', value: unityPatchValue }],
            unityConfigPath: null,
            iconArtifactId,
          },
          options: {
            async: true,
            reuseDecodedCache: true,
            useStandardPackage: true,
          },
        },
      };

      const res = await host.authFetch('/plugin/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) {
        ui.setStatus(`${i18n.t('failed')} (${res.status})`);
        ui.setProgress('submit', i18n.t('failed'), true);
        return;
      }
      ui.setStatus(`${i18n.t('processing')}...`);
      ui.setProgress('processing', i18n.t('processing'));
      try {
        const json = JSON.parse(text);
        const data = json?.data || json;
        const runId = data?.runId || '';
        if (runId) {
          progress.startPolling(runId);
        }
      } catch {
        // non-json response
      }
    } catch {
      ui.setStatus(i18n.t('failed'));
      ui.setProgress('submit', i18n.t('failed'), true);
    } finally {
      ui.disableSubmit(false);
    }
  }

  function bind() {
    ui.submitBtn?.addEventListener('click', handleSubmit);
  }

  return { bind };
}
