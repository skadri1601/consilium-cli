export interface SubAgentDef {
  name: string;
  description: string;
  model?: string;
  allowedTools?: string[];
  systemPrompt: string;
  filePath: string;
}

export interface SubAgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  allowedTools?: string[];
}
