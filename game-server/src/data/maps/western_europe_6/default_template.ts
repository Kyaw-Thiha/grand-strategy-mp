// Default division template for Phase 4: 10 standard_infantry + 4 machine_gun + 2 light_artillery.
// 16 cells in a 5×5 grid (leaving 9 empty). 0% armoured → Infantry division type.

export interface TemplateCell {
  unit_type: string;
  row: number;
  col: number;
}

export const DEFAULT_TEMPLATE: TemplateCell[] = [
  // Row 0: standard_infantry across top
  { unit_type: "standard_infantry", row: 0, col: 0 },
  { unit_type: "standard_infantry", row: 0, col: 1 },
  { unit_type: "standard_infantry", row: 0, col: 2 },
  { unit_type: "standard_infantry", row: 0, col: 3 },
  { unit_type: "standard_infantry", row: 0, col: 4 },
  // Row 1: standard_infantry
  { unit_type: "standard_infantry", row: 1, col: 0 },
  { unit_type: "standard_infantry", row: 1, col: 1 },
  { unit_type: "standard_infantry", row: 1, col: 2 },
  { unit_type: "standard_infantry", row: 1, col: 3 },
  { unit_type: "standard_infantry", row: 1, col: 4 },
  // Row 2: machine_gun support
  { unit_type: "machine_gun", row: 2, col: 0 },
  { unit_type: "machine_gun", row: 2, col: 1 },
  { unit_type: "machine_gun", row: 2, col: 2 },
  { unit_type: "machine_gun", row: 2, col: 3 },
  // Row 3: light_artillery
  { unit_type: "light_artillery", row: 3, col: 0 },
  { unit_type: "light_artillery", row: 3, col: 1 },
];
