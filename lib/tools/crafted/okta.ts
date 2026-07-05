import type { ToolDef, MockContext, MockResult } from "../types";
import { rng, int, pick, chance, minutesAgoIso, daysAgoIso, nowIso, uuid } from "../helpers";
import { fleetUsers, extId, FLEET_ORG, type FleetUser } from "../../fleet/fleet";

// Okta identity cloud - Users API and Groups API (scaffold adapter). Auth is an
// API token sent as "Authorization: SSWS <token>" (accepted here as a plain
// bearer credential). List responses are BARE JSON ARRAYS like the real API.
// The user directory projects the canonical fleet (lib/fleet/fleet.ts), so the
// same people appear here and in Entra ID and correlate on email/UPN. Every
// record keeps the generic-normalizer keys (id / name / email / lastSeen) at
// the top level alongside Okta's own profile shape.

const OKTA_ORG_URL = `https://${FLEET_ORG.domain.split(".")[0]}.okta.com`;

/** Okta user id, e.g. "00u1ab2cd3ef4gh5ij6k". */
const oktaUserId = (fleetId: string): string => "00u" + extId("okta", fleetId, 17);
/** Okta group id, e.g. "00g9zy8xw7vu6ts5rq4p". */
const oktaGroupId = (name: string): string => "00g" + extId("okta", "group:" + name, 17);

/** Project one fleet user into Okta's user shape (+ generic top-level keys). */
function oktaUser(u: FleetUser) {
  const r = rng("okta:user:" + u.fleetId);
  const [first, ...rest] = u.displayName.split(" ");
  const last = rest.join(" ") || first;
  const status = u.enabled ? (chance(r, 0.08) ? "PROVISIONED" : "ACTIVE") : "SUSPENDED";
  const lastLogin = u.enabled ? minutesAgoIso(int(r, 5, 10080)) : minutesAgoIso(int(r, 20160, 80640));
  const id = oktaUserId(u.fleetId);
  return {
    // generic normalizer contract (top level): id / name / email / lastSeen
    id,
    name: u.displayName,
    email: u.upn,
    lastSeen: lastLogin,
    // Okta-flavored surface
    status,
    created: daysAgoIso(int(r, 120, 900)),
    activated: daysAgoIso(int(r, 119, 899)),
    statusChanged: daysAgoIso(int(r, 1, 119)),
    lastLogin,
    lastUpdated: minutesAgoIso(int(r, 60, 20160)),
    passwordChanged: daysAgoIso(int(r, 10, 180)),
    type: { id: "oty" + extId("okta", "default-user-type", 17) },
    profile: {
      firstName: first,
      lastName: last,
      displayName: u.displayName,
      email: u.upn,
      login: u.upn,
      secondEmail: null,
      mobilePhone: null,
      department: u.department,
      title: u.title,
      organization: FLEET_ORG.company,
      city: u.site,
      employeeNumber: u.fleetId,
    },
    credentials: { provider: { type: "OKTA", name: "OKTA" } },
    _links: { self: { href: `${OKTA_ORG_URL}/api/v1/users/${id}` } },
  };
}

type OktaUser = ReturnType<typeof oktaUser>;

/** Groups derived from the fleet's departments plus Okta's built-in Everyone. */
function oktaGroups() {
  const depts = [...new Set(fleetUsers().map((u) => u.department))].sort();
  const group = (name: string, description: string, type: string) => {
    const r = rng("okta:group:" + name);
    return {
      id: oktaGroupId(name),
      created: daysAgoIso(int(r, 200, 1200)),
      lastUpdated: daysAgoIso(int(r, 5, 200)),
      lastMembershipUpdated: minutesAgoIso(int(r, 30, 10080)),
      objectClass: ["okta:user_group"],
      type,
      profile: { name, description },
      _links: { self: { href: `${OKTA_ORG_URL}/api/v1/groups/${oktaGroupId(name)}` } },
    };
  };
  return [
    group("Everyone", "All users in your organization", "BUILT_IN"),
    ...depts.map((d) => group(d, `${d} team at ${FLEET_ORG.company}`, "OKTA_GROUP")),
  ];
}

/** Find a fleet user by Okta id or login (userPrincipalName). */
function findUser(idOrLogin: string): OktaUser | undefined {
  const u = fleetUsers().find((f) => oktaUserId(f.fleetId) === idOrLogin || f.upn.toLowerCase() === idOrLogin.toLowerCase());
  return u ? oktaUser(u) : undefined;
}

const notFound = (id: string): MockResult => ({
  status: 404,
  body: {
    errorCode: "E0000007",
    errorSummary: `Not found: Resource not found: ${id} (User)`,
    errorLink: "E0000007",
    errorId: "oae" + extId("okta", "err:" + id, 17),
    errorCauses: [],
  },
});

