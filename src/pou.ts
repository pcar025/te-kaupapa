export const TE_WAHAROA_POU = [
  {
    id: 'whakapapa',
    reo: 'Whakapapa',
    en: 'Identity Safety',
    full: 'Whakapapa & Identity Safety',
    domain: 'Identity, whakapapa, whānau voice, cultural protective factors',
  },
  {
    id: 'manaakitanga',
    reo: 'Manaakitanga',
    en: 'Duty of Care',
    full: 'Manaakitanga & Duty of Care',
    domain: 'Respectful communication, responsiveness to distress, escalation',
  },
  {
    id: 'tikanga',
    reo: 'Tikanga',
    en: 'Ethical Practice',
    full: 'Tikanga & Ethical Practice',
    domain: 'Consent, confidentiality, ethical decision-making, tikanga',
  },
  {
    id: 'kaitiakitanga',
    reo: 'Kaitiakitanga',
    en: 'Risk Management',
    full: 'Kaitiakitanga & Risk Management',
    domain: 'Risk assessment, safety planning, escalations, cultural safety',
  },
  {
    id: 'puukenga',
    reo: 'Pūkenga',
    en: 'Practitioner Capability',
    full: 'Pūkenga & Practitioner Capability',
    domain: 'Training, supervision, reflective practice, scope of practice',
  },
  {
    id: 'haepapa',
    reo: 'Haepapa',
    en: 'Accountability',
    full: 'Haepapa & Accountability',
    domain: 'Timely notes, reporting obligations, follow-through, transparency',
  },
  {
    id: 'oranga',
    reo: 'Oranga',
    en: 'Protective Factors',
    full: 'Oranga & Protective Factors',
    domain: 'Whānau strengths, cultural engagement, wellbeing, mana restoration',
  },
] as const

export const POU_ORDER = TE_WAHAROA_POU.map((pou) => pou.id)
