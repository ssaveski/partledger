import { zodResolver } from '@hookform/resolvers/zod';
import {
  currentMemberQuery,
  grantRoleCommand,
  inviteMemberCommand,
  listMembersQuery,
  removeMemberCommand,
  revokeRoleCommand,
  tenantRoles,
  type Member,
  type TenantRole,
} from '@partledger/contracts';
import type { ClientFailure } from '@partledger/contracts/client';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  useTranslate,
} from '@partledger/ui';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlusIcon } from 'lucide-react';
import { useId, useRef, useState, type RefObject } from 'react';
import { useForm, type FieldError as FormFieldError, type UseFormRegisterReturn } from 'react-hook-form';
import type { z } from 'zod';

import { queryKeyOf, useApiClient, useApiQuery } from '../../api/api-client';
import { formatDate } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { sessionQueryKey, useSession } from '../../shell/session-provider';
import { roleMessageKey } from '../../shell/session-view';
import {
  createIdempotencyKeys,
  inviteFormSchema,
  refusalMessageKey,
  roleChanges,
  type IdempotencyKeys,
  type InviteForm,
} from './member-changes';

type Notice = { readonly key: string; readonly name: string } | null;

/**
 * Members and their roles (R3), for tenant administrators. Every change is a server command
 * that the API audits with the administrator as its actor; role changes demand a recent
 * step-up (KTD20), so a refusal asks the administrator to confirm their identity.
 */
export function MembersScreen() {
  const query = useApiQuery(listMembersQuery, {});
  return (
    <QueryView query={query} titleKey="pl.tenants.members.title" loadingKey="pl.tenants.members.loading">
      {({ members }) => <MembersPage members={members} />}
    </QueryView>
  );
}

