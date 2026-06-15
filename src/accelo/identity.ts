import type { AcceloClient } from "./client.js";

export interface CurrentUser { staffId: string; timezone: string | null; }

const ME_QUERY = `query Me { acceloConfig { userConfig { currentUser { __typename ... on Staff { id timezone } } } } }`;

export async function getCurrentUser(client: AcceloClient): Promise<CurrentUser> {
  const data = await client.query<{ acceloConfig: { userConfig: { currentUser: { __typename: string; id?: string; timezone?: string | null } } } }>(ME_QUERY);
  const u = data.acceloConfig.userConfig.currentUser;
  if (u.__typename !== "Staff" || !u.id) throw new Error("Current user is not a staff member; cannot resolve staff id.");
  return { staffId: u.id, timezone: u.timezone ?? null };
}
