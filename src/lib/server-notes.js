import pool from './db';
import { createNotesStore } from './notes-store';
export const notesStore = createNotesStore(pool);
