export type LocalDate = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  precision: "minute" | "second";
  key: string;
};
export type Message = {
  id: string;
  conversationId: string;
  sourceId: string;
  sourceRefs?: {
    sourceId: string;
    lineStart: number;
    lineEnd: number;
  }[];
  position: number;
  lineStart: number;
  lineEnd: number;
  temporal: string;
  date?: LocalDate;
  author?: string;
  originalAuthor?: string;
  participantId?: string;
  text: string;
  raw: string;
  kind: "message" | "system" | "unrecognized";
  attachmentNames: string[];
  attachmentIds: string[];
  warnings: string[];
};
export type Conversation = {
  id: string;
  name: string;
  kind: "individual" | "group";
  selfId?: string;
  lastDate: string;
  preview: string;
  messageCount: number;
  read?: {
    id: string;
    offset: number;
  };
};
export type Participant = {
  id: string;
  conversationId: string;
  name: string;
};
export type Alias = {
  id: string;
  conversationId: string;
  original: string;
  participantId: string;
};
export type Attachment = {
  id: string;
  conversationId: string;
  sourceId: string;
  path: string;
  mime: string;
  size: number;
  blob: Blob;
  hash: string;
};
export type ImportSource = {
  id: string;
  conversationId: string;
  hash: string;
  name: string;
  text: string;
  status: "pending" | "complete";
  warnings: string[];
  exporterId?: string;
  created: string;
};
export type ParseResult = {
  messages: Message[];
  authors: string[];
  warnings: string[];
  ambiguous: boolean;
  order: "DMY" | "MDY";
};
export type Prepared = {
  hash: string;
  name: string;
  text: string;
  paths: string[];
  attachmentBytes: number;
  parsed: ParseResult;
};
