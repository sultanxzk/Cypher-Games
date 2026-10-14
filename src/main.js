import {
  LANGUAGES,
  applyTranslations,
  changeLanguage,
  currentLanguage,
  setRawText,
  setText,
  t,
} from "./i18n/index.js";

const ASSET_RELEASE_URL = import.meta.env.VITE_ASSET_URL;

const BASE = import.meta.env.BASE_URL;

// --- Loading screen -------------------------------------------------------
// #cypher-loader covers the whole page and only shows the game loading
// (percentage + bar). game.js reports the download through window.cypherLoader.
// If the setup page is needed instead (error, no game file, manual import),
// fail() removes the overlay so that page shows up.
const cypherLoader = (() => {
  const root = document.getElementById("cypher-loader");
  const label = document.getElementById("cl-label");
  const percent = document.getElementById("cl-percent");
  const fill = document.getElementById("cl-bar-fill");
  const detail = document.getElementById("cl-detail");
  const net = document.getElementById("cl-net");
  const build = document.getElementById("cl-build");

  const STAGE_LABELS = {
    import: "loader.importing",
    download: "loader.label",
    ready: "loader.ready",
  };
  let stage = "";
  let active = true;

  const paintNet = () => {
    setText(net, navigator.onLine ? "loader.online" : "loader.offline");
  };
  if (build) build.textContent = __BUILD_DATE__;
  window.addEventListener("online", paintNet);
  window.addEventListener("offline", paintNet);

  const live = () =>
    active &&
    root &&
    !root.hidden &&
    !document.body.classList.contains("gameIsStarted");

  return {
    start() {
      paintNet();
    },
    // stage: "import" | "download" ; pct: 0-100
    progress(nextStage, pct) {
      if (!live()) return;
      if (nextStage !== stage) {
        stage = nextStage;
        setText(label, STAGE_LABELS[nextStage] || "loader.label");
        root.classList.remove("cl-ready", "cl-error");
      }
      const value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      percent.textContent = String(value);
      fill.style.width = `${value}%`;
    },
    detail(key, options) {
      if (!live()) return;
      if (key) setText(detail, key, options);
      else setRawText(detail, "");
    },
    // Everything is downloaded; the game now waits for one click (browsers
    // need a user gesture to enable audio / pointer lock).
    ready() {
      if (!live()) return;
      stage = "ready";
      setText(label, STAGE_LABELS.ready);
      percent.textContent = "100";
      fill.style.width = "100%";
      setText(detail, "loader.clickToContinueShort");
      root.classList.add("cl-ready");
    },
    error(message) {
      if (!root || document.body.classList.contains("gameIsStarted")) return;
      stage = "error";
      root.classList.remove("cl-ready");
      root.classList.add("cl-error");
      setText(label, "loader.failed");
      setRawText(detail, String(message || ""));
    },
    // Give the page back to the setup UI.
    fail() {
      active = false;
      document.body.classList.remove("cypher-loading");
      if (root) root.hidden = true;
    },
  };
})();
window.cypherLoader = cypherLoader;

// --- Automation (personal/private deployment) ---------------------------
// game.tar.gz sits next to the site files (public/game.tar.gz -> /game.tar.gz).
// Override with VITE_GAME_URL if you host it somewhere else.
//
// Private bucket: open the site as  <site>/#game=<temporary download link>
// The link is read once, removed from the address bar and kept only in this
// tab's sessionStorage until the import succeeds (it expires by itself).
const SESSION_KEY = "cypher.gameUrl";

