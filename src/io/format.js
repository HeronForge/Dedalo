// Recognising, checking and upgrading the JSON this tool exchanges.
//
// Every file that comes in says what it is — «tsw-authoring/1», «tsw-export/1» — and every file
// that goes out says it too. A file older than this build is upgraded and the reader is told
// what was upgraded; a file newer than this build is refused with the reason, because importing
// half of something you do not understand is worse than not importing it.
import { FORMATS, APP_VERSION, APP_NAME } from '../version.js';
import { SCHEMA_VERSION } from '../model/schema.js';

/** "tsw-authoring/1" -> { id: 'tsw-authoring', version: 1 } */
export function parseFormat(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const [id, version] = text.split('/');
  return { id, version: Number(version) || 1 };
}

export const formatTag = (kind) => `${FORMATS[kind].id}/${FORMATS[kind].writes}`;

/**
 * What is this JSON, and can this build read it?
 * @returns {{kind: 'authoring'|'export'|null, version: number, readable: boolean,
 *            reason: string, notes: string[]}}
 */
export function inspect(data) {
  const notes = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { kind: null, version: 0, readable: false, reason: 'This file does not contain a JSON object.', notes };
  }

  const declared = parseFormat(data.format);
  const looksLikeExport = !!data.doc;
  const kind = declared
    ? (declared.id === FORMATS.export.id ? 'export' : declared.id === FORMATS.authoring.id ? 'authoring' : null)
    : looksLikeExport ? 'export' : Array.isArray(data.stages) ? 'authoring' : null;

  if (!kind) {
    return {
      kind: null,
      version: 0,
      readable: false,
      reason: declared && declared.id === FORMATS.notes.id
        ? 'This is a notes file, not a document: read it with File › Import notes…'
        : declared
          ? `Unknown format «${data.format}». This build reads ${formatTag('authoring')} and ${formatTag('export')}.`
          : 'The file says nothing about its format, and its content resembles neither an authoring file nor a data export.',
      notes,
    };
  }

  const spec = FORMATS[kind];
  const version = declared ? declared.version : spec.writes;
  if (!declared) notes.push(`The file carries no version: read as ${spec.id}/${version}, the format of this build.`);

  if (version > spec.writes) {
    return {
      kind,
      version,
      readable: false,
      reason: `This file is written in ${spec.id}/${version}, and this build (${APP_NAME} ${APP_VERSION}) only reads up to ${spec.id}/${spec.writes}. Open it with a newer build.`,
      notes,
    };
  }
  if (!spec.reads.includes(version)) {
    return {
      kind,
      version,
      readable: false,
      reason: `Version ${spec.id}/${version} is no longer supported by this build.`,
      notes,
    };
  }
  if (version < spec.writes) notes.push(`Upgraded from ${spec.id}/${version} to ${spec.id}/${spec.writes}.`);

  if (kind === 'export' && data.doc && typeof data.doc.schemaVersion === 'number' && data.doc.schemaVersion > SCHEMA_VERSION) {
    return {
      kind,
      version,
      readable: false,
      reason: `The document inside uses data schema ${data.doc.schemaVersion}, and this build understands up to ${SCHEMA_VERSION}.`,
      notes,
    };
  }

  return { kind, version, readable: true, reason: '', notes };
}

/** The envelope every export is wrapped in, so that whoever opens it knows what it is. */
export const exportEnvelope = (state) => ({
  format: formatTag('export'),
  application: APP_NAME,
  applicationVersion: APP_VERSION,
  schemaVersion: SCHEMA_VERSION,
  exported: new Date().toISOString().slice(0, 10),
  doc: state.doc,
  history: state.history,
  assets: state.assets,
});
