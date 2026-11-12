import { redirect } from "next/navigation";
import { requireDemo } from "@/infrastructure/demo/demo-flag";

/** The demo opens on its dashboard. */
export default function DemoIndex() {
  requireDemo();
  redirect("/demo/dashboard");
}
