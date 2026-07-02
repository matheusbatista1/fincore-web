import { redirect } from "next/navigation";

/** Cartões now live inside Carteiras as a tab — keep the old route as a deep-link redirect. */
export default function CardsPage() {
  redirect("/wallets?tab=cartoes");
}
