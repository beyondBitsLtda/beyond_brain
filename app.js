import { createEventBus } from "./eventBus.js";
import { createTerminalUI } from "./terminalUI.js";
import { createCommandRouter } from "./commandRouter.js";
import { helpCommand } from "./commands/help.js";
import { clearCommand } from "./commands/clear.js";

const bus = createEventBus();

const ui = createTerminalUI(bus);
ui.showIntro();

const commands = {
  help: helpCommand(bus),
  clear: clearCommand(bus),
};

createCommandRouter(bus, commands);
