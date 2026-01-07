import { createEventBus } from "./eventBus.js";
import { createTerminalUI } from "./terminalUI.js";
import { createGraphUI } from "./graphUI.js";
import { createCommandRouter } from "./commandRouter.js";
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

const bus = createEventBus();

const ui = createTerminalUI(bus);
ui.showIntro();
createGraphUI(bus);

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
  SELECT: selectNoteCommand(bus),
  select: selectNoteCommand(bus),
  UPDATE: updateNoteCommand(bus),
  update: updateNoteCommand(bus),
  DELETE: deleteNoteCommand(bus),
  delete: deleteNoteCommand(bus),
  graph: graphCommand(bus),
};

createCommandRouter(bus, commands);

bootstrapSession(bus);
