export function createEmbedUI({ t }) {
  const appEl = document.getElementById('app');
  appEl.innerHTML = `
    <div class="container">
      <div class="section">
        <div class="title">${t('title')}</div>
        <div class="form-row">
          <label for="appName">${t('appName')}</label>
          <input id="appName" type="text" placeholder="${t('appPlaceholder')}" />
        </div>
        <div class="form-row">
          <label id="iconLabel">${t('icon')}</label>
          <input id="appIconFile" class="hidden-input" type="file" accept=".png,.webp,.jpg,.jpeg,image/png,image/webp,image/jpeg" />
          <div class="actions">
            <button id="pickIconBtn" type="button">${t('pickIcon')}</button>
            <span id="iconFileName" class="hint">${t('none')}</span>
          </div>
          <div id="iconPreview" class="icon-preview" title="点击重新编辑" role="button" tabindex="0">
            <span class="icon-empty">${t('noIcon')}</span>
          </div>
        </div>
        <div class="form-row">
          <label for="sceneId">${t('sceneId')}</label>
          <select id="sceneId">
            <option value="" selected>${t('sceneSelectPlaceholder')}</option>
          </select>
          <div class="hint" id="sceneHint">${t('sceneLoading')}</div>
        </div>
        <div class="actions">
          <button id="submitBtn">${t('submit')}</button>
          <span id="status"></span>
        </div>
        <div id="statusBanner" class="status-banner"></div>
        <div class="steps" id="progressSteps">
          <div class="step" data-step="submit"><span class="dot"></span><span class="label"></span></div>
          <div class="step" data-step="processing"><span class="dot"></span><span class="label"></span></div>
          <div class="step" data-step="done"><span class="dot"></span><span class="label"></span></div>
        </div>
        <div class="progress-text" id="progressText"></div>
        <div id="downloadArea"></div>
      </div>
      <div id="adminSection"></div>
    </div>
  `;

  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div id="iconEditorMask" class="modal-mask" role="dialog" aria-modal="true">
      <div class="modal-card">
        <div class="modal-header">
          <strong>编辑图标</strong>
          <button id="iconEditorCloseBtn" type="button" class="secondary">取消</button>
        </div>
        <div class="modal-body">
          <canvas id="iconEditorCanvas" width="512" height="512"></canvas>
          <div class="slider-row">
            <span>缩放</span>
            <input id="iconScale" type="range" min="0.5" max="2.5" step="0.01" value="1" />
          </div>
          <div class="slider-row">
            <span>X</span>
            <input id="iconOffsetX" type="range" min="-220" max="220" step="1" value="0" />
          </div>
          <div class="slider-row">
            <span>Y</span>
            <input id="iconOffsetY" type="range" min="-220" max="220" step="1" value="0" />
          </div>
          <div class="modal-actions">
            <button id="iconEditorResetBtn" type="button" class="secondary">重置</button>
            <button id="iconEditorApplyBtn" type="button">应用图标</button>
          </div>
        </div>
      </div>
    </div>
    `
  );

  const submitBtn = document.getElementById('submitBtn');
  const statusEl = document.getElementById('status');
  const progressStepsEl = document.getElementById('progressSteps');
  const progressTextEl = document.getElementById('progressText');
  const downloadAreaEl = document.getElementById('downloadArea');
  const statusBannerEl = document.getElementById('statusBanner');
  const adminSectionEl = document.getElementById('adminSection');
  const appIconFile = document.getElementById('appIconFile');
  const pickIconBtn = document.getElementById('pickIconBtn');
  const iconFileName = document.getElementById('iconFileName');
  const iconPreview = document.getElementById('iconPreview');
  const iconEditorMask = document.getElementById('iconEditorMask');
  const iconEditorCanvas = document.getElementById('iconEditorCanvas');
  const iconEditorCloseBtn = document.getElementById('iconEditorCloseBtn');
  const iconEditorApplyBtn = document.getElementById('iconEditorApplyBtn');
  const iconEditorResetBtn = document.getElementById('iconEditorResetBtn');
  const iconScaleEl = document.getElementById('iconScale');
  const iconOffsetXEl = document.getElementById('iconOffsetX');
  const iconOffsetYEl = document.getElementById('iconOffsetY');
  const iconCtx = iconEditorCanvas?.getContext('2d') || null;

  let selectedIconFile = null;
  let selectedIconUrl = '';
  let iconSourceFile = null;
  let iconImage = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function setStatusBanner(text) {
    if (!statusBannerEl) return;
    const content = text || '';
    statusBannerEl.textContent = content;
    statusBannerEl.classList.toggle('visible', Boolean(content));
  }

  function setProgress(step, text, failed = false) {
    if (progressStepsEl) {
      const steps = Array.from(progressStepsEl.querySelectorAll('.step'));
      const order = ['submit', 'processing', 'done'];
      const idx = order.indexOf(step);
      steps.forEach((el, i) => {
        el.classList.remove('active', 'done', 'failed');
        if (idx >= 0 && i < idx) el.classList.add('done');
        if (idx >= 0 && i === idx) el.classList.add(failed ? 'failed' : 'active');
        const label = el.querySelector('.label');
        if (label) {
          const key = i === 0 ? 'stepSubmit' : i === 1 ? 'stepProcessing' : 'stepDone';
          label.textContent = t(key);
        }
      });
    }
    if (progressTextEl) progressTextEl.textContent = text || '';
  }

  function setDownloadArea(html) {
    if (downloadAreaEl) downloadAreaEl.innerHTML = html || '';
  }

  function setIconFileLabel(text) {
    if (iconFileName) iconFileName.textContent = text || t('none');
  }

  function updateIconPreview() {
    if (!iconPreview) return;
    if (!selectedIconUrl) {
      iconPreview.innerHTML = `<span class="icon-empty">${t('noIcon')}</span>`;
      return;
    }
    iconPreview.innerHTML = `<img src="${selectedIconUrl}" alt="icon preview" />`;
  }

  function renderStaticTexts(sceneState) {
    const title = document.querySelector('.title');
    if (title) title.textContent = t('title');
    const appLabel = document.querySelector('label[for="appName"]');
    if (appLabel) appLabel.textContent = t('appName');
    const iconLabel = document.getElementById('iconLabel');
    if (iconLabel) iconLabel.textContent = t('icon');
    const sceneLabel = document.querySelector('label[for="sceneId"]');
    if (sceneLabel) sceneLabel.textContent = t('sceneId');
    const appInput = document.getElementById('appName');
    if (appInput) appInput.setAttribute('placeholder', t('appPlaceholder'));
    const sceneInput = document.getElementById('sceneId');
    if (sceneInput) {
      const placeholder = sceneInput.querySelector('option[value=""]');
      if (placeholder) placeholder.textContent = t('sceneSelectPlaceholder');
    }
    const submit = document.getElementById('submitBtn');
    if (submit) submit.textContent = t('submit');
    const pickBtn = document.getElementById('pickIconBtn');
    if (pickBtn) pickBtn.textContent = t('pickIcon');
    const sceneHint = document.getElementById('sceneHint');
    if (sceneHint && sceneState) {
      if (sceneState.scenesLoading) sceneHint.textContent = t('sceneLoading');
      else if (sceneState.scenesError) sceneHint.textContent = t('scenesFailed');
      else if (sceneState.scenesLoaded && sceneState.scenes.length === 0) sceneHint.textContent = t('sceneEmpty');
      else sceneHint.textContent = '';
    }
    setIconFileLabel(selectedIconFile ? (selectedIconFile.name || '') : '');
    updateIconPreview();
    setProgress('idle', '');
    setStatusBanner('');
  }

  function renderScenes(sceneState) {
    const sceneSelect = document.getElementById('sceneId');
    const sceneHint = document.getElementById('sceneHint');
    if (!sceneSelect || !sceneState) return;
    const current = sceneSelect.value;
    sceneSelect.innerHTML = `<option value="">${t('sceneSelectPlaceholder')}</option>`;
    sceneState.scenes.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name ? `${s.name} (${s.id})` : String(s.id);
      sceneSelect.appendChild(opt);
    });
    if (current) sceneSelect.value = current;
    if (sceneHint) {
      if (sceneState.scenesLoading) sceneHint.textContent = t('sceneLoading');
      else if (sceneState.scenesError) sceneHint.textContent = t('scenesFailed');
      else if (sceneState.scenesLoaded && sceneState.scenes.length === 0) sceneHint.textContent = t('sceneEmpty');
      else sceneHint.textContent = '';
    }
  }

  function getFormValues() {
    const appName = document.getElementById('appName')?.value.trim() || '';
    const sceneId = document.getElementById('sceneId')?.value || '';
    return { appName, sceneId: sceneId.trim() };
  }

  function disableSubmit(value) {
    if (submitBtn) submitBtn.disabled = Boolean(value);
  }

  function openIconEditor(file) {
    if (!file || !iconEditorMask || !iconCtx || !iconEditorCanvas) return;
    iconSourceFile = file;
    iconImage = new Image();
    const url = URL.createObjectURL(file);
    iconImage.onload = () => {
      URL.revokeObjectURL(url);
      iconScaleEl.value = '1';
      iconOffsetXEl.value = '0';
      iconOffsetYEl.value = '0';
      renderIconCanvas();
      iconEditorMask.classList.add('open');
    };
    iconImage.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus('图标文件无法读取');
    };
    iconImage.src = url;
  }

  function closeIconEditor() {
    if (!iconEditorMask) return;
    iconEditorMask.classList.remove('open');
    iconImage = null;
    iconSourceFile = null;
  }

  function renderIconCanvas() {
    if (!iconCtx || !iconEditorCanvas || !iconImage) return;
    const scale = Number(iconScaleEl.value || 1);
    const offsetX = Number(iconOffsetXEl.value || 0);
    const offsetY = Number(iconOffsetYEl.value || 0);
    const cw = iconEditorCanvas.width;
    const ch = iconEditorCanvas.height;
    iconCtx.clearRect(0, 0, cw, ch);
    iconCtx.fillStyle = '#ffffff';
    iconCtx.fillRect(0, 0, cw, ch);
    const iw = iconImage.width * scale;
    const ih = iconImage.height * scale;
    const x = (cw - iw) / 2 + offsetX;
    const y = (ch - ih) / 2 + offsetY;
    iconCtx.drawImage(iconImage, x, y, iw, ih);
  }

  function applyIconEditor() {
    if (!iconEditorCanvas || !iconSourceFile) return;
    iconEditorCanvas.toBlob((blob) => {
      if (!blob) return;
      const fileName = iconSourceFile.name || 'icon.png';
      selectedIconFile = new File([blob], fileName, { type: 'image/png' });
      setIconFileLabel(`${fileName}（已编辑）`);
      if (selectedIconUrl) {
        URL.revokeObjectURL(selectedIconUrl);
      }
      selectedIconUrl = URL.createObjectURL(selectedIconFile);
      updateIconPreview();
      closeIconEditor();
    }, 'image/png');
  }

  pickIconBtn?.addEventListener('click', () => appIconFile?.click());
  appIconFile?.addEventListener('change', () => {
    const file = appIconFile.files?.[0] || null;
    if (file) {
      openIconEditor(file);
    }
    appIconFile.value = '';
  });
  iconPreview?.addEventListener('click', () => {
    if (selectedIconFile) {
      openIconEditor(selectedIconFile);
    } else {
      appIconFile?.click();
    }
  });
  iconPreview?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (selectedIconFile) {
        openIconEditor(selectedIconFile);
      } else {
        appIconFile?.click();
      }
    }
  });
  iconEditorCloseBtn?.addEventListener('click', () => closeIconEditor());
  iconEditorResetBtn?.addEventListener('click', () => {
    if (!iconImage) return;
    iconScaleEl.value = '1';
    iconOffsetXEl.value = '0';
    iconOffsetYEl.value = '0';
    renderIconCanvas();
  });
  iconEditorApplyBtn?.addEventListener('click', () => applyIconEditor());
  iconScaleEl?.addEventListener('input', renderIconCanvas);
  iconOffsetXEl?.addEventListener('input', renderIconCanvas);
  iconOffsetYEl?.addEventListener('input', renderIconCanvas);

  return {
    submitBtn,
    adminSectionEl,
    setStatus,
    setStatusBanner,
    setProgress,
    setDownloadArea,
    renderStaticTexts,
    renderScenes,
    getFormValues,
    disableSubmit,
    getSelectedIconFile: () => selectedIconFile,
  };
}
