let instance = null;

function createMenuElement() {
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  document.body.appendChild(menu);
  return menu;
}

function positionMenu(menu, x, y) {
  const padding = 8;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const rect = menu.getBoundingClientRect();
  let left = x;
  let top = y;

  if (rect.right > window.innerWidth - padding) {
    left = Math.max(padding, window.innerWidth - rect.width - padding);
  }
  if (rect.bottom > window.innerHeight - padding) {
    top = Math.max(padding, window.innerHeight - rect.height - padding);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function createContextMenu() {
  if (instance) {
    return instance;
  }

  const menu = createMenuElement();
  let openState = false;

  function close() {
    if (!openState) return;
    menu.hidden = true;
    menu.innerHTML = "";
    openState = false;
  }

  function open(x, y, items = []) {
    menu.innerHTML = "";
    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-menu__item";
      if (item.danger) {
        button.classList.add("context-menu__item--danger");
      }
      button.textContent = item.label;
      button.addEventListener("click", () => {
        close();
        item.action?.();
      });
      menu.appendChild(button);
    });

    if (items.length === 0) {
      close();
      return;
    }

    menu.hidden = false;
    openState = true;
    positionMenu(menu, x, y);
  }

  document.addEventListener("pointerdown", (event) => {
    if (!openState) return;
    if (event.target.closest(".context-menu")) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!openState) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  window.addEventListener("scroll", () => {
    if (!openState) return;
    close();
  }, { capture: true });

  window.addEventListener("resize", () => {
    if (!openState) return;
    close();
  });

  instance = { open, close };
  return instance;
}
