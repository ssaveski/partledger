import {
  currentMemberQuery,
  grantRoleCommand,
  inviteMemberCommand,
  listMembersQuery,
  removeMemberCommand,
  revokeRoleCommand,
} from '@partledger/contracts';

import { registerCommand, registerQuery, type CommandRegistration, type QueryRegistration } from '../commands/handlers';
import {
  CurrentMemberHandler,
  GrantRoleHandler,
  InviteMemberHandler,
  ListMembersHandler,
  RemoveMemberHandler,
  RevokeRoleHandler,
} from './members.handlers';

export const tenantCommands: readonly CommandRegistration[] = [
  registerCommand(inviteMemberCommand, InviteMemberHandler),
  registerCommand(removeMemberCommand, RemoveMemberHandler),
  registerCommand(grantRoleCommand, GrantRoleHandler),
  registerCommand(revokeRoleCommand, RevokeRoleHandler),
];

export const tenantQueries: readonly QueryRegistration[] = [
  registerQuery(listMembersQuery, ListMembersHandler),
  registerQuery(currentMemberQuery, CurrentMemberHandler),
];
