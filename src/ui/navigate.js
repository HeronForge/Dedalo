// From a reference in the document to the entity that defines it, open for editing.
//
// The document is full of codes — AP-03, RES-02, IMG-01, T-02.01.03 — and every one of them
// is somewhere in the editor. Following one by hand means remembering which section holds it
// and finding it in a list; the click does that instead.

/** The collections whose entries are edited in a section of their own name. */
const COLLECTIONS = ['references', 'variables', 'variants', 'resources', 'protocols',
  'interfaces', 'commands', 'images', 'points', 'glossary'];

/**
 * Where an entity is edited.
 * @returns {{section: string, selection: object, stageId?: string}|null}
 */
export function editTarget(doc, id) {
  if (!doc || !id) return null;
  for (const key of COLLECTIONS) {
    if ((doc[key] || []).some((e) => e && e.id === id)) {
      return { section: key, selection: { section: key, id } };
    }
  }
  for (const stage of doc.stages || []) {
    if (stage.id === id) return { section: 'stages', selection: { section: 'stages', id, kind: 'stage' } };
    for (const test of stage.tests || []) {
      if (test.id === id) return { section: 'stages', selection: { section: 'stages', id, kind: 'test' }, stageId: stage.id };
      for (const step of test.steps || []) {
        if (step.id === id) return { section: 'stages', selection: { section: 'stages', id, kind: 'step' }, stageId: stage.id };
      }
    }
  }
  return null;
}

/** Whether this document lets a reference lead into the editor. */
export const directEditingAllowed = (doc) => !((doc || {}).settings || {}).noDirectEditing;

/**
 * Opens the entity in its section, selected and ready to edit.
 * @param {(stageId: string) => void} [reveal] opens the tree down to a test or a step
 */
export function openForEditing(store, id, reveal) {
  // The resolved document, because under an active variant the entity may exist only there.
  const target = editTarget(store.resolvedDoc(), id);
  if (!target) return false;
  if (target.stageId && reveal) reveal(target.stageId);
  store.set({ section: target.section, selection: target.selection });
  return true;
}
