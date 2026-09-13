import type { CellValue, Config, ResolvedField, RowData, TableStats } from '../shared/types';
import { FILE_COLUMN_KEY } from '../shared/types';
import { buildDiscovered, resolveFields } from './config';
import type { ScannedRow } from './scanner';

export interface BuildResult {
  fields: ResolvedField[];
  rows: RowData[];
  stats: TableStats;
}

export function buildTable(
  config: Config,
  scanned: readonly ScannedRow[],
  showWithoutFrontmatter: boolean,
): BuildResult {
  const discovered = buildDiscovered(scanned);
  const { fields, optionsTruncated } = resolveFields(config, discovered);

  const rows: RowData[] = [];
  let withoutFrontmatter = 0;
  let unparsable = 0;

  for (const row of scanned) {
    if (row.parseError) unparsable++;
    if (!row.hasFrontmatter) {
      withoutFrontmatter++;
      if (!showWithoutFrontmatter) continue;
    }
    const values: Record<string, CellValue> = {};
    for (const field of fields) {
      if (field.key === FILE_COLUMN_KEY) continue;
      const v = row.values[field.key];
      values[field.key] = v === undefined ? null : v;
    }
    rows.push({
      id: row.relPath,
      fileName: row.fileName,
      relPath: row.relPath,
      values,
      hasFrontmatter: row.hasFrontmatter,
      parseError: row.parseError,
    });
  }

  return {
    fields,
    rows,
    stats: {
      shown: rows.length,
      unparsable,
      withoutFrontmatter,
      optionsTruncated,
    },
  };
}

export function rowFromScanned(row: ScannedRow, fields: readonly ResolvedField[]): RowData {
  const values: Record<string, CellValue> = {};
  for (const field of fields) {
    if (field.key === FILE_COLUMN_KEY) continue;
    const v = row.values[field.key];
    values[field.key] = v === undefined ? null : v;
  }
  return {
    id: row.relPath,
    fileName: row.fileName,
    relPath: row.relPath,
    values,
    hasFrontmatter: row.hasFrontmatter,
    parseError: row.parseError,
  };
}
