let instance = null;

function resolveRoot() {
  return (
    document.querySelector("#terminalRoot") ||
    document.querySelector(".terminal-shell") ||
    document.querySelector("#app") ||
    document.querySelector(".terminal") ||
    document.body
  );
}

function createPopoverElement() {
  const popover = document.createElement("div");
  popover.className = "action-popover";
  popover.setAttribute("role", "menu");
  popover.hidden = true;
  const root = resolveRoot();
  root.appendChild(popover);
  return popover;
}

function createTitleElement(text) {
  if (!text) return null;
  const title = document.createElement("div");
  title.className = "action-popover__title";
  title.textContent = text;
  return title;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function positionPopover(popover, x, y, rootRect) {
  const padding = 8;
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  const rect = popover.getBoundingClientRect();
  const containerWidth = rootRect?.width ?? window.innerWidth;
  const containerHeight = rootRect?.height ?? window.innerHeight;
  let left = x;
  let top = y;

  if (top + rect.height > containerHeight - padding) {
    const aboveTop = top - rect.height - 8;
    if (aboveTop >= padding) {
      top = aboveTop;
    }
  }

  left = clamp(left, padding, containerWidth - rect.width - padding);
  top = clamp(top, padding, containerHeight - rect.height - padding);

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function resolvePosition({ anchorRect, x, y, rootRect }) {
  if (anchorRect) {
    return {
      x: anchorRect.right - (rootRect?.left ?? 0) + 8,
      y: anchorRect.top - (rootRect?.top ?? 0),
    };
  }
  return { x: x ?? 0, y: y ?? 0 };
}

export function createActionPopover() {
  if (instance) {
    return instance;
  }

  const popover = createPopoverElement();
  let openState = false;
  let currentKey = null;
  let cleanup = [];

  function removeListeners() {
    cleanup.forEach((handler) => handler());
    cleanup = [];
  }

  function close() {
    if (!openState) return;
    popover.hidden = true;
    popover.innerHTML = "";
    openState = false;
    currentKey = null;
    removeListeners();
  }

  function open({ anchorRect, x, y, title, items = [], key } = {}) {
    popover.innerHTML = "";
    const titleEl = createTitleElement(title);
    if (titleEl) {
      popover.appendChild(titleEl);
    }
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-popover__item";
      if (item.danger) {
        button.classList.add("action-popover__item--danger");
      }
      button.textContent = item.label;
      button.addEventListener("click", () => {
        close();
        item.action?.();
      });
      popover.appendChild(button);
    });

    if (items.length === 0) {
      close();
      return;
    }

    popover.hidden = false;
    openState = true;
    currentKey = key ?? null;
    const rootRect = popover.parentElement?.getBoundingClientRect();
    const position = resolvePosition({ anchorRect, x, y, rootRect });
    positionPopover(popover, position.x, position.y, rootRect);

    const handlePointerDown = (event) => {
      if (!openState) return;
      if (event.target.closest(".action-popover")) return;
      close();
    };

    const handleKeydown = (event) => {
      if (!openState) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    const handleScroll = () => {
      if (!openState) return;
      close();
    };

    const handleResize = () => {
      if (!openState) return;
      close();
    };

    const handlePopoverPointerDown = (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handlePopoverClick = (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("scroll", handleScroll, { capture: true });
    window.addEventListener("resize", handleResize);
    popover.addEventListener("pointerdown", handlePopoverPointerDown);
    popover.addEventListener("click", handlePopoverClick);

    cleanup = [
      () => document.removeEventListener("pointerdown", handlePointerDown),
      () => document.removeEventListener("keydown", handleKeydown),
      () => window.removeEventListener("scroll", handleScroll, { capture: true }),
      () => window.removeEventListener("resize", handleResize),
      () => popover.removeEventListener("pointerdown", handlePopoverPointerDown),
      () => popover.removeEventListener("click", handlePopoverClick),
    ];
  }

  function toggle(key, options = {}) {
    if (openState && key && currentKey === key) {
      close();
      return;
    }
    open({ ...options, key });
  }

  instance = { open, close, toggle };
  return instance;
}
