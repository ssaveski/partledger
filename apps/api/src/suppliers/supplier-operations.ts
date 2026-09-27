import {
  addContactCommand,
  checkIdentityCommand,
  createSupplierCommand,
  removeContactCommand,
  setApprovalCommand,
  setSupplierStatusCommand,
  supplierDetailQuery,
  supplierListQuery,
  updateSupplierCommand,
} from '@partledger/contracts';

import { registerCommand, registerQuery, type CommandRegistration, type QueryRegistration } from '../commands/handlers';
import {
  AddContactHandler,
  CheckIdentityHandler,
  CreateSupplierHandler,
  RemoveContactHandler,
  SetApprovalHandler,
  SetSupplierStatusHandler,
  SupplierDetailHandler,
  SupplierListHandler,
  UpdateSupplierHandler,
} from './suppliers.handlers';

export const supplierCommandRegistrations: readonly CommandRegistration[] = [
  registerCommand(createSupplierCommand, CreateSupplierHandler),
  registerCommand(updateSupplierCommand, UpdateSupplierHandler),
  registerCommand(setSupplierStatusCommand, SetSupplierStatusHandler),
  registerCommand(addContactCommand, AddContactHandler),
  registerCommand(removeContactCommand, RemoveContactHandler),
  registerCommand(setApprovalCommand, SetApprovalHandler),
  registerCommand(checkIdentityCommand, CheckIdentityHandler),
];

export const supplierQueryRegistrations: readonly QueryRegistration[] = [
  registerQuery(supplierListQuery, SupplierListHandler),
  registerQuery(supplierDetailQuery, SupplierDetailHandler),
];
