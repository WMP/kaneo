import { revokeUserConnections, revokeWorkspaceConnections } from "./ws";
import { apiKey } from "@better-auth/api-key";
import { getCurrentAuthContext } from "@better-auth/core/context";
import {
  isSmtpConfigured,
  OTP_EXPIRY_SECONDS,
  sendMagicLinkEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
} from "@kaneo/email";
import {
  ac,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  owner,
} from "@kaneo/permissions";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
} from "better-auth/api";
import {
  admin as adminPlugin,
  anonymous,
  bearer,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  lastLoginMethod,
  magicLink,
  openAPI,
  organization,
} from "better-auth/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import type { UserWithAnonymous } from "better-auth/plugins/anonymous";
import { config } from "dotenv-mono";
import { eq } from "drizzle-orm";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "./billing/controllers/find-billable-workspaces";
import db, { schema } from "./database";
import { authDatabaseAdapter } from "./database/auth-adapter";
import { publishEvent } from "./events";
import { sendInvitationEmail } from "./invitation/send-invitation-email";
import {
  afterAcceptProjectInvitation,
  beforeAcceptProjectInvitation,
} from "./project-invitation/accept";
import {
  INVITATION_EXPIRES_IN_SECONDS,
  PENDING_INVITATION_LIMIT,
} from "./project-invitation/constants";
import clearEmailVerificationOnAdminChange from "./user/controllers/clear-email-verification-on-admin-change";
import { handleMemberAdded } from "./workspace-members/handle-member-added";
import {
  handleMemberRemoved,
  memberGoneSteps,
} from "./workspace-members/handle-member-removed";
import deleteAccountData from "./user/controllers/delete-account-data";
import prepareAdminUserRemoval from "./user/controllers/prepare-admin-user-removal";
import { resolveAuthSecret } from "./utils/auth-secret";
import { authViaForNewSession } from "./utils/auth-source";
import {
  canSendSignInEmail,
  checkRegistrationAllowed,
  userExistsByEmail,
} from "./utils/check-registration-allowed";
import { checkWorkspaceName } from "./utils/check-workspace-name";
import { getClientUrl } from "./utils/client-url";
import { mapCustomOAuthProfileToUser } from "./utils/custom-oauth-profile";
import { resolveFileSecret } from "./utils/file-secret";
import { generateDemoName } from "./utils/generate-demo-name";
import { getEmailRequestContext } from "./utils/email-request-context";
import { getDefaultCookieAttributes } from "./utils/get-default-cookie-attributes";
import { getUserLocale } from "./utils/get-user-locale";
import { getGithubSsoOAuthCredentials } from "./utils/github-sso-env";
import {
  hasInstanceAdminRole,
  instanceAdminRoleSql,
} from "./utils/instance-admin-role";
import {
  hasRegisteredUsers,
  promoteInitialAdministrator,
} from "./utils/instance-bootstrap";
import { isCloud } from "./utils/is-cloud";
import { isDisposableEmail } from "./utils/is-disposable-email";
import { isLocalSignInPath } from "./utils/is-local-sign-in-path";
import { trackPasswordResetDelivery } from "./utils/password-reset-delivery";
import { removeUserProjectMemberships } from "./utils/project-access";
import { guardRoleChange } from "./utils/project-role-guard";
import {
  assertEmailCodeRecipientAllowed,
  assertGuestRegistrationAllowed,
  assertUserRegistrationAllowed,
  normalizeInvitationId,
} from "./utils/registration-policy";
import {
  assertCanAssignRole,
  assertCanResendInvitation,
} from "./utils/role-delegation";
import { runIndependently } from "./utils/run-independently";
import { queueSignInEmail } from "./utils/sign-in-email-tasks";
import { authCaptchaPaths, verifyTurnstile } from "./utils/verify-turnstile";
import { closeUserWorkspaceConnections } from "./ws";

config();

const githubSso = getGithubSsoOAuthCredentials();

const isRegistrationDisabled = process.env.DISABLE_REGISTRATION === "true";
const isPasswordRegistrationDisabled =
  process.env.DISABLE_PASSWORD_REGISTRATION === "true";
const isLoginFormDisabled = process.env.DISABLE_LOGIN_FORM === "true";
const isEmailOtpSignInDisabled =
  process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true";
const isWorkspaceCreationDisabled =
  process.env.DISABLE_WORKSPACE_CREATION === "true";

const apiUrl = process.env.KANEO_API_URL || "http://localhost:1337";
const clientUrl = getClientUrl();

