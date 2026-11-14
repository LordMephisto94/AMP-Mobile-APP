import { nav } from "../state/nav";
import { recoverSession } from "../state/servers";

/**
 * A screen's request came back 401. AMP is offered a renewal first (the token may only
 * have run out); only when it refuses does the user go back to sign in. Several screens
 * hitting this at once share one renewal. Afterwards the screen's next load, or the
 * user's retry, uses whatever session there is.
 */
export async function sessionRejected(serverId: string): Promise<void> {
  const outcome = await recoverSession(serverId);
  if (outcome === "signedOut") nav.setRoutes([{ name: "servers" }, { name: "signIn", serverId }]);
}
