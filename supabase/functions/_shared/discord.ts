/**
 * Read-only Discord checks with the member's own OAuth token (no bot).
 *
 * At sign-in the member grants `identify` and `guilds.members.read`. Right after
 * the OAuth callback the browser sends that short-lived provider token once to
 * discord-verify, which calls the two documented user endpoints below
 * (official REST API v10). The token is used for this request only: it is never
 * stored or logged by the server.
 *
 * Roles never grant website access. The roster decides identity and rank;
 * roles are only compared against it and mismatches are reported for review.
 * Role writes are disabled: planRoleSync() produces a dry-run plan only.
 */

import { fetchWithRetry, UpstreamError, type RetryOptions } from "./http.ts";

const API = "https://discord.com/api/v10";
export const ROLE_WRITES_ENABLED = false as const;
export const SNOWFLAKE = /^\d{17,20}$/;
export const USER_SCOPES = "identify guilds.members.read" as const;

const headers = (token: string) => ({ authorization: `Bearer ${token}`, "user-agent": "TPD-HQ (https://github.com/hathawaytets-cyber/tpd-dashboard, 1.0)" });

/** GET /users/@me with the member's token: proves whose token it is. */
export async function tokenOwner(token: string, opts: RetryOptions = {}): Promise<{ id: string; username: string }> {
  const res = await fetchWithRetry(`${API}/users/@me`, { headers: headers(token) }, opts);
  if (res.status === 401) throw new UpstreamError("Discord rejected the sign-in token. Sign in again.", 401, false);
  if (!res.ok) throw new UpstreamError(`Discord answered ${res.status}`, res.status, false);
  const b = await res.json();
  if (!SNOWFLAKE.test(String(b.id))) throw new UpstreamError("Discord returned an invalid user ID", res.status, false);
  return { id: String(b.id), username: String(b.username) };
}

/**
 * GET /users/@me/guilds/{guild}/member (scope guilds.members.read).
 * Returns the member's role IDs, or null when Discord says they are not in the server (404).
 * A missing scope (403), a bad token (401) or an outage throws: none of those is "not in the server".
 */
export async function ownGuildMember(guildId: string, token: string, opts: RetryOptions = {}): Promise<{ roles: string[]; nick: string | null } | null> {
  if (!SNOWFLAKE.test(guildId)) throw new UpstreamError("DISCORD_GUILD_ID is not a valid ID", null, false);
  const res = await fetchWithRetry(`${API}/users/@me/guilds/${guildId}/member`, { headers: headers(token) }, opts);
  if (res.status === 404) return null;
  if (res.status === 401) throw new UpstreamError("Discord rejected the sign-in token. Sign in again.", 401, false);
  if (res.status === 403) throw new UpstreamError("Discord did not grant server-membership access (guilds.members.read). Sign in again and allow it.", 403, false);
  if (!res.ok) throw new UpstreamError(`Discord answered ${res.status} for the membership check`, res.status, res.status === 429 || res.status >= 500);
  const b = await res.json();
  return { roles: Array.isArray(b.roles) ? b.roles.map(String) : [], nick: typeof b.nick === "string" ? b.nick : null };
}

export interface RoleMapping {
  role_id: string;
  role_name: string;
  maps_to_kind: "member" | "rank" | "division" | "ignore";
  maps_to_value: string | null;
  confirmed_at: string | null;
}

export interface RosterFacts {
  rank: string;
  divisions: string[];
}

export interface Finding {
  code: "not_in_guild" | "missing_member_role" | "missing_rank_role" | "extra_rank_role" | "missing_division_role" | "extra_division_role";
  detail: string;
}

/**
 * Compares a member's Discord roles with their roster record. Only confirmed
 * mappings are used. The result is informational: it never changes access.
 */
export function evaluateRoles(facts: RosterFacts, roleIds: string[] | null, map: RoleMapping[]): Finding[] {
  if (roleIds === null) return [{ code: "not_in_guild", detail: "Not a member of the TPD Discord server." }];
  const confirmed = map.filter((m) => m.confirmed_at && m.maps_to_kind !== "ignore");
  const has = new Set(roleIds);
  const out: Finding[] = [];
  const memberRoles = confirmed.filter((m) => m.maps_to_kind === "member");
  if (memberRoles.length && !memberRoles.some((m) => has.has(m.role_id))) out.push({ code: "missing_member_role", detail: `Missing the ${memberRoles[0].role_name} role.` });
  for (const m of confirmed.filter((x) => x.maps_to_kind === "rank")) {
    if (m.maps_to_value === facts.rank && !has.has(m.role_id)) out.push({ code: "missing_rank_role", detail: `Roster rank ${facts.rank}, but no ${m.role_name} role.` });
    if (m.maps_to_value !== facts.rank && has.has(m.role_id)) out.push({ code: "extra_rank_role", detail: `Has ${m.role_name}, but the roster rank is ${facts.rank}.` });
  }
  for (const m of confirmed.filter((x) => x.maps_to_kind === "division")) {
    const inDivision = !!m.maps_to_value && facts.divisions.includes(m.maps_to_value);
    if (inDivision && !has.has(m.role_id)) out.push({ code: "missing_division_role", detail: `Roster lists ${m.maps_to_value}, but no ${m.role_name} role.` });
    if (!inDivision && has.has(m.role_id)) out.push({ code: "extra_division_role", detail: `Has ${m.role_name}, but the roster does not list ${m.maps_to_value}.` });
  }
  return out;
}

/**
 * Dry run of what a role sync WOULD do. Only additions are ever planned
 * automatically; removals are listed for manual review, because a failed or
 * stale roster read must never strip someone's roles.
 */
export function planRoleSync(findings: Finding[], map: RoleMapping[], facts: RosterFacts): { add: string[]; reviewRemovals: string[]; writesEnabled: boolean } {
  const confirmed = map.filter((m) => m.confirmed_at);
  const add: string[] = [];
  const reviewRemovals: string[] = [];
  for (const f of findings) {
    if (f.code === "missing_rank_role") add.push(...confirmed.filter((m) => m.maps_to_kind === "rank" && m.maps_to_value === facts.rank).map((m) => m.role_id));
    if (f.code === "missing_division_role") add.push(...confirmed.filter((m) => m.maps_to_kind === "division" && m.maps_to_value && facts.divisions.includes(m.maps_to_value)).map((m) => m.role_id));
    if (f.code === "extra_rank_role" || f.code === "extra_division_role") reviewRemovals.push(f.detail);
  }
  return { add: [...new Set(add)], reviewRemovals, writesEnabled: ROLE_WRITES_ENABLED };
}
