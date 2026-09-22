import { redirect } from "next/navigation";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { consoleAccess } from "@/lib/console-auth";

/**
 * `/students` — the address an operator types, and the one a link into
 * `/students/1` implies a parent for. **The list is the landing**, so this is a
 * redirect to `/` rather than a second copy of view 1.
 *
 * A redirect and not a duplicate page because two routes rendering one read
 * model is two places for the projection rule to drift, and the `cost-billing`
 * projection is the whole reason that rule exists.
 *
 * It still goes through the seam first. An anonymous visitor must not learn
 * which addresses exist by being bounced off them, and `proxy.ts` already sends
 * them to `/signin` before this renders; a signed-in operator with no relevant
 * role gets the ordinary refusal. Permitted to **all four roles** because `/`
 * is: what an operator may see when they arrive there is decided there.
 */
export const dynamic = "force-dynamic";

const PATH = "/students";

export default async function ConsoleStudentsIndexPage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) return <ConsoleRefusal status={access.status} />;
  redirect("/");
}
