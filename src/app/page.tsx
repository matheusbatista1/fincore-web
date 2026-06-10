import { redirect } from "next/navigation";

// The middleware routes "/" to /dashboard (authed) or /login. This is a fallback.
export default function RootPage() {
  redirect("/dashboard");
}
