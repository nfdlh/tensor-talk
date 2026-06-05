export type Evidence = {
  kb_id: string;
  source_doc?: string;
  scope_label?: string;
  section?: string;
  subsection?: string;
  pages?: number[];
  source_text?: string;
};

export type ChatRequest = {
  message: string;
};

export type ChatResponse = {
  answer: string;
  evidence: Evidence[];
  mode: string;
};