export const okta: ToolDef = {
  id: "okta",
  name: "Okta",
  vendor: "Okta",
  category: "identity",
  crafted: false,
  summary:
    "Okta identity cloud - directory users and groups plus lifecycle actions (suspend), served from the canonical fleet so identities correlate with Entra ID on email/UPN.",
  tags: ["identity", "okta", "sso", "lifecycle", "directory", "users"],
  auth: { type: "bearer" },
  docsUrl: "https://developer.okta.com/docs/reference/api/users/",
  defaultLatencyMs: 250,
  endpoints: [
    {
      method: "GET",
      path: "/api/v1/users",
      operation: "listUsers",
      summary: "List directory users (root array). Supports q prefix search, status filter and limit.",
      request: { limit: "10" },
      params: [
        { name: "q", in: "query", type: "string", description: "Prefix match on firstName, lastName or email.", example: "ava" },
        { name: "filter", in: "query", type: "string", description: "Filter expression; supports status.", format: 'status eq "ACTIVE|PROVISIONED|SUSPENDED"', example: 'status eq "ACTIVE"' },
        { name: "limit", in: "query", type: "integer", description: "Number of users to return (1-200).", default: 200, example: 10 },
        { name: "after", in: "query", type: "string", description: "Pagination cursor; return users after this cursor (server-generated)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        let users = fleetUsers().map(oktaUser);
        const q = (ctx.query.q || "").toLowerCase();
        if (q) users = users.filter((u) => u.profile.firstName.toLowerCase().startsWith(q) || u.profile.lastName.toLowerCase().startsWith(q) || u.email.toLowerCase().startsWith(q));
        const filter = /status eq "(\w+)"/.exec(ctx.query.filter || "");
        if (filter) users = users.filter((u) => u.status === filter[1]);
        const limit = Math.min(Math.max(1, Number(ctx.query.limit) || 200), 200);
        return { status: 200, body: users.slice(0, limit) };
      },
    },
    {
      method: "GET",
      path: "/api/v1/users/{userId}",
      operation: "getUser",
      summary: "Get a single user by id or login (email).",
      request: { userId: "00u1ab2cd3ef4gh5ij6k" },
      params: [
        { name: "userId", in: "path", type: "string", required: true, description: "Okta user id or the user's login (email).", format: "00u... id or login email", example: "a.sharma@meridiandynamics.example" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const user = findUser(ctx.params.userId);
        return user ? { status: 200, body: user } : notFound(ctx.params.userId);
      },
    },
    {
      method: "GET",
      path: "/api/v1/groups",
      operation: "listGroups",
      summary: "List groups (root array) - the built-in Everyone group plus one group per department.",
      request: { limit: "10" },
      params: [
        { name: "q", in: "query", type: "string", description: "Prefix match on the group name.", example: "eng" },
        { name: "limit", in: "query", type: "integer", description: "Number of groups to return (1-200).", default: 200, example: 10 },
        { name: "after", in: "query", type: "string", description: "Pagination cursor; return groups after this cursor (server-generated)." },
      ],
      respond: (ctx: MockContext): MockResult => {
        let groups = oktaGroups();
        const q = (ctx.query.q || "").toLowerCase();
        if (q) groups = groups.filter((g) => g.profile.name.toLowerCase().startsWith(q));
        const limit = Math.min(Math.max(1, Number(ctx.query.limit) || 200), 200);
        return { status: 200, body: groups.slice(0, limit) };
      },
    },
    {
      method: "POST",
      path: "/api/v1/users/{userId}/lifecycle/suspend",
      operation: "suspendUser",
      summary: "Suspend an ACTIVE user - the account keeps its data but cannot sign in.",
      emits: "user.suspended",
      request: { userId: "00u1ab2cd3ef4gh5ij6k" },
      params: [
        { name: "userId", in: "path", type: "string", required: true, description: "Okta user id or login (email) of the user to suspend.", format: "00u... id or login email", example: "00u1ab2cd3ef4gh5ij6k" },
      ],
      respond: (ctx: MockContext): MockResult => {
        const user = findUser(ctx.params.userId);
        if (!user) return notFound(ctx.params.userId);
        return { status: 200, body: {} };
      },
    },
  ],
  events: [
    {
      type: "user.suspended",
      summary: "A user account was suspended via a lifecycle action.",
      sample: () => {
        const u = pick(rng("okta:evt:" + uuid()), fleetUsers());
        return { ...oktaUser(u), status: "SUSPENDED", statusChanged: nowIso() };
      },
    },
  ],
};
