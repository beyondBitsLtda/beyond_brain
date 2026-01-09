import { createEventBus } from "./eventBus.js";
import { createTerminalUI } from "./terminalUI.js";
import { createGraphUI } from "./graphUI.js";
import { createCommandRouter } from "./commandRouter.js";
import { createFocusManager } from "./focusManager.js";
import { helpCommand } from "./commands/help.js";
import { clearCommand } from "./commands/clear.js";
import { pingCommand } from "./commands/ping.js";
import { authCommand, bootstrapSession } from "./commands/auth.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { linkCommand, relsCommand, unlinkCommand } from "./commands/rels.js";
import {
  deleteNoteCommand,
  insertNoteCommand,
  selectNoteCommand,
  updateNoteCommand,
} from "./commands/notes.js";
import { graphCommand } from "./commands/graph.js";
import { resetBrainCommand } from "./commands/resetBrain.js";
import { nowCommand } from "./commands/now.js";
import { lastCommand } from "./commands/last.js";
import { focusCommand } from "./commands/focus.js";
import { themeCommand } from "./commands/theme.js";
import { loadTheme } from "./themeManager.js";
import { createPetManager } from "./petManager.js";
import { petCommand } from "./commands/pet.js";
import { steveCommand } from "./commands/steve.js";
import { starCommand } from "./commands/star.js";
import { xpCommand } from "./commands/xp.js";
import { iaCommand } from "./commands/ia.js";
import { createMicController } from "./voice/micController.js";

const bus = createEventBus();
const focusManager = createFocusManager(bus);
const initialTheme = loadTheme();
const petManager = createPetManager(bus);
const micController = createMicController(bus);

const ui = createTerminalUI(bus);
ui.showIntro();
createGraphUI(bus, focusManager);

const commands = {
  help: helpCommand(bus),
  clear: clearCommand(bus),
  ping: pingCommand(bus),
  auth: authCommand({ bus }),
  logout: logoutCommand(bus),
  whoami: whoamiCommand(bus),
  LINK: linkCommand(bus),
  link: linkCommand(bus),
  UNLINK: unlinkCommand(bus),
  unlink: unlinkCommand(bus),
  rels: relsCommand(bus),
  INSERT: insertNoteCommand(bus),
  insert: insertNoteCommand(bus),
  SELECT: selectNoteCommand(bus, focusManager),
  select: selectNoteCommand(bus, focusManager),
  UPDATE: updateNoteCommand(bus),
  update: updateNoteCommand(bus),
  DELETE: deleteNoteCommand(bus),
  delete: deleteNoteCommand(bus),
  now: nowCommand(bus),
  NOW: nowCommand(bus),
  last: lastCommand(bus),
  LAST: lastCommand(bus),
  graph: graphCommand(bus),
  focus: focusCommand(bus, focusManager),
  FOCUS: focusCommand(bus, focusManager),
  RESET: resetBrainCommand(bus),
  reset: resetBrainCommand(bus),
  NUKE: resetBrainCommand(bus),
  nuke: resetBrainCommand(bus),
  theme: themeCommand(bus),
  pet: petCommand(bus, petManager),
  steve: steveCommand(bus),
  star: starCommand(bus),
  xp: xpCommand(bus),
  IA: iaCommand(bus),
  ia: iaCommand(bus),
  mic: () => micController.open(),
};

createCommandRouter(bus, commands);
bus.emit("theme:change", { key: initialTheme });

bootstrapSession(bus);
