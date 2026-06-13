import type { CSSProperties } from "react";

export interface LegalSection {
  readonly heading: string;
  readonly body: readonly string[];
}

const H1: CSSProperties = { fontFamily: "var(--font-display)", fontSize: 28, color: "var(--text-hi)" };
const META: CSSProperties = { fontSize: 13, color: "var(--text-lo)", marginTop: 6, marginBottom: 18 };
const INTRO: CSSProperties = { fontSize: 15, color: "var(--text-mid)", lineHeight: 1.6 };
const H2: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 17,
  color: "var(--text-hi)",
  marginBottom: 6,
};
const P: CSSProperties = { fontSize: 14.5, color: "var(--text-mid)", lineHeight: 1.65, marginTop: 8 };

/**
 * Renders a legal document from structured sections. NOTE: the copy here is a
 * reasonable starting template — it is NOT legal advice; have it reviewed by a
 * lawyer before relying on it.
 */
export function LegalDoc({
  title,
  updatedAt,
  intro,
  sections,
}: {
  title: string;
  updatedAt: string;
  intro: string;
  sections: readonly LegalSection[];
}) {
  return (
    <article>
      <h1 style={H1}>{title}</h1>
      <div style={META}>Última atualização: {updatedAt}</div>
      <p style={INTRO}>{intro}</p>
      {sections.map((section, i) => (
        <section key={section.heading} style={{ marginTop: 24 }}>
          <h2 style={H2}>
            {i + 1}. {section.heading}
          </h2>
          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} style={P}>
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
