/** Shared open handlers for the dashboard's foundation setup surfaces. */
export interface SetupActions {
  onOpenFacility: () => void;
  onOpenReactor: () => void;
  onOpenRegistry: () => void;
  facilityId: string | null;
}
