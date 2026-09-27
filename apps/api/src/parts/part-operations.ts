import { createPartCommand, partListQuery, setPartActiveCommand, updatePartCommand } from '@partledger/contracts';

import { registerCommand, registerQuery, type CommandRegistration, type QueryRegistration } from '../commands/handlers';
import { CreatePartHandler, PartListHandler, SetPartActiveHandler, UpdatePartHandler } from './parts.handlers';

export const partCommandRegistrations: readonly CommandRegistration[] = [
  registerCommand(createPartCommand, CreatePartHandler),
  registerCommand(updatePartCommand, UpdatePartHandler),
  registerCommand(setPartActiveCommand, SetPartActiveHandler),
];

export const partQueryRegistrations: readonly QueryRegistration[] = [registerQuery(partListQuery, PartListHandler)];