function MembersPage({ members }: { members: readonly Member[] }) {
  const translate = useTranslate();
  const { signedIn } = useSession();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<Notice>(null);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [keys] = useState(createIdempotencyKeys);
  const inviteButton = useRef<HTMLButtonElement>(null);
  const actionButtons = useRef(new Map<string, HTMLElement>());
  const removalOpener = useRef<HTMLElement | null>(null);
  const removalSucceeded = useRef(false);
  const tenant = signedIn.tenant.displayName;

  /** Reads the list again; a change to the signed-in member also re-reads their own roles and session. */
  const refresh = async (next: Notice, target: string) => {
    setNotice(next);
    const reads = [queryClient.invalidateQueries({ queryKey: queryKeyOf(listMembersQuery, {}) })];
    if (target === signedIn.member.userId) {
      reads.push(
        queryClient.invalidateQueries({ queryKey: queryKeyOf(currentMemberQuery, {}) }),
        queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
      );
    }
    await Promise.all(reads);
  };

  const register = (buttons: Map<string, HTMLElement>, userId: string) => (element: HTMLElement | null) => {
    if (element === null) {
      buttons.delete(userId);
    } else {
      buttons.set(userId, element);
    }
  };

  const focusBack = (userId: string | undefined): RefObject<HTMLElement | null> => ({
    current: (userId === undefined ? undefined : actionButtons.current.get(userId)) ?? inviteButton.current,
  });

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{translate('pl.tenants.members.title')}</h1>
          <p className="max-w-prose text-muted">{translate('pl.tenants.members.description', { tenant })}</p>
        </div>
        <Button
          ref={inviteButton}
          onClick={() => {
            setInviting(true);
          }}
        >
          <UserPlusIcon aria-hidden />
          {translate('pl.tenants.members.invite')}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-success">
        {notice === null ? null : translate(notice.key, { name: notice.name })}
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{translate('pl.tenants.members.tableLabel', { tenant })}</caption>
          <thead className="bg-surface-sunken">
            <tr>
              {(['name', 'email', 'roles', 'invited', 'actions'] as const).map((column) => (
                <th key={column} scope="col" className="px-4 py-2 font-semibold">
                  {translate(`pl.tenants.members.column.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.userId} className="border-t border-line align-top">
                <th scope="row" className="px-4 py-3 font-medium">
                  {member.displayName}
                  {member.userId === signedIn.member.userId ? (
                    <span className="ml-1 text-muted">{translate('pl.tenants.members.you')}</span>
                  ) : null}
                </th>
                <td className="px-4 py-3 break-all">{member.email}</td>
                <td className="px-4 py-3">
                  {member.roles.length === 0 ? (
                    <span className="text-muted">{translate('pl.tenants.members.noRoles')}</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1">
                      {member.roles.map((role) => (
                        <li key={role}>
                          <Badge>{translate(roleMessageKey(role))}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(member.invitedAt.slice(0, 10))}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      ref={register(actionButtons.current, member.userId)}
                      aria-label={translate('pl.tenants.members.changeRolesFor', { name: member.displayName })}
                      onClick={() => {
                        setEditing(member);
                      }}
                    >
                      {translate('pl.tenants.members.changeRoles')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={translate('pl.tenants.members.removeFor', { name: member.displayName })}
                      onClick={(event) => {
                        removalOpener.current = event.currentTarget;
                        removalSucceeded.current = false;
                        setRemoving(member);
                      }}
                    >
                      {translate('pl.tenants.members.remove')}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members.length <= 1 ? (
        <EmptyState
          titleKey="pl.tenants.members.empty.title"
          descriptionKey="pl.tenants.members.empty.description"
          action={null}
        />
      ) : null}
      <InviteDialog
        open={inviting}
        returnFocusTo={inviteButton}
        onClose={() => {
          setInviting(false);
        }}
        keys={keys}
        onInvited={(name, userId) => {
          setInviting(false);
          void refresh({ key: 'pl.tenants.members.invited', name }, userId);
        }}
      />
      <RolesDialog
        member={editing}
        returnFocusTo={focusBack(editing?.userId)}
        onClose={() => {
          setEditing(null);
        }}
        keys={keys}
        onSaved={(member) => {
          setEditing(null);
          void refresh({ key: 'pl.tenants.members.rolesSaved', name: member.displayName }, member.userId);
        }}
        onRefused={(member) => {
          // Changes made before the refusal stand, so the list shows them.
          void refresh(null, member.userId);
        }}
      />
      <RemoveDialog
        member={removing}
        keys={keys}
        // Back to the Remove button that opened it; once that member is gone, to Invite.
        returnFocus={() => (removalSucceeded.current ? inviteButton.current : removalOpener.current)}
        onClose={() => {
          setRemoving(null);
        }}
        onRemoved={(member) => {
          removalSucceeded.current = true;
          setRemoving(null);
          void refresh({ key: 'pl.tenants.members.removed', name: member.displayName }, member.userId);
        }}
      />
    </>
  );
}

/** A command's refusal, shown where the person acted, as its message key. */
function Refusal({ failure }: { failure: ClientFailure | null }) {
  const translate = useTranslate();
  if (failure === null) {
    return null;
  }
  const key = refusalMessageKey(failure);
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {translate(key)}
    </p>
  );
}

function InviteDialog({
  open,
  returnFocusTo,
  keys,
  onClose,
  onInvited,
}: {
  open: boolean;
  returnFocusTo: RefObject<HTMLElement | null>;
  keys: IdempotencyKeys;
  onClose: () => void;
  onInvited: (name: string, userId: string) => void;
}) {
  const translate = useTranslate();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent finalFocus={() => returnFocusTo.current ?? true}>
        <DialogTitle>{translate('pl.tenants.members.inviteDialog.title')}</DialogTitle>
        <DialogDescription>{translate('pl.tenants.members.inviteDialog.description')}</DialogDescription>
        {open ? <InviteMemberForm keys={keys} onInvited={onInvited} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteMemberForm({
  keys,
  onInvited,
}: {
  keys: IdempotencyKeys;
  onInvited: (name: string, userId: string) => void;
}) {
  const translate = useTranslate();
  const client = useApiClient();
  const [failure, setFailure] = useState<ClientFailure | null>(null);
  const form = useForm<z.input<typeof inviteFormSchema>, unknown, InviteForm>({
    defaultValues: { email: '', displayName: '' },
    resolver: zodResolver(inviteFormSchema),
    shouldFocusError: true,
  });
  const errors = form.formState.errors;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void form.handleSubmit(async (invitation) => {
          setFailure(null);
          const change = `invite:${invitation.email}`;
          const result = await client.command(inviteMemberCommand, invitation, keys.keyFor(change));
          if (result.ok) {
            keys.settle(change);
            onInvited(invitation.displayName, result.value.userId);
          } else {
            setFailure(result.failure);
          }
        })(event);
      }}
    >
      <TextField
        labelKey="pl.tenants.members.inviteDialog.email"
        registration={form.register('email')}
        error={errors.email}
        type="email"
        autoComplete="off"
      />
      <TextField
        labelKey="pl.tenants.members.inviteDialog.displayName"
        registration={form.register('displayName')}
        error={errors.displayName}
        type="text"
        autoComplete="off"
      />
      <Refusal failure={failure} />
      <DialogFooter>
        <DialogClose>{translate('pl.tenants.members.inviteDialog.cancel')}</DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {translate(
            form.formState.isSubmitting ? 'pl.tenants.members.working' : 'pl.tenants.members.inviteDialog.submit',
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TextField({
  labelKey,
  registration,
  error,
  type,
  autoComplete,
}: {
  labelKey: string;
  registration: UseFormRegisterReturn;
  error: FormFieldError | undefined;
  type: 'email' | 'text';
  autoComplete: 'off';
}) {
  const translate = useTranslate();
  return (
    <Field invalid={error !== undefined}>
      <FieldLabel>{translate(labelKey)}</FieldLabel>
      <Input type={type} autoComplete={autoComplete} required {...registration} />
      {error?.message === undefined ? null : <FieldError match>{translate(error.message)}</FieldError>}
    </Field>
  );
}

function RolesDialog({
  member,
  returnFocusTo,
  keys,
  onClose,
  onSaved,
  onRefused,
}: {
  member: Member | null;
  returnFocusTo: RefObject<HTMLElement | null>;
  keys: IdempotencyKeys;
  onClose: () => void;
  onSaved: (member: Member) => void;
  onRefused: (member: Member) => void;
}) {
  const translate = useTranslate();
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <DialogContent finalFocus={() => returnFocusTo.current ?? true}>
        {member === null ? null : (
          <>
            <DialogTitle>{translate('pl.tenants.members.rolesDialog.title', { name: member.displayName })}</DialogTitle>
            <DialogDescription>{translate('pl.tenants.members.rolesDialog.description')}</DialogDescription>
            <RolesForm member={member} keys={keys} onSaved={onSaved} onRefused={onRefused} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RolesForm({
  member,
  keys,
  onSaved,
  onRefused,
}: {
  member: Member;
  keys: IdempotencyKeys;
  onSaved: (member: Member) => void;
  onRefused: (member: Member) => void;
}) {
  const translate = useTranslate();
  const client = useApiClient();
  const legend = useId();
  const [chosen, setChosen] = useState<readonly TenantRole[]>(member.roles);
  const [failure, setFailure] = useState<ClientFailure | null>(null);
  const [unchanged, setUnchanged] = useState(false);
  const [working, setWorking] = useState(false);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const changes = roleChanges(member.roles, chosen);
        setUnchanged(changes.length === 0);
        if (changes.length === 0) {
          return;
        }
        setWorking(true);
        setFailure(null);
        void (async () => {
          for (const { role, change } of changes) {
            const declaration = change === 'grant' ? grantRoleCommand : revokeRoleCommand;
            const scope = `${change}:${member.userId}:${role}`;
            const result = await client.command(declaration, { userId: member.userId, role }, keys.keyFor(scope));
            if (!result.ok) {
              setWorking(false);
              setFailure(result.failure);
              onRefused(member);
              return;
            }
            keys.settle(scope);
          }
          setWorking(false);
          onSaved(member);
        })();
      }}
    >
      <fieldset aria-labelledby={legend} className="flex flex-col gap-3">
        <legend id={legend} className="text-sm font-medium">
          {translate('pl.tenants.members.rolesDialog.legend')}
        </legend>
        {tenantRoles.map((role) => (
          <RoleOption
            key={role}
            role={role}
            checked={chosen.includes(role)}
            onChange={(checked) => {
              setChosen((current) =>
                checked ? [...current, role] : current.filter((candidate) => candidate !== role),
              );
            }}
          />
        ))}
      </fieldset>
      {unchanged ? (
        <p role="alert" className="text-sm text-muted">
          {translate('pl.tenants.members.rolesDialog.unchanged')}
        </p>
      ) : null}
      <Refusal failure={failure} />
      <DialogFooter>
        <DialogClose>{translate('pl.tenants.members.rolesDialog.cancel')}</DialogClose>
        <Button type="submit" disabled={working}>
          {translate(working ? 'pl.tenants.members.working' : 'pl.tenants.members.rolesDialog.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RoleOption({
  role,
  checked,
  onChange,
}: {
  role: TenantRole;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const translate = useTranslate();
  const label = useId();
  const description = useId();
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => {
          onChange(next);
        }}
        aria-labelledby={label}
        aria-describedby={description}
      />
      <div className="flex flex-col">
        <span id={label} className="text-sm font-medium">
          {translate(roleMessageKey(role))}
        </span>
        <span id={description} className="text-sm text-muted">
          {translate(roleMessageKey(role, '.description'))}
        </span>
      </div>
    </div>
  );
}

function RemoveDialog({
  member,
  keys,
  returnFocus,
  onClose,
  onRemoved,
}: {
  member: Member | null;
  keys: IdempotencyKeys;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onRemoved: (member: Member) => void;
}) {
  const translate = useTranslate();
  const client = useApiClient();
  const [failure, setFailure] = useState<ClientFailure | null>(null);
  const [working, setWorking] = useState(false);
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => {
        if (!next) {
          setFailure(null);
          onClose();
        }
      }}
    >
      <DialogContent finalFocus={() => returnFocus() ?? true}>
        {member === null ? null : (
          <>
            <DialogTitle>
              {translate('pl.tenants.members.removeDialog.title', { name: member.displayName })}
            </DialogTitle>
            <DialogDescription>{translate('pl.tenants.members.removeDialog.description')}</DialogDescription>
            <Refusal failure={failure} />
            <DialogFooter>
              <DialogClose>{translate('pl.tenants.members.removeDialog.cancel')}</DialogClose>
              <Button
                variant="danger"
                disabled={working}
                onClick={() => {
                  setWorking(true);
                  setFailure(null);
                  const change = `remove:${member.userId}`;
                  void client
                    .command(removeMemberCommand, { userId: member.userId }, keys.keyFor(change))
                    .then((result) => {
                      setWorking(false);
                      if (result.ok) {
                        keys.settle(change);
                        onRemoved(member);
                      } else {
                        setFailure(result.failure);
                      }
                    });
                }}
              >
                {translate(working ? 'pl.tenants.members.working' : 'pl.tenants.members.removeDialog.confirm')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
