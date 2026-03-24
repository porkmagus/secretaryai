import { redirect } from "next/navigation";
import { isSingleUserAuthEnabled } from "../../lib/auth";
import { LoginScreen } from "./login-screen";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isSingleUserAuthEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  return <LoginScreen nextPath={params.next ?? "/"} />;
}
