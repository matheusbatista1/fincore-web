import type { MetadataRoute } from "next";

/** PWA web app manifest — installable, dark, FinCore purple. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinCore — Finanças pessoais",
    short_name: "FinCore",
    description:
      "Gerencie suas finanças pessoais com clareza — contas, cartões, gastos compartilhados e mais.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0a12",
    theme_color: "#7c5cff",
    lang: "pt-BR",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
