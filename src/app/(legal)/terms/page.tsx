import type { Metadata } from "next";
import { LegalDoc, type LegalSection } from "@/presentation/components/legal/legal-doc";

export const metadata: Metadata = {
  title: "Termos de Uso · FinCore",
  description: "As regras para usar o FinCore.",
};

// NOTE: template copy — not legal advice. Have it reviewed by a lawyer.
const SECTIONS: readonly LegalSection[] = [
  {
    heading: "Aceitação dos termos",
    body: [
      "Ao criar uma conta e usar o FinCore, você concorda com estes Termos de Uso e com a Política de Privacidade. Se não concordar, não utilize o serviço.",
    ],
  },
  {
    heading: "O que é o FinCore",
    body: [
      "O FinCore é um aplicativo de gestão de finanças pessoais que ajuda você a organizar contas, cartões, lançamentos, despesas compartilhadas, orçamentos e metas. As funcionalidades podem evoluir com o tempo.",
    ],
  },
  {
    heading: "Não é aconselhamento financeiro",
    body: [
      "O FinCore é uma ferramenta de organização e visualização. As informações e cálculos exibidos têm caráter informativo e não constituem aconselhamento financeiro, contábil, tributário ou de investimento.",
      "As decisões tomadas com base nas informações do aplicativo são de sua exclusiva responsabilidade.",
    ],
  },
  {
    heading: "Sua conta",
    body: [
      "Você é responsável por manter a confidencialidade das suas credenciais e por toda atividade realizada na sua conta. Recomendamos ativar a autenticação em duas etapas.",
      "Você se compromete a fornecer informações verídicas e a manter seus dados de acesso atualizados.",
    ],
  },
  {
    heading: "Uso aceitável",
    body: [
      "Você concorda em não usar o serviço para fins ilícitos, em não tentar burlar mecanismos de segurança e em não sobrecarregar ou interferir na infraestrutura do aplicativo.",
    ],
  },
  {
    heading: "Disponibilidade e isenção de garantias",
    body: [
      "O serviço é fornecido 'como está' e 'conforme disponível'. Não garantimos que estará livre de erros ou interrupções, nem que atenderá a todos os seus objetivos específicos.",
      "Recomendamos que você mantenha registros próprios de informações financeiras importantes.",
    ],
  },
  {
    heading: "Limitação de responsabilidade",
    body: [
      "Na máxima extensão permitida pela lei, o FinCore não será responsável por danos indiretos, incidentais ou consequentes decorrentes do uso ou da impossibilidade de uso do serviço.",
    ],
  },
  {
    heading: "Alterações nos termos",
    body: [
      "Estes termos podem ser atualizados periodicamente. Mudanças relevantes serão indicadas pela data de 'última atualização'. O uso continuado após alterações representa concordância com a nova versão.",
    ],
  },
  {
    heading: "Lei aplicável",
    body: [
      "Estes termos são regidos pelas leis da República Federativa do Brasil, sendo eleito o foro do domicílio do usuário para dirimir eventuais controvérsias.",
    ],
  },
  {
    heading: "Contato",
    body: ["Dúvidas sobre estes termos podem ser enviadas para matheus.batista@zig.fun."],
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      title="Termos de Uso"
      updatedAt="13 de junho de 2026"
      intro="Estes termos definem as regras para usar o FinCore. Leia com atenção antes de continuar usando o aplicativo."
      sections={SECTIONS}
    />
  );
}
