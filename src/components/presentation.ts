import { attachmentNames } from "../import/parser";
export type OmittedKind =
  | "Imagem"
  | "Vídeo"
  | "Áudio"
  | "Documento"
  | "Ficheiro";
const edited =
  /(?:^|\s)<(?:Esta mensagem foi editada|Mensagem editada|This message was edited|This message has been edited|Message edited)>\s*$/i;
const deleted =
  /^(?:<)?(Esta mensagem foi (?:eliminada|apagada)|Apagaste esta mensagem|Você apagou esta mensagem|This message was deleted|You deleted this message)(?:>)?$/i;
const omitted =
  /^<(Ficheiro não revelado|(?:ficheiro|arquivo|media|mídia|imagem|image|vídeo|video|áudio|audio|documento|document) (?:omitid[oa]|omitted|não incluíd[oa]|not included))>$/i;
/** Derive presentation only. Stored text and backups stay unchanged. */
export function presentMessage(original: string) {
  let text = original;
  let isEdited = false;
  const suffix = text.match(edited);
  if (suffix) {
    const line = text.slice(text.lastIndexOf("\n", suffix.index!) + 1);
    if (!/^\s*[>"'`]/.test(line)) {
      text = text.slice(0, suffix.index).trimEnd();
      isEdited = true;
    }
  }
  const omissions: OmittedKind[] = [];
  let deletion: string | undefined;
  const lines = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim(),
      marker = trimmed.match(omitted);
    if (marker) {
      const token = marker[1].toLocaleLowerCase("pt-PT");
      omissions.push(
        /^(imagem|image)\b/.test(token)
          ? "Imagem"
          : /^(vídeo|video)\b/.test(token)
            ? "Vídeo"
            : /^(áudio|audio)\b/.test(token)
              ? "Áudio"
              : /^(documento|document)\b/.test(token)
                ? "Documento"
                : "Ficheiro",
      );
      return "";
    }
    const removed = trimmed.match(deleted);
    if (removed) {
      deletion = removed[1];
      return "";
    }
    if (!/^\s*[>"'`]/.test(line))
      return line.replace(
        /<\s*(?:attached|anexado|anexo)\s*:\s*[^>]+>|[^\n<>]+?\s*\((?:file attached|ficheiro anexado|arquivo anexado|ficheiro em anexo)\)/gi,
        "",
      );
    return line;
  });
  return {
    text: lines.join("\n").trim(),
    edited: isEdited,
    deletion,
    omissions,
    attachmentNames: attachmentNames(original),
    editOnly:
      isEdited && !lines.join("").trim() && !deletion && !omissions.length,
  };
}
export function visibleText(original: string) {
  const p = presentMessage(original);
  return [
    p.text,
    p.deletion,
    ...p.omissions.map(
      (kind) =>
        kind + (/^(Imagem)$/.test(kind) ? " não incluída" : " não incluído"),
    ),
    p.editOnly ? "Mensagem editada sem texto disponível" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
