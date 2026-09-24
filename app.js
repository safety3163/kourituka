(() => {
  "use strict";

  const SITE_NAME = "東北機材センター";
  const PIN_CODE = "2101";
  const PIN_KEY = "kourituka-pin-ok";
  const IS_TEST_MODE = new URLSearchParams(location.search).get("test") === "1";
  const PROPOSALS_COLLECTION = IS_TEST_MODE ? "proposals_test" : "proposals";
  const MAX_ENTRY_BYTES = 900000; // soft limit, keep well under Firestore's 1MiB/doc

  const firebaseConfig = {
    apiKey: "AIzaSyCz8cJt_34gelPORfIEQKkMBlW_uRE8Mqo",
    authDomain: "kourituka-27228.firebaseapp.com",
    projectId: "kourituka-27228",
    storageBucket: "kourituka-27228.firebasestorage.app",
    messagingSenderId: "952678388108",
    appId: "1:952678388108:web:3ec838770a37ff6e6f06a9",
  };
  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  /** @type {Array<Object>} */
  let entries = [];
  let currentPhotos = []; // [{id, dataUrl, caption}]
  let editingPhotoId = null;

  // ---------- shared storage (Firestore) ----------
  function subscribeToEntries() {
    db.collection(PROPOSALS_COLLECTION).onSnapshot(
      snapshot => {
        entries = snapshot.docs.map(doc => doc.data());
        if (document.getElementById("view-list").classList.contains("active")) {
          renderList();
        }
      },
      err => {
        console.error(err);
        showToast("データの取得に失敗しました。通信環境を確認してください。");
      }
    );
  }

  async function saveEntry(data) {
    try {
      await db.collection(PROPOSALS_COLLECTION).doc(data.id).set(data);
    } catch (e) {
      console.error(e);
      showToast("送信に失敗しました。通信環境を確認してください。");
      throw e;
    }
  }

  async function deleteEntry(id) {
    try {
      await db.collection(PROPOSALS_COLLECTION).doc(id).delete();
    } catch (e) {
      console.error(e);
      showToast("削除に失敗しました。通信環境を確認してください。");
      throw e;
    }
  }

  function entrySizeBytes(data) {
    return new Blob([JSON.stringify(data)]).size;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- access code gate ----------
  function initPinGate() {
    const gate = document.getElementById("pin-gate");
    const input = document.getElementById("pin-input");
    const submitBtn = document.getElementById("pin-submit");
    const errorEl = document.getElementById("pin-error");

    if (localStorage.getItem(PIN_KEY) === "1") {
      gate.hidden = true;
      startApp();
      return;
    }

    function tryUnlock() {
      if (input.value.trim() === PIN_CODE) {
        localStorage.setItem(PIN_KEY, "1");
        gate.hidden = true;
        startApp();
      } else {
        errorEl.hidden = false;
        input.value = "";
        input.focus();
      }
    }

    submitBtn.addEventListener("click", tryUnlock);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") tryUnlock();
    });
    input.focus();
  }

  // ---------- toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------- tabs ----------
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
  }

  function switchView(view) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.getElementById("view-form").classList.toggle("active", view === "form");
    document.getElementById("view-list").classList.toggle("active", view === "list");
    if (view === "list") renderList();
  }

  // ---------- month select ----------
  function initMonthSelect() {
    const sel = document.getElementById("month");
    for (let m = 1; m <= 12; m++) {
      const opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = `${m}月分`;
      sel.appendChild(opt);
    }
  }

  // ---------- other checkbox toggle ----------
  function initOtherToggles() {
    document.querySelectorAll('input[data-other-target]').forEach(cb => {
      cb.addEventListener("change", () => {
        const wrap = document.getElementById(cb.dataset.otherTarget + "Wrap");
        wrap.hidden = !cb.checked;
        if (!cb.checked) document.getElementById(cb.dataset.otherTarget).value = "";
      });
    });
  }

  // ---------- photos ----------
  function currentPhotosBytes() {
    return currentPhotos.reduce((sum, p) => sum + p.dataUrl.length, 0);
  }

  function addPhotoIfRoom(dataUrl, caption) {
    if (currentPhotosBytes() + dataUrl.length > MAX_ENTRY_BYTES) {
      showToast("写真の合計サイズが大きすぎます。写真を削除するか枚数を減らしてください。");
      return false;
    }
    currentPhotos.push({ id: uid(), dataUrl, caption: caption || "" });
    return true;
  }

  function initPhotoInput() {
    const input = document.getElementById("photo-input");
    input.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        try {
          const dataUrl = await fileToCompressedDataUrl(file);
          addPhotoIfRoom(dataUrl);
        } catch (err) {
          console.error(err);
          showToast("写真の読み込みに失敗しました");
        }
      }
      input.value = "";
      renderPhotoGrid();
    });
  }

  function fileToCompressedDataUrl(file, maxDim = 1280, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("image decode failed"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const scale = maxDim / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderPhotoGrid() {
    const grid = document.getElementById("photo-grid");
    grid.innerHTML = "";
    currentPhotos.forEach(p => {
      const thumb = document.createElement("div");
      thumb.className = "photo-thumb";
      thumb.innerHTML = `
        <img src="${p.dataUrl}" alt="写真">
        <button type="button" class="del-btn" data-id="${p.id}" title="削除">&times;</button>
        ${p.caption ? `<div class="caption-badge">${escapeHtml(p.caption)}</div>` : ""}
      `;
      thumb.querySelector("img").addEventListener("click", () => openPhotoModal(p.id));
      thumb.querySelector(".del-btn").addEventListener("click", (ev) => {
        ev.stopPropagation();
        deletePhoto(p.id);
      });
      grid.appendChild(thumb);
    });
  }

  function deletePhoto(id) {
    if (!confirm("この写真を削除しますか？")) return;
    currentPhotos = currentPhotos.filter(p => p.id !== id);
    renderPhotoGrid();
  }

  function openPhotoModal(id) {
    const p = currentPhotos.find(x => x.id === id);
    if (!p) return;
    editingPhotoId = id;
    document.getElementById("photo-modal-img").src = p.dataUrl;
    document.getElementById("photo-caption").value = p.caption || "";
    document.getElementById("photo-modal").hidden = false;
  }

  function closePhotoModal() {
    if (editingPhotoId) {
      const p = currentPhotos.find(x => x.id === editingPhotoId);
      if (p) p.caption = document.getElementById("photo-caption").value.trim();
    }
    editingPhotoId = null;
    document.getElementById("photo-modal").hidden = true;
    renderPhotoGrid();
  }

  function initPhotoModal() {
    document.getElementById("photo-modal-close").addEventListener("click", closePhotoModal);
    document.getElementById("photo-modal-done").addEventListener("click", closePhotoModal);
    document.getElementById("photo-delete").addEventListener("click", () => {
      if (editingPhotoId) {
        currentPhotos = currentPhotos.filter(p => p.id !== editingPhotoId);
        editingPhotoId = null;
      }
      document.getElementById("photo-modal").hidden = true;
      renderPhotoGrid();
    });
  }

  // ---------- in-app camera capture (for Windows PC/tablets where the file
  // picker has no camera shortcut) ----------
  let cameraStream = null;
  let cameraDevices = [];
  let cameraDeviceIndex = 0;

  function initCameraCapture() {
    const btn = document.getElementById("btn-camera-capture");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      btn.hidden = true;
      return;
    }
    btn.addEventListener("click", () => openCameraModal());
    document.getElementById("camera-modal-close").addEventListener("click", closeCameraModal);
    document.getElementById("camera-shutter").addEventListener("click", capturePhotoFromCamera);
    document.getElementById("camera-switch").addEventListener("click", switchCamera);
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function startStream(constraints) {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
      // give the OS/driver a moment to fully release the camera before
      // requesting a different one — some Windows camera drivers fail
      // to open a second device if asked immediately after stop()
      await wait(350);
    }
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    const video = document.getElementById("camera-video");
    video.srcObject = cameraStream;
    try {
      await video.play();
    } catch (e) {
      // some browsers reject play() if it's immediately superseded; harmless
    }
  }

  async function openCameraModal() {
    try {
      await startStream({ video: { facingMode: { exact: "environment" } }, audio: false });
    } catch (e) {
      try {
        await startStream({ video: { facingMode: "environment" }, audio: false });
      } catch (e2) {
        try {
          await startStream({ video: true, audio: false });
        } catch (e3) {
          console.error(e3);
          showToast("カメラを起動できませんでした。カメラの使用を許可してください。");
          return;
        }
      }
    }
    document.getElementById("camera-modal").hidden = false;
    await refreshCameraDeviceList();
  }

  async function refreshCameraDeviceList() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      cameraDevices = devices.filter(d => d.kind === "videoinput");
      const switchBtn = document.getElementById("camera-switch");
      switchBtn.hidden = cameraDevices.length < 2;
      if (cameraStream) {
        const currentId = cameraStream.getVideoTracks()[0]?.getSettings().deviceId;
        const idx = cameraDevices.findIndex(d => d.deviceId === currentId);
        if (idx >= 0) cameraDeviceIndex = idx;
      }
      updateCameraDeviceInfo();
    } catch (e) {
      console.error(e);
    }
  }

  function updateCameraDeviceInfo() {
    const info = document.getElementById("camera-device-info");
    const track = cameraStream ? cameraStream.getVideoTracks()[0] : null;
    const settings = track ? track.getSettings() : {};
    const label = track ? track.label : "";
    const idxLabel = cameraDevices.length ? `${cameraDeviceIndex + 1}/${cameraDevices.length}台` : "";
    const facing = settings.facingMode ? `facingMode: ${settings.facingMode}` : "facingMode: 不明";
    info.textContent = `検出カメラ ${idxLabel}　${facing}${label ? "　" + label : ""}`;
  }

  async function switchCamera() {
    await refreshCameraDeviceList();
    if (cameraDevices.length < 2) {
      showToast("この端末ではカメラが1台しか検出されませんでした");
      return;
    }
    const startIndex = cameraDeviceIndex;
    const track = cameraStream ? cameraStream.getVideoTracks()[0] : null;
    const currentFacing = track ? track.getSettings().facingMode : undefined;

    let lastError = null;
    for (let attempt = 1; attempt <= cameraDevices.length; attempt++) {
      const tryIndex = (startIndex + attempt) % cameraDevices.length;
      const nextId = cameraDevices[tryIndex].deviceId;
      try {
        await startStream({ video: { deviceId: { exact: nextId } }, audio: false });
        cameraDeviceIndex = tryIndex;
        updateCameraDeviceInfo();
        const newTrack = cameraStream.getVideoTracks()[0];
        const newFacing = newTrack.getSettings().facingMode;
        // if facingMode is reported and unchanged, this was likely the same
        // physical camera under another id — keep trying the next one
        if (!currentFacing || !newFacing || newFacing !== currentFacing || cameraDevices.length === 2) {
          return;
        }
      } catch (e) {
        console.error(e);
        lastError = e;
      }
    }
    if (lastError) {
      const info = document.getElementById("camera-device-info");
      info.textContent = `切替エラー: ${lastError.name || "unknown"} ${lastError.message || ""}`;
      showToast("カメラを切り替えられませんでした");
      // the stream may have been left stopped by the failed attempt — restore
      // whichever camera was active before switching
      try {
        await startStream({ video: { deviceId: { exact: cameraDevices[startIndex].deviceId } }, audio: false });
      } catch (e2) {
        console.error(e2);
      }
    }
  }

  function closeCameraModal() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    document.getElementById("camera-modal").hidden = true;
  }

  function capturePhotoFromCamera() {
    const video = document.getElementById("camera-video");
    const canvas = document.getElementById("camera-canvas");
    const maxDim = 1280;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (!w || !h) {
      showToast("カメラの映像を取得できませんでした");
      return;
    }
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    if (addPhotoIfRoom(dataUrl)) {
      showToast("写真を追加しました");
    }
    renderPhotoGrid();
    closeCameraModal();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- form ----------
  function getCheckedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(i => i.value);
  }

  function collectFormData(status) {
    return {
      id: document.getElementById("entry-id").value || uid(),
      site: SITE_NAME,
      status: status || "submitted",
      term: document.getElementById("term").value,
      month: document.getElementById("month").value,
      group: document.getElementById("group").value,
      currentState: document.getElementById("currentState").value.trim(),
      currentIssue: document.getElementById("currentIssue").value.trim(),
      improvementContent: document.getElementById("improvementContent").value.trim(),
      improvementEffect: document.getElementById("improvementEffect").value.trim(),
      applicableItems: getCheckedValues("applicableItems"),
      applicableItemsOther: document.getElementById("applicableItemsOther").value.trim(),
      applicableEffects: getCheckedValues("applicableEffects"),
      applicableEffectsOther: document.getElementById("applicableEffectsOther").value.trim(),
      photos: currentPhotos,
      createdAt: document.getElementById("entry-id").dataset.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function resetForm() {
    document.getElementById("proposal-form").reset();
    document.getElementById("entry-id").value = "";
    document.getElementById("entry-id").dataset.createdAt = "";
    currentPhotos = [];
    renderPhotoGrid();
    document.getElementById("applicableItemsOtherWrap").hidden = true;
    document.getElementById("applicableEffectsOtherWrap").hidden = true;
  }

  function loadEntryIntoForm(entry) {
    document.getElementById("entry-id").value = entry.id;
    document.getElementById("entry-id").dataset.createdAt = entry.createdAt;
    document.getElementById("term").value = entry.term || "41";
    document.getElementById("month").value = entry.month;
    document.getElementById("group").value = entry.group;
    document.getElementById("currentState").value = entry.currentState;
    document.getElementById("currentIssue").value = entry.currentIssue;
    document.getElementById("improvementContent").value = entry.improvementContent;
    document.getElementById("improvementEffect").value = entry.improvementEffect;

    document.querySelectorAll('input[name="applicableItems"]').forEach(cb => {
      cb.checked = entry.applicableItems.includes(cb.value);
    });
    document.getElementById("applicableItemsOther").value = entry.applicableItemsOther || "";
    document.getElementById("applicableItemsOtherWrap").hidden = !entry.applicableItems.includes("その他");

    document.querySelectorAll('input[name="applicableEffects"]').forEach(cb => {
      cb.checked = entry.applicableEffects.includes(cb.value);
    });
    document.getElementById("applicableEffectsOther").value = entry.applicableEffectsOther || "";
    document.getElementById("applicableEffectsOtherWrap").hidden = !entry.applicableEffects.includes("その他");

    currentPhotos = (entry.photos || []).map(p => ({ ...p }));
    renderPhotoGrid();
  }

  function initForm() {
    document.getElementById("proposal-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = collectFormData("submitted");
      if (!data.month || !data.group) {
        showToast("対象月と報告グループを選択してください");
        return;
      }
      if (entrySizeBytes(data) > MAX_ENTRY_BYTES) {
        showToast("写真の合計サイズが大きすぎます。写真を減らしてください。");
        return;
      }
      try {
        await saveEntry(data);
      } catch (e) {
        return;
      }
      showToast("提出しました");
      resetForm();
      switchView("list");
    });

    document.getElementById("btn-draft").addEventListener("click", async () => {
      const data = collectFormData("draft");
      if (entrySizeBytes(data) > MAX_ENTRY_BYTES) {
        showToast("写真の合計サイズが大きすぎます。写真を減らしてください。");
        return;
      }
      try {
        await saveEntry(data);
      } catch (e) {
        return;
      }
      showToast("一時保存しました（あとで一覧から再開できます）");
      resetForm();
      switchView("list");
    });

    document.getElementById("btn-clear").addEventListener("click", () => {
      if (confirm("入力内容をクリアしますか？")) resetForm();
    });
  }

  // ---------- list ----------
  const MONTH_LABEL = m => `${m}月分`;

  function renderList() {
    const listEl = document.getElementById("entry-list");
    const emptyEl = document.getElementById("empty-msg");
    listEl.innerHTML = "";

    const sorted = [...entries].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

    if (sorted.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    sorted.forEach(entry => {
      const card = document.createElement("div");
      card.className = "entry-card";
      const dateStr = new Date(entry.updatedAt).toLocaleString("ja-JP");
      const termLabel = entry.term ? `${entry.term}期　` : "";
      const monthLabel = entry.month ? MONTH_LABEL(entry.month) : "(月未選択)";
      const groupLabel = entry.group ? escapeHtml(entry.group) : "(グループ未選択)";
      const isDraft = entry.status === "draft";
      const badge = isDraft ? '<span class="status-badge">下書き</span>' : "";
      card.innerHTML = `
        <div class="entry-title">${termLabel}${monthLabel}　${groupLabel}${badge}</div>
        <div class="entry-sub">更新: ${dateStr}　写真${(entry.photos || []).length}枚</div>
        <div class="entry-buttons">
          <button data-act="edit">${isDraft ? "再開" : "編集"}</button>
          <button data-act="print">印刷</button>
          <button data-act="excel">Excel出力</button>
          <button data-act="delete" class="danger">削除</button>
        </div>
      `;
      card.querySelector('[data-act="edit"]').addEventListener("click", () => {
        loadEntryIntoForm(entry);
        switchView("form");
      });
      card.querySelector('[data-act="print"]').addEventListener("click", () => printEntry(entry));
      card.querySelector('[data-act="excel"]').addEventListener("click", () => exportEntriesToExcel([entry], `${entry.month || "未選択"}月分_${entry.group || "未選択"}`));
      card.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (confirm("この提出内容を削除しますか？")) {
          try {
            await deleteEntry(entry.id);
          } catch (e) {
            // error toast already shown by deleteEntry
          }
        }
      });
      listEl.appendChild(card);
    });
  }

  function initListToolbar() {
    document.getElementById("btn-export-all").addEventListener("click", () => {
      const submitted = entries.filter(en => en.status !== "draft");
      if (submitted.length === 0) {
        showToast("提出済みの内容がありません（下書きは除外されます）");
        return;
      }
      exportEntriesToExcel(submitted, "東北機材センター_業務効率化提案_全件");
    });
  }

  // ---------- print ----------
  function printEntry(entry) {
    const area = document.getElementById("print-area");
    const itemsChecked = ["出庫作業", "検収作業", "整備作業", "修理作業", "その他"]
      .map(v => `${entry.applicableItems.includes(v) ? "☑" : "☐"} ${v}`).join("　");
    const effectsChecked = ["工程改善", "工数削減", "その他"]
      .map(v => `${entry.applicableEffects.includes(v) ? "☑" : "☐"} ${v}`).join("　");

    const photosHtml = (entry.photos || []).map(p => `
      <div class="print-photo">
        <img src="${p.dataUrl}">
        ${p.caption ? `<div class="cap">${escapeHtml(p.caption)}</div>` : ""}
      </div>
    `).join("");

    area.innerHTML = `
      <div class="print-page">
        <h1>改善提案書</h1>
        <div class="print-meta">
          <span>拠点：${entry.site}</span>
          <span>${entry.term ? entry.term + "期　" : ""}対象：${MONTH_LABEL(entry.month)}</span>
          <span>報告グループ：${escapeHtml(entry.group)}</span>
        </div>
        <p class="print-deadline">提出期限：毎月20日(土日の場合は前倒しの金曜日)</p>
        <table>
          <tr><th>現状について</th><td>${escapeHtml(entry.currentState).replace(/\n/g, "<br>")}</td></tr>
          <tr><th>現状の課題</th><td>${escapeHtml(entry.currentIssue).replace(/\n/g, "<br>")}</td></tr>
          <tr><th>改善の内容</th><td>${escapeHtml(entry.improvementContent).replace(/\n/g, "<br>")}</td></tr>
          <tr><th>改善の効果</th><td>${escapeHtml(entry.improvementEffect).replace(/\n/g, "<br>")}</td></tr>
          <tr><th>提案該当項目</th><td>${itemsChecked}${entry.applicableItemsOther ? `　（その他: ${escapeHtml(entry.applicableItemsOther)}）` : ""}</td></tr>
          <tr><th>提案該当効果</th><td>${effectsChecked}${entry.applicableEffectsOther ? `　（その他: ${escapeHtml(entry.applicableEffectsOther)}）` : ""}</td></tr>
        </table>
        ${photosHtml ? `<h2 style="font-size:1rem;">写真</h2><div class="print-photos">${photosHtml}</div>` : ""}
      </div>
    `;
    window.print();
  }

  // ---------- excel export ----------
  async function exportEntriesToExcel(list, fileNameBase) {
    showToast("Excelを作成しています…");
    const wb = new ExcelJS.Workbook();
    wb.creator = SITE_NAME;
    wb.created = new Date();

    for (const entry of list) {
      const sheetName = `${entry.month}月_${entry.group}`.slice(0, 31).replace(/[\\/*?:[\]]/g, "_");
      const ws = wb.addWorksheet(sheetName || "提案", {
        pageSetup: {
          paperSize: 9,
          orientation: "portrait",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 1,
          margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
        },
      });
      buildSheetForEntry(ws, entry);
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const fname = `${fileNameBase}_${dateStamp()}.xlsx`;
    saveAs(blob, fname);
    showToast("Excelを出力しました");
  }

  function dateStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  function buildSheetForEntry(ws, entry) {
    ws.columns = [
      { width: 4 }, { width: 16 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
      { width: 14 }, { width: 14 }, { width: 14 },
    ];

    const titleCell = ws.getCell("A1");
    ws.mergeCells("A1:K1");
    titleCell.value = "改善提案書";
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 26;

    ws.mergeCells("A3:C3");
    ws.getCell("A3").value = entry.site;
    ws.getCell("A3").font = { bold: true, size: 12 };
    ws.getCell("D3").value = `${entry.term ? entry.term + "期　" : ""}対象月：${MONTH_LABEL(entry.month)}`;
    ws.getCell("D3").font = { bold: true };
    ws.getCell("G3").value = "報告グループ：";
    ws.mergeCells("H3:K3");
    ws.getCell("H3").value = entry.group;
    ws.getCell("H3").font = { bold: true };

    ws.mergeCells("A4:K4");
    const deadlineCell = ws.getCell("A4");
    deadlineCell.value = "提出期限：毎月20日(土日の場合は前倒しの金曜日)";
    deadlineCell.font = { bold: true, color: { argb: "FFC0392B" } };

    let row = 6;
    row = addLabeledBlock(ws, row, "現状について", entry.currentState);
    row = addLabeledBlock(ws, row, "現状の課題", entry.currentIssue);
    row = addLabeledBlock(ws, row, "改善の内容", entry.improvementContent);
    row = addLabeledBlock(ws, row, "改善の効果", entry.improvementEffect);

    row = addChecklistRow(ws, row, "提案該当項目",
      ["出庫作業", "検収作業", "整備作業", "修理作業", "その他"], entry.applicableItems, entry.applicableItemsOther);
    row = addChecklistRow(ws, row, "提案該当効果",
      ["工程改善", "工数削減", "その他"], entry.applicableEffects, entry.applicableEffectsOther);

    row += 1;
    if (entry.photos && entry.photos.length) {
      ws.mergeCells(`A${row}:K${row}`);
      ws.getCell(`A${row}`).value = "写真";
      ws.getCell(`A${row}`).font = { bold: true };
      row += 1;

      let col = 0;
      const startRow = row;
      const colsPerRow = 3;
      const imgWidthCols = 3;
      const imgHeightRows = 10;

      entry.photos.forEach((p, i) => {
        const c = col * imgWidthCols;
        const r = startRow + Math.floor(i / colsPerRow) * (imgHeightRows + 1);
        const match = /^data:image\/(\w+);base64,(.*)$/.exec(p.dataUrl);
        if (match) {
          const ext = match[1] === "jpeg" ? "jpeg" : match[1];
          const imgId = ws.workbook.addImage({ base64: p.dataUrl, extension: ext === "jpeg" ? "jpeg" : ext });
          ws.addImage(imgId, {
            tl: { col: c, row: r - 1 },
            ext: { width: 190, height: 190 },
          });
        }
        if (p.caption) {
          const capRow = r + imgHeightRows;
          ws.mergeCells(capRow, c + 1, capRow, c + imgWidthCols);
          const cell = ws.getCell(capRow, c + 1);
          cell.value = p.caption;
          cell.font = { size: 9 };
          cell.alignment = { horizontal: "center" };
        }
        col = (col + 1) % colsPerRow;
      });

      const totalRows = Math.ceil(entry.photos.length / colsPerRow) * (imgHeightRows + 1);
      row = startRow + totalRows + 1;
    }

    ws.eachRow(r => {
      r.eachCell(c => {
        c.alignment = { ...(c.alignment || {}), wrapText: true, vertical: "top" };
      });
    });
  }

  function addLabeledBlock(ws, startRow, label, text) {
    ws.mergeCells(`A${startRow}:B${startRow + 2}`);
    const labelCell = ws.getCell(`A${startRow}`);
    labelCell.value = label;
    labelCell.font = { bold: true };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    labelCell.border = borderAll();

    ws.mergeCells(`C${startRow}:K${startRow + 2}`);
    const valueCell = ws.getCell(`C${startRow}`);
    valueCell.value = text || "";
    valueCell.border = borderAll();

    for (let r = startRow; r <= startRow + 2; r++) {
      ws.getCell(`A${r}`).border = borderAll();
      ws.getCell(`C${r}`).border = borderAll();
    }
    return startRow + 3;
  }

  function addChecklistRow(ws, startRow, label, options, checked, otherText) {
    ws.mergeCells(`A${startRow}:B${startRow}`);
    const labelCell = ws.getCell(`A${startRow}`);
    labelCell.value = label;
    labelCell.font = { bold: true };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    labelCell.border = borderAll();

    const text = options.map(o => `${checked.includes(o) ? "☑" : "☐"} ${o}`).join("　　") +
      (checked.includes("その他") && otherText ? `　（${otherText}）` : "");

    ws.mergeCells(`C${startRow}:K${startRow}`);
    const valueCell = ws.getCell(`C${startRow}`);
    valueCell.value = text;
    valueCell.border = borderAll();
    ws.getCell(`A${startRow}`).border = borderAll();
    return startRow + 1;
  }

  function borderAll() {
    return {
      top: { style: "thin" }, bottom: { style: "thin" },
      left: { style: "thin" }, right: { style: "thin" },
    };
  }

  // ---------- init ----------
  function initTestModeBanner() {
    if (!IS_TEST_MODE) return;
    const banner = document.createElement("div");
    banner.className = "test-mode-banner";
    banner.textContent = "テストモード（本番の提出データには一切影響しません）";
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function startApp() {
    initTestModeBanner();
    initOtherToggles();
    initPhotoInput();
    initPhotoModal();
    initCameraCapture();
    initForm();
    initListToolbar();
    subscribeToEntries();
    renderList();
  }

  function init() {
    initTabs();
    initMonthSelect();
    initPinGate();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