const trustedOrigins = [clientUrl];
try {
  const apiOrigin = new URL(apiUrl);
  const apiOriginString = `${apiOrigin.protocol}//${apiOrigin.host}`;
  if (!trustedOrigins.includes(apiOriginString)) {
    trustedOrigins.push(apiOriginString);
  }
} catch {}

const baseURLWithoutPath = (() => {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/"); // Get protocol://host
  }
})();

const authSecret = (() => {
  try {
    return resolveAuthSecret();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();

function getLocaleKey(locale?: string | null) {
  const normalized = locale?.toLowerCase();
  if (normalized?.startsWith("de")) return "de";
  if (normalized?.startsWith("vi")) return "vi";
  if (normalized?.startsWith("ja")) return "ja";
  if (normalized === "zh-tw") return "zh-tw";
  return "en";
}

function isEmailCodeSignInAvailable() {
  return (
    isSmtpConfigured() && !isEmailOtpSignInDisabled && !isLoginFormDisabled
  );
}

// Reads env at call time (not module scope) so tests can stub it.
async function shouldDeliverSignInEmail(email: string) {
  if (process.env.DISABLE_PASSWORD_REGISTRATION === "true") {
    return userExistsByEmail(email);
  }
  if (process.env.DISABLE_REGISTRATION === "true") {
    // Mirror `assertUserRegistrationAllowed`: the first non-guest user can
    // always complete initial instance setup.
    if (!(await hasRegisteredUsers())) {
      return true;
    }
    return canSendSignInEmail(email);
  }
  return true;
}

function getAuthEmailCopy(locale?: string | null) {
  const localeKey = getLocaleKey(locale);

  if (localeKey === "de") {
    return {
      magicLinkSubject: "Anmeldelink für Kaneo",
      otpSubject: (otp: string) => `${otp} ist dein Kaneo-Anmeldecode`,
      passwordResetSubject: "Kaneo-Passwort zurücksetzen",
    };
  }

  if (localeKey === "vi") {
    return {
      magicLinkSubject: "Liên kết đăng nhập Kaneo",
      otpSubject: (otp: string) => `${otp} là mã đăng nhập Kaneo của bạn`,
      passwordResetSubject: "Đặt lại mật khẩu Kaneo",
    };
  }

  if (localeKey === "ja") {
    return {
      magicLinkSubject: "Kaneo ログインリンク",
      otpSubject: (otp: string) => `Kaneo のサインインコード: ${otp}`,
      passwordResetSubject: "Kaneo のパスワードをリセット",
    };
  }

  if (localeKey === "zh-tw") {
    return {
      magicLinkSubject: "Kaneo 登入連結",
      otpSubject: (otp: string) => `你的 Kaneo 登入驗證碼：${otp}`,
      passwordResetSubject: "重設 Kaneo 密碼",
    };
  }

  return {
    magicLinkSubject: "Login for Kaneo",
    otpSubject: (otp: string) => `${otp} is your Kaneo sign-in code`,
    passwordResetSubject: "Reset your Kaneo password",
  };
}

function getDeviceAuthClientIds(): Set<string> {
  const raw = process.env.DEVICE_AUTH_CLIENT_IDS?.trim();
  if (raw) {
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return new Set(["kaneo-cli", "kaneo-mcp"]);
}

function getDeviceAuthVerificationUri(): string {
  const base = clientUrl.replace(/\/$/, "");
  return `${base}/device`;
}

const deletedWorkspaceMembers = new WeakMap<object, string[]>();

export const auth = betterAuth({
  baseURL: baseURLWithoutPath,
  trustedOrigins,
  secret: authSecret,
  basePath: "/api/auth",
  database: authDatabaseAdapter({
    provider: "pg",
    schema: {
      ...schema,
      user: schema.userTable,
      account: schema.accountTable,
      session: schema.sessionTable,
      verification: schema.verificationTable,
      workspace: schema.workspaceTable,
      workspace_member: schema.workspaceUserTable,
      invitation: schema.invitationTable,
      workspace_role: schema.workspaceRoleTable,
      team: schema.teamTable,
      teamMember: schema.teamMemberTable,
      apikey: schema.apikeyTable,
      deviceCode: schema.deviceCodeTable,
    },
  }),
  user: {
    additionalFields: {
      locale: {
        type: "string",
        input: true,
        required: false,
      },
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteAccountData(user.id);
      },
    },
  },
  account: {
    accountLinking: {
      // Require the provider's verified-email claim for implicit linking;
      // configuration alone must not make an unverified identity trusted.
      enabled: true,
      allowDifferentEmails: true,
      // Only link to an existing local account after its email has been
      // verified. Without this check, an attacker could pre-register a victim's
      // email with a password account and retain access after the victim signs
      // in through a trusted OAuth/OIDC provider.
      requireLocalEmailVerified: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }, request) => {
      const requestContext = getEmailRequestContext(request?.headers);
      // Keep SMTP latency out of the response so it cannot reveal accounts.
      trackPasswordResetDelivery(
        getUserLocale(user.email).then((locale) =>
          sendPasswordResetEmail(
            user.email,
            getAuthEmailCopy(locale).passwordResetSubject,
            {
              resetLink: url,
              userName: user.name,
              locale,
              ...requestContext,
            },
          ),
        ),
      );
    },
    password: {
      hash: async (password) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }) => {
        return await bcrypt.compare(password, hash);
      },
    },
  },
  socialProviders: {
    github: {
      clientId: githubSso.clientId,
      clientSecret: githubSso.clientSecret,
      scope: ["user:email"],
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    },
  },
  plugins: [
    ...(process.env.DISABLE_GUEST_ACCESS !== "true"
      ? [
          anonymous({
            generateName: async () => generateDemoName(),
            emailDomainName: "kaneo.app",
          }),
        ]
      : []),
    lastLoginMethod(),
    magicLink({
      disableSignUp: isPasswordRegistrationDisabled,
      sendMagicLink: async ({ email, url }, ctx) => {
        const requestContext = getEmailRequestContext(
          ctx?.request?.headers ?? ctx?.headers,
        );
        queueSignInEmail(async () => {
          if (!(await shouldDeliverSignInEmail(email))) {
            return;
          }
          const locale = await getUserLocale(email);
          const copy = getAuthEmailCopy(locale);
          await sendMagicLinkEmail(email, copy.magicLinkSubject, {
            magicLink: url,
            locale,
            ...requestContext,
          });
        });
      },
    }),
    ...(isEmailOtpSignInDisabled
      ? []
      : [
          emailOTP({
            expiresIn: OTP_EXPIRY_SECONDS,
            disableSignUp: isPasswordRegistrationDisabled,
            async sendVerificationOTP({ email, otp, type }, ctx) {
              if (type === "sign-in") {
                const requestContext = getEmailRequestContext(
                  ctx?.request?.headers ?? ctx?.headers,
                );
                queueSignInEmail(async () => {
                  if (!(await shouldDeliverSignInEmail(email))) {
                    return;
                  }
                  const locale = await getUserLocale(email);
                  const copy = getAuthEmailCopy(locale);
                  await sendOtpEmail(email, copy.otpSubject(otp), {
                    otp,
                    locale,
                    ...requestContext,
                  });
                });
              }
            },
          }),
        ]),
    organization({
      // `ac` is created with a narrow `statement` shape (project/task/label/
      // workspace + the default org statements), which makes its inferred
      // `newRole` generic incompatible with better-auth's looser
      // `AccessControl` type. Widen via an explicit cast so the plugin
      // accepts our custom statement.
      ac: ac as unknown as AccessControl,
      // Only `owner` stays static so its permissions can never be edited away
      // from the workspace creator. `viewer`, `member`, and `admin` are
      // seeded into `workspace_role` per workspace and resolved via
      // dynamic access control, so admins can fully override (replace) their
      // permissions per workspace. See `seedDefaultWorkspaceRoles` + the
      // afterCreateOrganization hook.
      roles: { owner },
      dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 25,
      },
      teams: {
        enabled: true,
        maximumTeams: 10,
        allowRemovingAllTeams: false,
      },
      schema: {
        organization: {
          modelName: "workspace",
          additionalFields: {
            // in metadata
            description: {
              type: "string",
              input: true,
              required: false,
            },
          },
        },
        member: {
          modelName: "workspace_member",
          fields: {
            organizationId: "workspaceId",
            createdAt: "joinedAt",
          },
        },
        invitation: {
          modelName: "invitation",
          fields: {
            organizationId: "workspaceId",
          },
        },
        organizationRole: {
          modelName: "workspace_role",
          fields: {
            organizationId: "workspaceId",
          },
        },
        team: {
          modelName: "team",
          fields: {
            organizationId: "workspaceId",
          },
        },
      },
      // When `DISABLE_WORKSPACE_CREATION` is set, only instance admins
      // (role list includes "admin") may create workspaces — mirrors the
      // implicit-exemption shape of `DISABLE_REGISTRATION` above. This
      // check runs before any workspace membership exists, so only the
      // instance-wide role is meaningful here; per-workspace roles
      // (owner/admin/member/viewer) don't apply until after a workspace
      // is joined.
      //
      // Read the current instance role rather than a session's user snapshot,
      // which can predate first-user promotion or an administrator's changes.
      allowUserToCreateOrganization: isWorkspaceCreationDisabled
        ? async (user) => {
            const [freshUser] = await db
              .select({ role: schema.userTable.role })
              .from(schema.userTable)
              .where(eq(schema.userTable.id, user.id));
            return hasInstanceAdminRole(freshUser?.role);
          }
        : true,
      // Better Auth defaults this to `true`, which blocks any user whose email
      // is not verified from accepting/rejecting an invitation. Kaneo does not
      // verify emails on signup (and guest/anonymous users are unverified by
      // design), so leaving the default on breaks invitation acceptance for
      // everyone. The invitation link id is the actual secret here, so gate on
      // that rather than on email verification.
      requireEmailVerificationOnInvitation: false,
      // Shared with the project invitation routes, which create invitations
      // themselves.
      invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
      invitationLimit: PENDING_INVITATION_LIMIT,
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          const check = checkWorkspaceName(organization.name ?? "");
          if (!check.ok) {
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_WORKSPACE_NAME",
              message: check.reason,
            });
          }
        },
        afterCreateOrganization: async ({ organization, user }) => {
          // Seed the editable default roles for this workspace. Each
          // role's permissions are derived from the compiled-in defaults
          // in `@kaneo/permissions`; admins can later replace them in the
          // Roles UI. We skip names that somehow already exist (this hook
          // is best-effort idempotent; the boot-time backfill is the
          // belt-and-braces path).
          try {
            const existing = await db
              .select({ role: schema.workspaceRoleTable.role })
              .from(schema.workspaceRoleTable)
              .where(
                eq(schema.workspaceRoleTable.workspaceId, organization.id),
              );
            const taken = new Set(existing.map((r) => r.role));
            const now = new Date();
            const rows = DEFAULT_ROLE_NAMES.filter(
              (name) => !taken.has(name),
            ).map((name) => ({
              workspaceId: organization.id,
              role: name,
              permission: JSON.stringify(defaultRolePayloads[name]),
              createdAt: now,
              updatedAt: now,
            }));
            if (rows.length > 0) {
              await db.insert(schema.workspaceRoleTable).values(rows);
            }
          } catch (error) {
            console.error(
              "Failed to seed default workspace roles for workspace",
              organization.id,
              error,
            );
          }

          publishEvent("workspace.created", {
            workspaceId: organization.id,
            workspaceName: organization.name,
            ownerEmail: user.name,
            ownerId: user.id,
          });
        },
        // Invitations may not carry a role beyond the inviter's own
        // permissions. Re-sends skip this hook and are checked in
        // `hooks.before`.
        beforeCreateInvitation: async ({
          invitation,
          inviter,
          organization,
        }) => {
          await assertCanAssignRole({
            workspaceId: organization.id,
            actorUserId: inviter.id,
            targetRole: invitation.role,
          });
        },
        // Runs after Better Auth's own role validation and `member:update`
        // check. The hook is not told who is acting, and `hooks.before` sees
        // the original request context, in which Bearer and API-key sessions
        // are not resolved yet. The endpoint context is the one Better Auth's
        // own session middleware filled in, after those plugins ran.
        beforeUpdateMemberRole: async ({ member, newRole, organization }) => {
          const { context } = await getCurrentAuthContext();
          const actorUserId = context.session?.user.id;
          if (!actorUserId) {
            throw new APIError("UNAUTHORIZED");
          }
          await assertCanAssignRole({
            workspaceId: organization.id,
            actorUserId,
            targetRole: newRole,
            targetMember: { userId: member.userId, role: member.role },
          });
        },
        // A changed workspace role can end access (a demoted full-access user),
        // so their open project sockets are closed and reconnect with fresh access.
        afterUpdateMemberRole: async ({
          member,
          previousRole,
          organization,
        }) => {
          if (member.role !== previousRole) {
            await closeUserWorkspaceConnections(member.userId, organization.id);
          }
        },
        beforeDeleteOrganization: async ({ organization }, ctx) => {
          const billable = await findBillableWorkspaces([organization.id]);
          if (billable.length > 0) {
            throw new APIError("CONFLICT", {
              code: "WORKSPACE_HAS_ACTIVE_SUBSCRIPTION",
              message: formatBillableWorkspacesMessage(
                billable.map((workspace) => workspace.name),
              ),
            });
          }
          if (ctx) {
            const members = await db
              .select({ userId: schema.workspaceUserTable.userId })
              .from(schema.workspaceUserTable)
              .where(
                eq(schema.workspaceUserTable.workspaceId, organization.id),
              );
            const admins = await db
              .select({ userId: schema.userTable.id })
              .from(schema.userTable)
              .where(instanceAdminRoleSql(schema.userTable.role));
            deletedWorkspaceMembers.set(ctx.context, [
              ...new Set(
                [...members, ...admins].map((member) => member.userId),
              ),
            ]);
          }
        },
        afterDeleteOrganization: async ({ organization }, ctx) => {
          const userIds = ctx
            ? (deletedWorkspaceMembers.get(ctx.context) ?? [])
            : [];
          if (ctx) deletedWorkspaceMembers.delete(ctx.context);
          await Promise.all(
            userIds.map((userId) =>
              revokeWorkspaceConnections(userId, organization.id, {
                force: true,
              }),
            ),
          );
        },
        // Project invitations: purge the leftovers of an earlier membership
        // before a fresh join, then create the project memberships the
        // invitation grants. See `project-invitation/accept.ts` for the order
        // Better Auth runs things in and what a failure leaves behind.
        beforeAcceptInvitation: async ({ invitation, user }) => {
          await beforeAcceptProjectInvitation({ invitation, user });
        },
        afterAcceptInvitation: async ({ invitation, member, user }) => {
          await afterAcceptProjectInvitation({ invitation, member, user });
        },
        afterAddMember: async ({ member }) => {
          if (member?.organizationId) {
            await handleMemberAdded(member.organizationId);
          }
        },
        // Project memberships must not outlive workspace membership: they
        // would come back to life if the person joined again. Runs before the
        // removal, so a failure here aborts it instead of leaving stale rows.
        // It is not atomic with the removal: if Better Auth's own member
        // delete fails afterwards, the user stays in the workspace without
        // their project memberships, which only ever narrows access (an
        // administrator adds them again). The `/organization/leave` route runs
        // no organization hook and is handled in `hooks.after`.
        beforeRemoveMember: async ({ member, organization }) => {
          await removeUserProjectMemberships(member.userId, organization.id);
        },
        // Runs after Better Auth removed the member (a refused removal leaves
        // the resources linked): unlinks their resources (nothing moves back),
        // closes their sockets, tells their clients and syncs the seats. A
        // failing step is logged only (the removal is done).
        afterRemoveMember: async ({ member, user }) => {
          if (member?.organizationId) {
            await handleMemberRemoved({
              workspaceId: member.organizationId,
              userId: member.userId,
              userRole: user?.role,
            });
          }
        },
      },
      async sendInvitationEmail(data) {
        await sendInvitationEmail({
          invitationId: data.id,
          email: data.email,
          inviterName: data.inviter.user.name,
          inviterEmail: data.inviter.user.email,
          workspaceName: data.organization.name,
          role: data.role,
          expiresAt: data.invitation.expiresAt,
        });
      },
    }),
    genericOAuth({
      config: [
        {
          providerId: "custom",
          clientId: process.env.CUSTOM_OAUTH_CLIENT_ID || "",
          clientSecret: resolveFileSecret("CUSTOM_OAUTH_CLIENT_SECRET"),
          authorizationUrl: process.env.CUSTOM_OAUTH_AUTHORIZATION_URL || "",
          tokenUrl: process.env.CUSTOM_OAUTH_TOKEN_URL || "",
          userInfoUrl: process.env.CUSTOM_OAUTH_USER_INFO_URL || "",
          scopes: process.env.CUSTOM_OAUTH_SCOPES?.split(",")
            .map((s) => s.trim())
            .filter(Boolean) || ["profile", "email"],
          responseType: process.env.CUSTOM_OAUTH_RESPONSE_TYPE || "code",
          discoveryUrl: process.env.CUSTOM_OAUTH_DISCOVERY_URL || "",
          pkce: process.env.CUSTOM_AUTH_PKCE !== "false",
          mapProfileToUser: mapCustomOAuthProfileToUser,
        },
      ],
    }),
    bearer(),
    apiKey({
      enableSessionForAPIKeys: true,
      apiKeyHeaders: "x-api-key",
      rateLimit: {
        enabled: true,
        maxRequests: 100,
        timeWindow: 60 * 1000,
      },
    }),
    deviceAuthorization({
      verificationUri: getDeviceAuthVerificationUri(),
      validateClient: async (clientId) =>
        getDeviceAuthClientIds().has(clientId),
    }),
    adminPlugin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    openAPI(),
  ],
  session: {
    additionalFields: {
      // Set server-side only (`input: false`): "mcp" marks a session issued
      // for an MCP client. `getSession` returns it so the activity log can
      // tell MCP traffic from the web UI (see utils/auth-source.ts).
      authVia: {
        type: "string",
        input: false,
        required: false,
      },
    },
    cookieCache: {
      // Consult the session store on every request so password recovery
      // immediately rejects revoked cookies, including caches issued before upgrade.
      enabled: false,
    },
  },
  rateLimit: {
    // Enable in cloud; self-hosted instances opt in by setting KANEO_CLOUD.
    // Default better-auth rate-limit only kicks in for production; we keep the
    // global limits conservative and tighten signup/invite via customRules.
    enabled: isCloud(),
    window: 10,
    max: 100,
    customRules: {
      "/sign-up/email": { window: 60, max: 3 },
      "/sign-in/anonymous": { window: 60, max: 3 },
      "/organization/invite-member": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (_session, ctx) => {
          const authVia = authViaForNewSession(ctx);
          return authVia ? { data: { authVia } } : undefined;
        },
      },
    },
    user: {
      delete: {
        after: async (user, ctx) => {
          // Anonymous linking deletes the old identity after issuing a new
          // session. The replacement account must retain its authentication.
          if (
            (user as Partial<UserWithAnonymous>).isAnonymous &&
            ctx?.context.newSession &&
            ctx.context.newSession.user.id !== user.id
          )
            return;
          await revokeUserConnections(user.id);
        },
      },
      update: {
        before: async (user, ctx) => {
          if (
            (ctx?.path === "/admin/set-role" ||
              ctx?.path === "/admin/update-user") &&
            Object.hasOwn(user, "role") &&
            ctx.body?.userId === ctx.context.session?.user.id
          ) {
            throw new APIError("BAD_REQUEST", {
              code: "YOU_CANNOT_CHANGE_YOUR_OWN_ROLE",
              message: "You cannot change your own role.",
            });
          }
          return clearEmailVerificationOnAdminChange(user, ctx);
        },
      },
      create: {
        before: async (user, ctx) => {
          await assertUserRegistrationAllowed(
            user as Partial<UserWithAnonymous> & { email: string },
            {
              path: ctx?.path,
              invitationId:
                ctx?.body?.invitationId ||
                ctx?.query?.invitationId ||
                ctx?.headers?.get("x-invitation-id"),
            },
          );
        },
        after: async (user) => {
          // The anonymous() plugin creates ephemeral users for guest
          // access; never promote one to instance admin even if no
          // real admin exists yet. `isAnonymous` is contributed by the
          // anonymous plugin's `additionalFields` and isn't part of the
          // base User type, so we narrow through `UserWithAnonymous`.
          const userWithAnonymous = user as Partial<UserWithAnonymous>;
          if (userWithAnonymous.isAnonymous) {
            return;
          }

          await promoteInitialAdministrator(user.id);
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/admin/remove-user") {
        await prepareAdminUserRemoval(ctx);
      }

      if (ctx.path === "/organization/invite-member") {
        // Better Auth swallows email failures in runInBackgroundOrAwait.
        // Invitation callers need the delivery result, including on resend.
        ctx.context.runInBackgroundOrAwait = async (promise) => {
          try {
            await promise;
          } catch {
            throw new APIError("BAD_GATEWAY", {
              code: "INVITATION_EMAIL_FAILED",
              message:
                "Invitation saved, but email delivery failed. Check SMTP settings and resend the invitation.",
            });
          }
        };
      }

      if (isLoginFormDisabled && isLocalSignInPath(ctx.path)) {
        throw new APIError("FORBIDDEN", {
          code: "LOCAL_SIGN_IN_DISABLED",
          message:
            "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
        });
      }

      if (ctx.path === "/request-password-reset" && !isSmtpConfigured()) {
        throw new APIError("FORBIDDEN", {
          code: "EMAIL_DELIVERY_NOT_CONFIGURED",
          message: "Password reset requires email delivery to be configured.",
        });
      }

      if (ctx.path === "/sign-in/anonymous") {
        await assertGuestRegistrationAllowed();
      }

      if (authCaptchaPaths.has(ctx.path)) {
        const verdict = await verifyTurnstile(
          ctx.headers?.get("x-turnstile-token") ?? ctx.body?.turnstileToken,
        );
        if (!verdict.ok)
          throw new APIError("FORBIDDEN", {
            code: "CAPTCHA_FAILED",
            message: verdict.reason,
          });
      }

      if (
        (ctx.path === "/email-otp/send-verification-otp" &&
          ctx.body?.type === "sign-in") ||
        ctx.path === "/sign-in/magic-link"
      ) {
        await assertEmailCodeRecipientAllowed(ctx.body?.email);
      }

      // Block invite-member calls on cloud from anonymous users or to
      // disposable-email addresses. The 2026-05-28 incident saw ~14k phishing
      // invites sent from throwaway disposable-email signups; gating here
      // shuts that path off without affecting self-hosted instances.
      if (ctx.path === "/organization/invite-member" && isCloud()) {
        // `before` hooks don't auto-populate ctx.context.session; load it
        // explicitly. `disableRefresh` keeps this gate cheap: we only need
        // the user record, not a session refresh side-effect.
        const session = await getSessionFromCtx(ctx, {
          disableRefresh: true,
        }).catch(() => null);
        const sessionUser = session?.user as
          | { isAnonymous?: boolean | null }
          | undefined;
        if (sessionUser?.isAnonymous) {
          throw new APIError("FORBIDDEN", {
            code: "GUEST_INVITATIONS_NOT_ALLOWED",
            message: "Guest accounts may not send workspace invitations.",
          });
        }
        const inviteeEmail = (ctx.body?.email as string | undefined) ?? "";
        if (inviteeEmail && isDisposableEmail(inviteeEmail)) {
          throw new APIError("BAD_REQUEST", {
            code: "DISPOSABLE_EMAIL_NOT_ALLOWED",
            message:
              "Invitations to disposable-email addresses are not allowed.",
          });
        }
      }

      // Known limitation: `auth.api.getSession` below re-runs the API-key
      // plugin's usage claim, so a request authenticated with `x-api-key`
      // counts twice against the key's rate limit and `remaining` (same as
      // the invitation re-send check).
      // A project role is a workspace role name. Refuse to delete or rename a
      // role that project members (or pending project invitations) still use,
      // but only for a caller Better Auth would let do it (see
      // `project-role-guard.ts`): this hook runs before Better Auth
      // authorizes the request. Fail closed: a failing session lookup rejects
      // the request; without a session Better Auth answers 401 itself.
      if (
        ctx.path === "/organization/delete-role" ||
        (ctx.path === "/organization/update-role" &&
          typeof ctx.body?.data?.roleName === "string" &&
          ctx.body.data.roleName !== "")
      ) {
        const session = await auth.api.getSession({
          headers: ctx.headers ?? new Headers(),
          query: { disableRefresh: true },
        });
        await guardRoleChange({
          action:
            ctx.path === "/organization/delete-role" ? "delete" : "rename",
          body: ctx.body,
          actor: session
            ? {
                userId: session.user.id,
                activeOrganizationId: (
                  session.session as { activeOrganizationId?: string | null }
                ).activeOrganizationId,
              }
            : null,
        });
      }

      // Role delegation for an invitation re-send, which returns before any
      // organization hook runs (new invitations: `beforeCreateInvitation`,
      // role changes: `beforeUpdateMemberRole`).
      //
      // Better Auth runs this hook before its plugin hooks and hands every
      // hook the ORIGINAL context, so `getSessionFromCtx` cannot see sessions
      // the bearer and API-key plugins resolve from `Authorization` /
      // `x-api-key`. `auth.api.getSession` dispatches through all plugins, like
      // `authenticateApiRequest` does.
      //
      // Known limitation: that lookup re-runs the api-key plugin's
      // `validateApiKey`, which claims usage (rate-limit counter and
      // `remaining`), so a re-send authenticated with `x-api-key` counts twice
      // against the key.
      if (
        ctx.path === "/organization/invite-member" &&
        ctx.body?.resend === true
      ) {
        // Fail closed: a failing lookup propagates and rejects the request.
        // Only a lookup that succeeds without a session returns early, and
        // Better Auth then answers 401 itself.
        const session = await auth.api.getSession({
          headers: ctx.headers ?? new Headers(),
          query: { disableRefresh: true },
        });
        if (!session) {
          return;
        }
        // `||`, as in Better Auth: an empty `organizationId` falls back to the
        // active organization.
        const workspaceId: unknown =
          ctx.body?.organizationId ||
          (session.session as { activeOrganizationId?: string | null })
            .activeOrganizationId;
        const inviteeEmail: unknown = ctx.body?.email;
        if (
          typeof workspaceId !== "string" ||
          !workspaceId ||
          typeof inviteeEmail !== "string"
        ) {
          return;
        }
        await assertCanResendInvitation({
          workspaceId,
          actorUserId: session.user.id,
          email: inviteeEmail,
        });
        return;
      }

      const isSignUpPath =
        ctx.path === "/sign-up/email" ||
        ctx.path.startsWith("/callback/") ||
        ctx.path.startsWith("/sign-in/social");

      if (!isSignUpPath) {
        return;
      }

      const isInstanceAdminSetup = !(await hasRegisteredUsers());

      if (ctx.path === "/sign-up/email") {
        if (isPasswordRegistrationDisabled && !isInstanceAdminSetup) {
          throw new APIError("FORBIDDEN", {
            code: "PASSWORD_REGISTRATION_DISABLED",
            message:
              "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
          });
        }

        if (
          isCloud() &&
          !isInstanceAdminSetup &&
          isEmailCodeSignInAvailable()
        ) {
          throw new APIError("FORBIDDEN", {
            code: "EMAIL_CODE_REGISTRATION_REQUIRED",
            message: "Create your account with an email code.",
          });
        }
      }

      if (!isRegistrationDisabled || isInstanceAdminSetup) {
        return;
      }

      const email =
        ctx.body?.email ||
        ctx.query?.email ||
        ctx.headers?.get("x-invitation-email");
      const invitationId = normalizeInvitationId(
        ctx.body?.invitationId ||
          ctx.query?.invitationId ||
          ctx.headers?.get("x-invitation-id"),
      );

      if (ctx.path === "/sign-up/email") {
        const result = await checkRegistrationAllowed(email, invitationId);
        if (!result.allowed) {
          throw new APIError("FORBIDDEN", {
            code: "REGISTRATION_NOT_ALLOWED",
            message: result.reason,
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      // Leaving a workspace runs no organization hook, so drop the leaver's
      // project memberships in that workspace here. `returned` is the member
      // Better Auth removed, or an error when the request did not succeed.
      if (ctx.path === "/organization/leave") {
        const returned = ctx.context.returned as unknown;
        if (returned && !isAPIError(returned) && typeof returned === "object") {
          const { userId, organizationId } = returned as {
            userId?: unknown;
            organizationId?: unknown;
          };
          if (
            typeof userId === "string" &&
            typeof organizationId === "string"
          ) {
            // The leaver is out of the workspace already. Each cleanup step
            // runs whatever the others did (the sockets close even if a
            // cleanup fails); every failure is logged and the first is thrown.
            await runIndependently([
              [
                "Removing the project memberships",
                () => removeUserProjectMemberships(userId, organizationId),
              ],
              ...memberGoneSteps(
                organizationId,
                userId,
                ctx.context.session?.user.role,
              ),
            ]);
          }
        }
      }

      if (ctx.path.startsWith("/sign-up") || ctx.path.startsWith("/sign-in")) {
        const newSession = ctx.context.newSession;
        if (newSession) {
          const workspaceMember = await db
            .select({ workspaceId: schema.workspaceUserTable.workspaceId })
            .from(schema.workspaceUserTable)
            .where(eq(schema.workspaceUserTable.userId, newSession.user.id))
            .limit(1);

          const activeWorkspaceId = workspaceMember[0]?.workspaceId || null;

          if (activeWorkspaceId) {
            await db
              .update(schema.sessionTable)
              .set({ activeOrganizationId: activeWorkspaceId })
              .where(eq(schema.sessionTable.id, newSession.session.id));
          }
        }
      }
    }),
  },
  advanced: {
    ipAddress: {
      // Set only by the Node transport middleware, never accepted from clients.
      ipAddressHeaders: ["x-kaneo-client-ip"],
      trustedProxies: [],
    },
    defaultCookieAttributes: getDefaultCookieAttributes({
      apiUrl,
      clientUrl,
      cookieDomain: process.env.COOKIE_DOMAIN,
    }),
  },
});
