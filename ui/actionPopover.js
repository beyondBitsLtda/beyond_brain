let instance = null;

function createPopoverElement() {
  const popover = document.createElement("div");
  popover.className = "action-popover";
  popover.setAttribute("role", "menu");
  popover.hidden = true;
  document.body.appendChild(popover);
  return popover;
}

function createTitleElement(text) {
  if (!text) return null;
  const title = document.createElement("div");
  title.className = "action-popover__title";
  title.textContent = text;
  return title;
}

function positionPopover(popover, x, y) {
  const padding = 8;
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  const rect = popover.getBoundingClientRect();
  let left = x;
  let top = y;

  if (rect.right > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - rect.width - padding);
  }
  if (rect.bottom > window.innerHeight - padding) {
    top = Math.max(padding, window.innerHeight - rect.height - padding);
  }

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function resolvePosition({ anchorRect, x, y }) {
  if (anchorRect) {
    return {
      x: anchorRect.right + 8,
      y: anchorRect.top,
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
    const position = resolvePosition({ anchorRect, x, y });
    positionPopover(popover, position.x, position.y);

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
