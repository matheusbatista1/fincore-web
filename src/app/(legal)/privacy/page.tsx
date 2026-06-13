import type { Metadata } from "next";
import { LegalDoc, type LegalSection } from "@/presentation/components/legal/legal-doc";

export const metadata: Metadata = {
  title: "Política de Privacidade · FinCore",
  description: "Como o FinCore coleta, usa e protege seus dados.",
};

// NOTE: template copy — not legal advice. Have it reviewed by a lawyer.
const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Dados que coletamos",
    body: [
      "Dados de conta: seu e-mail e uma senha (armazenada de forma cifrada pelo provedor de autenticação).",
      "Dados de perfil: nome de exibição e, opcionalmente, uma foto de perfil que você escolher enviar.",
      "Dados financeiros que você insere: contas, cartões, lançamentos, categorias, pessoas, orçamentos e metas. Esses dados são fornecidos por você e usados apenas para operar o aplicativo.",
      "Dados técnicos mínimos necessários para autenticação e segurança da sessão (por exemplo, cookies de sessão).",
    ],
  },
  {
    heading: "Como usamos seus dados",
    body: [
      "Usamos seus dados exclusivamente para fornecer o serviço: autenticar seu acesso, exibir e calcular seus saldos, faturas e relatórios, e guardar suas preferências.",
      "Não usamos seus dados financeiros para publicidade e não os vendemos a terceiros.",
    ],
  },
  {
    heading: "Onde seus dados ficam armazenados",
    body: [
      "Os dados são armazenados no Supabase (banco de dados PostgreSQL) e a foto de perfil no serviço de armazenamento do Supabase. A aplicação é hospedada na Vercel.",
      "Cada conta é isolada por políticas de segurança em nível de linha (Row Level Security) no banco de dados: você só acessa os seus próprios dados.",
    ],
  },
  {
    heading: "Compartilhamento",
    body: [
      "Não compartilhamos nem vendemos seus dados pessoais. Utilizamos provedores de infraestrutura (Supabase e Vercel) estritamente para hospedar e operar o serviço, na qualidade de operadores de dados.",
    ],
  },
  {
    heading: "Seus direitos (LGPD)",
    body: [
      "Você pode acessar, corrigir e excluir seus dados a qualquer momento dentro do próprio aplicativo.",
      "Você pode solicitar a exclusão da sua conta e de todos os dados associados pelo canal de contato abaixo. Ao excluir a conta, os dados vinculados são removidos.",
    ],
  },
  {
    heading: "Segurança",
    body: [
      "O tráfego é protegido por criptografia em trânsito (HTTPS). Você pode ativar a autenticação em duas etapas (2FA) nas configurações para uma camada extra de proteção.",
      "Apesar dos cuidados, nenhum sistema é 100% seguro. Use uma senha forte e mantenha seu dispositivo protegido.",
    ],
  },
  {
    heading: "Cookies",
    body: [
      "Utilizamos apenas cookies essenciais para manter sua sessão autenticada. Não usamos cookies de rastreamento publicitário.",
    ],
  },
  {
    heading: "Contato",
    body: [
      "Dúvidas sobre privacidade ou solicitações relativas aos seus dados podem ser enviadas para matheus.batista@zig.fun.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Política de Privacidade"
      updatedAt="13 de junho de 2026"
      intro="Esta política explica quais dados o FinCore coleta, como eles são usados e protegidos, e quais são os seus direitos. O FinCore é um aplicativo de finanças pessoais e leva a sério a privacidade dos seus dados financeiros."
      sections={SECTIONS}
    />
  );
}
