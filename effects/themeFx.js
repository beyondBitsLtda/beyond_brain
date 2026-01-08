const INVERT_CLASS = "fx-invert";
const INVERT_DURATION = 3000;
const LIGHTNING_CLASS = "fx-lightning";
const LIGHTNING_ID = "theme-lightning";

const LIGHTNING_MIN_DELAY = 4000;
const LIGHTNING_MAX_DELAY = 14000;
const DOUBLE_FLASH_DELAY = 150;
const DOUBLE_FLASH_CHANCE = 0.2;

let invertTimeoutId = null;
let lightningTimeoutId = null;
let doubleFlashTimeoutId = null;
let lightningActive = false;
let lightningLayer = null;

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensureLightningLayer() {
  if (lightningLayer) return lightningLayer;
  if (!document.body) return null;

  lightningLayer = document.createElement("div");
  lightningLayer.id = LIGHTNING_ID;
  lightningLayer.setAttribute("aria-hidden", "true");
  lightningLayer.addEventListener("animationend", () => {
    lightningLayer?.classList.remove(LIGHTNING_CLASS);
  });
  document.body.appendChild(lightningLayer);
  return lightningLayer;
}

function triggerLightningFlash() {
  const layer = ensureLightningLayer();
  if (!layer) return;

  layer.classList.remove(LIGHTNING_CLASS);
  void layer.offsetWidth;
  layer.classList.add(LIGHTNING_CLASS);

  if (Math.random() < DOUBLE_FLASH_CHANCE) {
    clearTimeout(doubleFlashTimeoutId);
    doubleFlashTimeoutId = setTimeout(() => {
      layer.classList.remove(LIGHTNING_CLASS);
      void layer.offsetWidth;
      layer.classList.add(LIGHTNING_CLASS);
    }, DOUBLE_FLASH_DELAY);
  }
}

function scheduleLightning() {
  if (!lightningActive) return;
  const delay = randomBetween(LIGHTNING_MIN_DELAY, LIGHTNING_MAX_DELAY);
  lightningTimeoutId = setTimeout(() => {
    triggerLightningFlash();
    scheduleLightning();
  }, delay);
}

export function startSteveLightning() {
  if (lightningActive) return;
  lightningActive = true;
  ensureLightningLayer();
  scheduleLightning();
}

export function stopSteveLightning() {
  lightningActive = false;
  clearTimeout(lightningTimeoutId);
  clearTimeout(doubleFlashTimeoutId);
  lightningTimeoutId = null;
  doubleFlashTimeoutId = null;
  if (lightningLayer) {
    lightningLayer.classList.remove(LIGHTNING_CLASS);
  }
}

export function applyThemeFx(themeKey) {
  if (themeKey === "steve") {
    startSteveLightning();
    return;
  }
  stopSteveLightning();
}

export function triggerInvertOnce() {
  const body = document.body;
  if (!body) return;

  body.classList.add(INVERT_CLASS);
  if (invertTimeoutId) {
    clearTimeout(invertTimeoutId);
  }
  invertTimeoutId = setTimeout(() => {
    body.classList.remove(INVERT_CLASS);
    invertTimeoutId = null;
  }, INVERT_DURATION);
}
