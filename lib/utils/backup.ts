/**
 * Future backup format boundary.
 * JSON is only used for export/import snapshots, never as live storage.
 */
export interface BackupSnapshotV1 {
  version: 1;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

export function createEmptyBackupPlan(): BackupSnapshotV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      products: [],
      bills: [],
      billItems: [],
      stockMovements: [],
      settings: [],
    },
  };
}
