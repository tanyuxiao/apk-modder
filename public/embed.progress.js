export function createRunProgress({ host, ui, t }) {
  let pollTimer = null;

  async function pollRunStatus(runId) {
    if (!runId) return false;
    const res = await host.authFetch(`/plugin/runs/${runId}`, { method: 'GET' });
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`状态查询失败 ${res.status}: ${raw.slice(0, 200)}`);
    }
    if (!contentType.includes('application/json')) {
      throw new Error(`状态查询响应非 JSON: ${raw.slice(0, 200)}`);
    }
    const json = JSON.parse(raw);
    const data = json?.data || json;
    const status = String(data?.status || '').toLowerCase();
    const progress = data?.progress;
    const pctValue = typeof progress?.percent === 'number' ? progress.percent : null;
    const pctLabel = pctValue !== null ? `${pctValue}%` : '';

    if (status === 'success') {
      ui.setStatus(t('success'));
      ui.setProgress('done', t('success'));
    } else if (status === 'failed' || status === 'error') {
      ui.setStatus(t('failed'));
      ui.setProgress('processing', t('failed'), true);
    } else {
      ui.setStatus(pctLabel ? `${t('processing')} ${pctLabel}` : t('processing'));
      ui.setProgress('processing', t('processing'));
    }

    const artifacts = Array.isArray(data?.artifacts) ? data.artifacts : [];
    if (artifacts.length) {
      const first = artifacts[0];
      const { tenantId } = host.getState();
      const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
      const url = host.withApiBase(`/plugin/artifacts/${first.artifactId}${tenantQuery}`);
      const nameFromStatus = data?.apkInfo?.appName || '';
      const nameFromInput = (document.getElementById('appName')?.value || '').trim();
      const baseName = (nameFromStatus || nameFromInput || 'modded')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim();
      const downloadName = `${baseName || 'modded'}.apk`;
      ui.setDownloadArea(
        `<a href="${url}" download="${downloadName}" class="btn download-btn">${t('download')}</a>`
      );
      ui.setStatus(t('success'));
      ui.setProgress('done', t('success'));
      return true;
    }

    return status === 'failed' || status === 'error' || status === 'success';
  }

  function startPolling(runId) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollTimer = setInterval(async () => {
      try {
        const done = await pollRunStatus(runId);
        if (done) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (err) {
        ui.setStatus(`查询失败：${String(err).slice(0, 120)}`);
      }
    }, 2000);
    void pollRunStatus(runId).catch(() => {});
  }

  return {
    startPolling,
  };
}
