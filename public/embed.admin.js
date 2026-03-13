export function createAdminSection({ host, ui, t }) {
  function render() {
    const { isAdmin, standardLibraryItemId } = host.getState();
    if (!ui.adminSectionEl) return;
    if (!isAdmin) {
      ui.adminSectionEl.innerHTML = '';
      return;
    }

    ui.adminSectionEl.innerHTML = `
      <div class="section">
      <div class="section-title">${t('adminTitle')}</div>
      <div class="form-row">
        <label>${t('currentStandard')}</label>
        <div class="hint">${t('currentId')}：<span id="currentStandardId">${standardLibraryItemId || '-'}</span></div>
      </div>
      <div class="form-row">
        <label>${t('uploadStandard')}</label>
        <input id="standardApkFile" type="file" accept=".apk" />
        <div class="hint">${t('uploadHint')}</div>
      </div>
      <div class="form-row">
        <label>${t('history')}</label>
        <div id="standardList" class="hint">${t('loading')}</div>
      </div>
      <pre id="adminResult"></pre>
      </div>
    `;

    const currentStandardIdEl = document.getElementById('currentStandardId');
    const standardApkFile = document.getElementById('standardApkFile');
    const standardListEl = document.getElementById('standardList');
    const adminResult = document.getElementById('adminResult');

    function setAdminResult(text) {
      if (adminResult) adminResult.textContent = text || '';
    }

    function setCurrentStandardId(value) {
      if (currentStandardIdEl) currentStandardIdEl.textContent = value || '-';
    }

    async function refreshStandardList() {
      if (!standardListEl) return;
      standardListEl.textContent = t('loading');
      try {
        const res = await host.authFetch('/plugin/admin/apk-library', { method: 'GET' });
        const contentType = res.headers.get('content-type') || '';
        const raw = await res.text();
        if (!contentType.includes('application/json')) {
          throw new Error(raw.slice(0, 200));
        }
        const json = JSON.parse(raw);
        const data = json?.data || json;
        const items = Array.isArray(data?.items) ? data.items : [];
        const standard = data?.standard || {};
        const activeId = standard?.activeStandardId || host.getState().standardLibraryItemId || '';
        host.setStandardLibraryItemId(activeId || host.getState().standardLibraryItemId);
        setCurrentStandardId(activeId || '');

        if (!items.length) {
          standardListEl.textContent = t('noHistory');
          return;
        }

        standardListEl.innerHTML = items.map(item => {
          const isActive = item.id === activeId;
          const isPrevious = item.id === (standard?.previousStandardId || host.getState().previousStandardLibraryItemId);
          return `
            <div class="admin-list-item">
              <div class="admin-list-meta">
                <strong class="admin-list-title">${item.name || 'uploaded.apk'}</strong>
                <span class="hint">ID: ${item.id}</span>
                <span class="hint">${item.createdAt || ''}</span>
                ${isActive ? '<span class="badge badge-current">当前</span>' : ''}
                ${isPrevious ? '<span class="badge badge-previous">上一个</span>' : ''}
              </div>
              <div class="admin-list-actions">
                <button class="setStandardBtn ${isActive ? 'active' : ''}" data-id="${item.id}" type="button">
                  ${isActive ? t('currentStandardBtn') : t('setStandard')}
                </button>
                <button class="deleteStandardBtn secondary" data-id="${item.id}" type="button">${t('delete')}</button>
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        standardListEl.textContent = '加载失败';
        setAdminResult(String(err));
      }
    }

    standardApkFile?.addEventListener('change', async () => {
      const file = standardApkFile.files?.[0];
      if (!file) return;
      const form = new FormData();
      form.append('apk', file);
      setAdminResult('上传中...');
      try {
        const headers = host.getState().tenantId ? { 'X-Tenant-Id': host.getState().tenantId } : undefined;
        const res = await fetch(host.withApiBase('/api/upload'), { method: 'POST', body: form, headers });
        const json = await res.json();
        const libraryId = json?.data?.libraryItem?.id || json?.data?.libraryItemId || json?.data?.id;
        if (libraryId) {
          setAdminResult(`上传成功，libraryItemId=${libraryId}`);
          await refreshStandardList();
        } else {
          setAdminResult(JSON.stringify(json, null, 2));
        }
      } catch (err) {
        setAdminResult(String(err));
      }
    });

    standardListEl?.addEventListener('click', async (evt) => {
      const target = evt.target;
      if (!(target instanceof HTMLElement)) return;
      const setBtn = target.closest('.setStandardBtn');
      const delBtn = target.closest('.deleteStandardBtn');
      const id = (setBtn || delBtn)?.getAttribute('data-id') || '';
      if (!id) return;

      if (setBtn) {
        setAdminResult('保存中...');
        const doSave = async () => {
          const res = await host.authFetch('/plugin/admin/standard-package', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              standardLibraryItemId: id,
              previousStandardLibraryItemId: host.getState().standardLibraryItemId || host.getState().previousStandardLibraryItemId || null,
            }),
          });
          const text = await res.text();
          if (res.status === 409) {
            setAdminResult('标准包正在更新，稍后自动重试...');
            setTimeout(() => {
              doSave().catch((err) => setAdminResult(String(err)));
            }, 1200);
            return;
          }
          host.setStandardLibraryItemId(id);
          setCurrentStandardId(id);
          setAdminResult(text || '保存成功');
          await refreshStandardList();
        };
        try {
          await doSave();
        } catch (err) {
          setAdminResult(String(err));
        }
      }

      if (delBtn) {
        const now = Date.now();
        const last = Number(delBtn.getAttribute('data-confirm') || '0');
        if (!last || now - last > 4000) {
          delBtn.setAttribute('data-confirm', String(now));
          const prevText = delBtn.textContent || '删除';
          delBtn.setAttribute('data-prev-text', prevText);
          delBtn.textContent = t('deleteConfirm');
          delBtn.classList.add('danger');
          setTimeout(() => {
            if (!delBtn.isConnected) return;
            delBtn.textContent = delBtn.getAttribute('data-prev-text') || '删除';
            delBtn.classList.remove('danger');
            delBtn.removeAttribute('data-confirm');
            delBtn.removeAttribute('data-prev-text');
          }, 3500);
          return;
        }
        setAdminResult('删除中...');
        try {
          const res = await host.authFetch(`/plugin/admin/apk-library/${id}`, { method: 'DELETE' });
          const text = await res.text();
          setAdminResult(text || '删除成功');
          await refreshStandardList();
        } catch (err) {
          setAdminResult(String(err));
        }
      }
    });

    refreshStandardList();
  }

  return { render };
}