function readTemporaryGameUrl() {
  let url = "";
  const hash = window.location.hash.replace(/^#/, "");
  if (hash.startsWith("game=")) {
    url = hash.slice("game=".length);
    if (/^https?%3A/i.test(url)) {
      try {
        url = decodeURIComponent(url);
      } catch {
        /* keep as is */
      }
    }
    try {
      sessionStorage.setItem(SESSION_KEY, url);
    } catch {
      /* ignore */
    }
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return url;
  }
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

function forgetTemporaryGameUrl() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

const GAME_ARCHIVE_URL =
  readTemporaryGameUrl() ||
  import.meta.env.VITE_GAME_URL ||
  `${BASE}game.tar.gz`;
const urlParams = new URLSearchParams(window.location.search);
// ?autoimport=0 / ?autostart=0 turn the automation off (manual flow).
const AUTO_IMPORT = urlParams.get("autoimport") !== "0";
const AUTO_START = urlParams.get("autostart") !== "0";

let autoStarted = false;

// Presses "Start to play" for us once the game data is ready and game.js is
// loaded. The game still asks for one click afterwards ("click to continue"):
// browsers require a user gesture to enable audio / pointer lock.
function maybeAutoStart() {
  if (!AUTO_START || autoStarted) return;
  if (window.__gtaGameReady !== true) return;
  if (typeof window.startGame !== "function") return; // game.js not loaded yet
  autoStarted = true;
  console.log("[auto] starting game");
  window.startGame({ stopPropagation() {} });
}

// Is there a real game archive next to the site? (a dev server / SPA fallback
// may answer 200 with index.html for a missing file, so check the type/size)
async function archiveAvailable() {
  try {
    const response = await fetch(GAME_ARCHIVE_URL, {
      method: "HEAD",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const type = response.headers.get("Content-Type") || "";
    if (type.includes("text/html")) return false;
    const size = Number(response.headers.get("Content-Length")) || 0;
    return size === 0 || size > 1024 * 1024;
  } catch {
    return false;
  }
}

const LEGACY_SCRIPT_SOURCES = [
  `${BASE}GamepadEmulator.js`,
  `${BASE}idbfs.js`,
  `${BASE}shared.js`,
  `${BASE}saves.js`,
  `${BASE}skins.js`,
  `${BASE}game.js`,
];

function isLocalDevEnvironment() {
  return (
    window.location.protocol === "file:" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

async function clearDevelopmentServiceWorkers() {
  if (!("serviceWorker" in navigator) || !isLocalDevEnvironment()) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error(`Failed to load script: ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load script: ${src}`)),
      { once: true },
    );
    document.body.appendChild(script);
  });
}

async function loadLegacyScripts() {
  for (const src of LEGACY_SCRIPT_SOURCES) {
    await loadScript(src);
  }
}

// Returns null if OK, or a string describing the failure reason.
async function checkReady() {
  try {
    const root = await navigator.storage.getDirectory();

    let markerFile;
    try {
      const fh = await root.getFileHandle("_game_ready");
      markerFile = await fh.getFile();
    } catch {
      return "OPFS marker '_game_ready' not found";
    }

    const version = await markerFile.text();
    if (version !== "v4") {
      return `OPFS marker version mismatch: got "${version}", expected "v4"`;
    }

    const requiredFiles = [
      ["vcbr", "vc-sky-en-v6.data", 100 * 1024 * 1024],
      ["vcbr", "vc-sky-en-v6.wasm", 0],
      ["vcsky", "sha256sums.txt", 0],
    ];

    for (const [directoryName, fileName, minSize] of requiredFiles) {
      let dir;
      try {
        dir = await root.getDirectoryHandle(directoryName);
      } catch {
        return `OPFS directory not found: ${directoryName}/`;
      }
      let fh;
      try {
        fh = await dir.getFileHandle(fileName);
      } catch {
        return `OPFS file not found: ${directoryName}/${fileName}`;
      }
      if (minSize > 0) {
        const f = await fh.getFile();
        if (f.size < minSize) {
          return `OPFS file too small: ${directoryName}/${fileName} is ${(f.size / 1024 / 1024).toFixed(1)} MB, need > ${minSize / 1024 / 1024} MB`;
        }
      }
    }

    return null;
  } catch (err) {
    return `checkReady error: ${err.message}`;
  }
}

// Returns null if OK, or a string describing the failure reason.
async function verifyGameServing() {
  const requiredUrls = [
    "/vcbr/vc-sky-en-v6.data",
    "/vcbr/vc-sky-en-v6.wasm",
    "/vcsky/sha256sums.txt",
  ];

  try {
    for (const url of requiredUrls) {
      let response;
      try {
        response = await fetch(url, { method: "HEAD", cache: "no-store" });
      } catch (err) {
        return `fetch failed for ${url}: ${err.message}`;
      }
      if (!response.ok) {
        return `SW served ${response.status} for ${url}`;
      }
    }

    return null;
  } catch (err) {
    return `verifyGameServing error: ${err.message}`;
  }
}

async function waitForGameReady(retries = 6, delayMs = 400) {
  let lastReason = "unknown";
  for (let attempt = 0; attempt < retries; attempt++) {
    const opfsReason = await checkReady();
    if (opfsReason !== null) {
      lastReason = opfsReason;
      console.warn(`[waitForGameReady] attempt ${attempt + 1}: ${opfsReason}`);
    } else {
      const servingReason = await verifyGameServing();
      if (servingReason !== null) {
        lastReason = servingReason;
        console.warn(`[waitForGameReady] attempt ${attempt + 1}: ${servingReason}`);
      } else {
        return { ready: true, reason: null };
      }
    }

    if (attempt < retries - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  return { ready: false, reason: lastReason };
}

async function resetGameData() {
  // Clear OPFS: delete all known directories and the marker file
  try {
    const root = await navigator.storage.getDirectory();
    for (const name of ["vcbr", "vcsky", "_game_ready"]) {
      try {
        await root.removeEntry(name, { recursive: true });
      } catch {
        // entry may not exist
      }
    }
  } catch (err) {
    console.warn("[reset] OPFS clear failed:", err);
  }

  // Only this game's databases: the origin (e.g. <user>.github.io) is shared
  // with other sites. Skins: USERDATA_DB in shared.js. Saves: the engine's
  // IDBFS mount, named after its directory (SAVE_DIR in saves.js).
  try {
    await Promise.all(
      ["vc-userdata", "/vc-assets/local/userfiles"].map(
        (name) =>
          new Promise((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = resolve;
            req.onerror = resolve;
            req.onblocked = resolve;
          }),
      ),
    );
  } catch (err) {
    console.warn("[reset] IndexedDB clear failed:", err);
  }
}

async function initSetupFlow() {
  const overlay = document.getElementById("setup-overlay");
  const downloadLink = document.getElementById("dl-link");
  const fileInput = document.getElementById("game-file-input");
  const progress = document.getElementById("setup-progress");
  const progressBar = document.getElementById("setup-progress-bar");
  const progressLabel = document.getElementById("setup-progress-label");
  const progressPercent = document.getElementById("setup-progress-percent");
  const errorBox = document.getElementById("setup-error");
  const storageStatus = document.getElementById("storage-status");
  const selectedFileName = document.getElementById("selected-file-name");
  const clickToPlayButton = document.getElementById("click-to-play-button");
  const resetBtn = document.getElementById("reset-game-btn");

  if (
    !overlay ||
    !downloadLink ||
    !fileInput ||
    !progress ||
    !progressBar ||
    !progressLabel ||
    !progressPercent ||
    !errorBox ||
    !storageStatus ||
    !selectedFileName ||
    !clickToPlayButton
  ) {
    return;
  }

  if (ASSET_RELEASE_URL) {
    downloadLink.href = ASSET_RELEASE_URL;
  } else {
    // No archive URL configured for this build (VITE_ASSET_URL unset).
    downloadLink.style.display = "none";
  }

  // true while the automatic import (download link) is running: its errors are
  // shown on the loading screen itself instead of sending the person to the setup page.
  let autoImportActive = false;

  const showError = (key, options) => {
    if (autoImportActive) cypherLoader.error(t(key, options));
    else cypherLoader.fail();
    errorBox.style.display = "block";
    setText(errorBox, key, options);
  };

  const setStorageStatus = (key, state) => {
    setText(storageStatus, key);
    storageStatus.dataset.state = state;
  };

  const setPlayAvailability = (enabled) => {
    window.__gtaGameReady = enabled;
    clickToPlayButton.disabled = !enabled;
    clickToPlayButton.classList.toggle("disabled", !enabled);
    if (resetBtn) resetBtn.classList.toggle("hidden", !enabled);
    if (enabled) {
      forgetTemporaryGameUrl();
      maybeAutoStart();
    }
  };

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (
        !confirm(
          t("setup.resetConfirm"),
        )
      ) {
        return;
      }
      resetBtn.disabled = true;
      setText(resetBtn, "setup.resetting");
      await resetGameData();
      setStorageStatus("status.missing", "missing");
      setPlayAvailability(false);
      progress.style.display = "none";
      errorBox.style.display = "none";
      setText(selectedFileName, "setup.noFile");
      fileInput.value = "";
      resetBtn.disabled = false;
      setText(resetBtn, "setup.reset");
    });
  }

  // source: a File (manual pick) or { url } (automatic import)
  const runImport = async (source) => {
    autoImportActive = !(source instanceof File);
    errorBox.style.display = "none";
    document
      .querySelectorAll(".setup-actions-panel")
      .forEach((element) => (element.style.opacity = "0.5"));
    progress.style.display = "block";
    setText(progressLabel, "progress.readingFile");
    progressPercent.textContent = "0%";
    progressBar.style.width = "0%";
    setPlayAvailability(false);

    const worker = new Worker(`${BASE}extract-worker.js`);
    worker.onerror = (error) => {
      console.error("[worker error]", error);
      showError("errors.worker", { message: error.message });
      document
        .querySelectorAll(".setup-actions-panel")
        .forEach((element) => (element.style.opacity = "1"));
    };
    worker.postMessage(source instanceof File ? { file: source } : source);
    worker.onmessage = async (event) => {
      const message = event.data;
      console.log(
        "[worker]",
        message.type,
        message.phase || "",
        message.pct || "",
      );

      if (message.type === "progress") {
        cypherLoader.progress("import", message.pct);
        cypherLoader.detail(
          {
            reading: "progress.reading",
            decompressing: "progress.decompressing",
            extracting: "progress.extracting",
          }[message.phase] || "progress.working",
          { done: message.done || 0, total: message.total || "" },
        );
        progressBar.style.width = `${message.pct}%`;
        progressPercent.textContent = `${message.pct}%`;
        const labels = {
          reading: "progress.reading",
          decompressing: "progress.decompressing",
          extracting: "progress.extracting",
        };
        setText(progressLabel, labels[message.phase] || "progress.working", {
          done: message.done || 0,
          total: message.total || "",
        });
        return;
      }

      if (message.type === "done") {
        progressBar.style.width = "100%";
        progressPercent.textContent = "100%";
        setText(progressLabel, "progress.verifying");
        const { ready: isReady, reason } = await waitForGameReady();
        setStorageStatus(
          isReady ? "status.ready" : "status.missing",
          isReady ? "ready" : "missing",
        );
        setPlayAvailability(isReady);
        if (isReady) {
          setText(progressLabel, "progress.complete");
          // Next stage: the game data download (reported by game.js).
          cypherLoader.progress("download", 0);
          cypherLoader.detail(null);
        } else {
          if (autoImportActive) cypherLoader.error(t("progress.verifyFailed", { reason }));
          else cypherLoader.fail();
          setText(progressLabel, "progress.verifyFailed", { reason });
        }
        document
          .querySelectorAll(".setup-actions-panel")
          .forEach((element) => (element.style.opacity = "1"));
        worker.terminate();
        return;
      }

      if (message.type === "error") {
        showError("errors.generic", { message: message.message });
        document
          .querySelectorAll(".setup-actions-panel")
          .forEach((element) => (element.style.opacity = "1"));
        worker.terminate();
      }
    };
  };

  setPlayAvailability(false);

  if (
    !("serviceWorker" in navigator) ||
    !("storage" in navigator && navigator.storage.getDirectory)
  ) {
    showError("errors.apis");
    return;
  }

  try {
    if (isLocalDevEnvironment()) {
      console.log("[setup] local dev detected, refreshing SW registration");
      await clearDevelopmentServiceWorkers();
    }

    console.log("[setup] registering SW...");
    await navigator.serviceWorker.register(`${BASE}sw.js`, { updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    console.log("[setup] SW ready");

    if (!navigator.serviceWorker.controller) {
      console.log("[setup] SW not yet controlling page — reloading...");
      window.location.reload();
      return;
    }
  } catch (error) {
    showError("errors.serviceWorker", { message: error.message });
    return;
  }

  const { ready, reason } = await waitForGameReady(2, 150);
  console.log("[setup] game ready in OPFS:", ready, reason || "");
  if (ready) {
    setStorageStatus("status.ready", "ready");
    setPlayAvailability(true);
    progress.style.display = "none";
    return;
  }

  setStorageStatus("status.missing", "missing");

  fileInput.addEventListener("change", async () => {
    console.log("[setup] file selected:", fileInput.files[0]?.name);
    const file = fileInput.files[0];
    if (!file) {
      setText(selectedFileName, "setup.noFile");
      return;
    }

    setRawText(selectedFileName, file.name);

    if (!/\.tar\.gz$|\.gz$/i.test(file.name)) {
      showError("errors.wrongFile");
      return;
    }

    await runImport(file);
  });

  // First run on this browser: import the archive that ships with the site.
  // Archive on another origin (cloud storage): a HEAD probe would need CORS
  // too, so just try the download and fall back to the manual picker on error.
  const archiveIsRemote =
    new URL(GAME_ARCHIVE_URL, window.location.href).origin !==
    window.location.origin;
  if (AUTO_IMPORT && (archiveIsRemote || (await archiveAvailable()))) {
    console.log("[setup] auto-importing", GAME_ARCHIVE_URL);
    setRawText(selectedFileName, "game.tar.gz");
    await runImport({ url: GAME_ARCHIVE_URL });
    return;
  }

  console.log("[setup] waiting for file selection");
  cypherLoader.fail();
}

function initCanvasBindings() {
  const canvas = document.getElementById("canvas");
  if (!canvas) {
    return;
  }

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}

function checkBrowserCompatibility() {
  const missing = [];

  if (!("serviceWorker" in navigator)) missing.push("Service Workers");
  if (!("storage" in navigator) || !("getDirectory" in navigator.storage)) missing.push("OPFS");
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  if (typeof Worker === "undefined") missing.push("Web Workers");

  return missing;
}

function initOrientationLock() {
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains("gameIsStarted")) {
      observer.disconnect();
      screen.orientation?.lock("landscape").catch(() => {});
    }
  });
  observer.observe(document.body, { attributeFilter: ["class"] });
}

