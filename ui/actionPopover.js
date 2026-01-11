let instance = null;

function createPopoverElement() {
  const popover = document.createElement("div");
  popover.className = "action-popover";
  popover.setAttribute("role", "menu");
  popover.hidden = true;
  document.body.appendChild(popover);
  return popover;
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
    removeListeners();
  }

  function open({ anchorRect, x, y, items = [] } = {}) {
    popover.innerHTML = "";
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

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    window.addEventListener("scroll", handleScroll, { capture: true });
    window.addEventListener("resize", handleResize);

    cleanup = [
      () => document.removeEventListener("pointerdown", handlePointerDown),
      () => document.removeEventListener("keydown", handleKeydown),
      () => window.removeEventListener("scroll", handleScroll, { capture: true }),
      () => window.removeEventListener("resize", handleResize),
    ];
  }

  instance = { open, close };
  return instance;
}