function initLanguagePicker() {
  const select = document.getElementById("ui-lang");
  if (!select) return;

  select.replaceChildren(
    ...LANGUAGES.map(({ code, label }) => new Option(label, code)),
  );
  select.value = currentLanguage();
  select.addEventListener("change", () => {
    void changeLanguage(select.value);
  });
}

async function boot() {
  applyTranslations();
  // Manual mode (?autostart=0 / ?autoimport=0): show the setup page, not the loader.
  if (!AUTO_START || !AUTO_IMPORT) cypherLoader.fail();
  else cypherLoader.start();
  initLanguagePicker();
  initCanvasBindings();
  initOrientationLock();

  const missing = checkBrowserCompatibility();
  if (missing.length > 0) {
    cypherLoader.fail();
    const storageStatus = document.getElementById("storage-status");
    const errorBox = document.getElementById("setup-error");
    if (storageStatus) {
      setText(storageStatus, "status.unsupported");
      storageStatus.dataset.state = "error";
    }
    if (errorBox) {
      errorBox.style.display = "block";
      setText(errorBox, "errors.missingFeatures", { features: missing.join(", ") });
    }
    return;
  }

  await initSetupFlow();
  try {
    await loadLegacyScripts();
    maybeAutoStart();
  } catch (err) {
    showScriptLoadError(err);
  }
}

// A script can fail to load right after a deploy, when the browser still has
// the previous page cached but the files it asks for are gone. Say so instead
// of leaving a Start button that does nothing.
function showScriptLoadError(err) {
  console.error("[boot] failed to load a game script:", err);
  cypherLoader.fail();
  const file = String(err && err.message).split("/").pop();

  const startButton = document.getElementById("click-to-play-button");
  if (startButton) {
    startButton.disabled = true;
    startButton.classList.add("disabled");
  }
  const storageStatus = document.getElementById("storage-status");
  if (storageStatus) {
    setText(storageStatus, "status.loadFailed");
    storageStatus.dataset.state = "error";
  }
  const errorBox = document.getElementById("setup-error");
  if (errorBox) {
    errorBox.style.display = "block";
    setText(errorBox, "errors.scriptLoad", { file });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void boot();
  });
} else {
  void boot();
}
